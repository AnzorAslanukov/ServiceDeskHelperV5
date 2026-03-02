import requests
import json
import os
from dotenv import load_dotenv
from typing import Union

# Add current directory to path for imports when running as script
import sys
sys.path.insert(0, os.path.dirname(__file__))

from output import Output
from parse_json import ParseJson
from field_mapping import FieldMapper
from embedding_model import EmbeddingModel

load_dotenv()

DEBUG = True  # Global debug setting for print statements
TEST_RUN = True  # Set to True to enable the test section when running the file 

class Databricks:

    def __init__(self):
        """
        Initialize Databricks API client.
        Credentials must be set via environment variables:
        - DATABRICKS_API_KEY
        - DATABRICKS_SERVER_HOSTNAME
        - DATABRICKS_HTTP_PATH
        """
        self.api_key = os.getenv('DATABRICKS_API_KEY')
        self.server_hostname = os.getenv('DATABRICKS_SERVER_HOSTNAME')
        self.http_path = os.getenv('DATABRICKS_HTTP_PATH')

        self.output = Output()
        if DEBUG:
            self.output.add_line("Databricks client initialized")

    def start_warehouse(self, wait_for_running: bool = False, timeout: int = 300) -> bool:
        """
        Start the SQL warehouse so it is ready to accept queries.
        Safe to call when the warehouse is already running (idempotent).

        Args:
            wait_for_running (bool): If True, block until the warehouse reaches RUNNING state or timeout.
            timeout (int): Maximum seconds to wait for the warehouse to reach RUNNING state (default: 300).

        Returns:
            bool: True if the start request was accepted (and warehouse is RUNNING if wait_for_running=True),
                  False otherwise.
        """
        if not all([self.api_key, self.server_hostname, self.http_path]):
            if DEBUG:
                self.output.add_line("start_warehouse: Missing required environment variables")
            return False

        warehouse_id = self.http_path.split('/')[-1]
        url = f"https://{self.server_hostname}/api/2.0/sql/warehouses/{warehouse_id}/start"
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        try:
            if DEBUG:
                self.output.add_line(f"Starting SQL warehouse {warehouse_id}...")
            response = requests.post(url, headers=headers, timeout=30)

            # 200 = start accepted, 409 = already running (conflict is fine)
            if response.status_code in (200, 409):
                if response.status_code == 409:
                    if DEBUG:
                        self.output.add_line(f"SQL warehouse {warehouse_id} is already running")
                else:
                    if DEBUG:
                        self.output.add_line(f"SQL warehouse {warehouse_id} start request accepted")

                if wait_for_running:
                    return self._wait_for_warehouse_running(warehouse_id, timeout)
                return True
            else:
                if DEBUG:
                    self.output.add_line(f"Failed to start warehouse (HTTP {response.status_code}): {response.text}")
                return False

        except requests.exceptions.RequestException as e:
            if DEBUG:
                self.output.add_line(f"Network error starting warehouse: {str(e)}")
            return False
        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Unexpected error starting warehouse: {str(e)}")
            return False

    def _wait_for_warehouse_running(self, warehouse_id: str, timeout: int = 300) -> bool:
        """
        Poll the warehouse status endpoint until the warehouse reaches RUNNING state or timeout.

        Args:
            warehouse_id (str): The warehouse ID to poll.
            timeout (int): Maximum seconds to wait.

        Returns:
            bool: True if warehouse reached RUNNING state, False if timed out or in a terminal non-running state.
        """
        import time

        status_url = f"https://{self.server_hostname}/api/2.0/sql/warehouses/{warehouse_id}"
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        start_time = time.time()
        poll_interval = 5  # seconds between polls

        if DEBUG:
            self.output.add_line(f"Waiting for warehouse {warehouse_id} to reach RUNNING state (timeout: {timeout}s)...")

        while time.time() - start_time < timeout:
            try:
                response = requests.get(status_url, headers=headers, timeout=30)
                if response.status_code == 200:
                    state = response.json().get('state', 'UNKNOWN')
                    if DEBUG:
                        elapsed = int(time.time() - start_time)
                        self.output.add_line(f"Warehouse {warehouse_id} state: {state} ({elapsed}s elapsed)")

                    if state == 'RUNNING':
                        if DEBUG:
                            self.output.add_line(f"Warehouse {warehouse_id} is now RUNNING")
                        return True
                    elif state in ('STOPPED', 'DELETING', 'DELETED'):
                        if DEBUG:
                            self.output.add_line(f"Warehouse {warehouse_id} entered terminal state: {state}")
                        return False
                    # STARTING state: continue polling
                else:
                    if DEBUG:
                        self.output.add_line(f"Unexpected status poll response (HTTP {response.status_code})")
            except requests.exceptions.RequestException as e:
                if DEBUG:
                    self.output.add_line(f"Network error polling warehouse status: {str(e)}")

            time.sleep(poll_interval)

        if DEBUG:
            self.output.add_line(f"Timed out waiting for warehouse {warehouse_id} to reach RUNNING state after {timeout}s")
        return False

    def test_api_key_validity(self):
        """
        Test the validity of the Databricks API key by making a simple API call.
        Prints the status to output.txt.
        Returns True if valid, False otherwise.
        """
        if not self.api_key or not self.server_hostname:
            if DEBUG:
                self.output.add_line("Missing API key or server hostname")
            return False

        # Use a simple API call to test the key - list clusters as it's a basic endpoint
        url = f"https://{self.server_hostname}/api/2.0/clusters/list"
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        try:
            if DEBUG:
                self.output.add_line(f"Testing API key validity with {url}")
            response = requests.get(url, headers=headers, timeout=30)

            if response.status_code == 200:
                if DEBUG:
                    self.output.add_line("Databricks API key is valid")
                return True
            elif response.status_code == 401:
                if DEBUG:
                    self.output.add_line("Databricks API key is invalid (401 Unauthorized)")
                return False
            else:
                if DEBUG:
                    self.output.add_line(f"Unexpected response during API key test: {response.status_code} - {response.text}")
                return False

        except requests.exceptions.RequestException as e:
            if DEBUG:
                self.output.add_line(f"Network error during API key test: {str(e)}")
            return False
        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Unexpected error during API key test: {str(e)}")
            return False

    def execute_sql_query(self, query: Union[str, dict], max_results: int = 20) -> dict:
        """
        Execute an arbitrary SQL query provided as a string or dict.
        For string input: executes the SQL directly
        For dict input: expects {'query': 'SQL string', ...} format
        Returns query results as dict, or None if failed.
        """
        if not all([self.api_key, self.server_hostname, self.http_path]):
            if DEBUG:
                self.output.add_line("Missing required environment variables for SQL execution")
            return None

        # Process the query input
        if isinstance(query, str):
            sql_query = query.strip()
            # Remove trailing semicolon if present
            if sql_query.endswith(';'):
                sql_query = sql_query[:-1]
        elif isinstance(query, dict):
            if 'query' not in query:
                if DEBUG:
                    self.output.add_line("Dict query input must contain 'query' key")
                return None
            sql_query = query['query'].strip()
            if sql_query.endswith(';'):
                sql_query = sql_query[:-1]
        else:
            if DEBUG:
                self.output.add_line(f"Unsupported query type: {type(query)}")
            return None

        # Apply max_results limit only if not already present
        if "LIMIT" not in sql_query.upper():
            sql_query += f" LIMIT {max_results}"

        # API endpoint for executing SQL statements
        execute_url = f"https://{self.server_hostname}/api/2.0/sql/statements"

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        payload = {
            "warehouse_id": self.http_path.split('/')[-1],  # Extract warehouse ID from http_path
            "statement": sql_query,
            "wait_timeout": "50s"  # Wait up to 50 seconds inline (Databricks maximum)
        }

        try:
            if DEBUG:
                self.output.add_line(f"Executing SQL query: {sql_query[:100]}{'...' if len(sql_query) > 100 else ''}")
                self.output.add_line(f"Using warehouse: {payload['warehouse_id']}")

            # Submit the SQL statement
            response = requests.post(execute_url, headers=headers, json=payload, timeout=120)

            if response.status_code == 200:
                result_data = response.json()

                # If the warehouse is still starting, the query may come back as PENDING with a
                # statement_id. Poll the status endpoint until it completes (up to 300 seconds).
                if result_data.get('status', {}).get('state') == 'PENDING':
                    import time
                    statement_id = result_data.get('statement_id')
                    if not statement_id:
                        if DEBUG:
                            self.output.add_line("Query returned PENDING but no statement_id found")
                        return {"status": "pending", "message": "Query is still running"}

                    status_url = f"https://{self.server_hostname}/api/2.0/sql/statements/{statement_id}"
                    poll_timeout = 300  # seconds
                    poll_interval = 5   # seconds between polls
                    start_time = time.time()

                    if DEBUG:
                        self.output.add_line(f"Query PENDING (statement_id={statement_id}), polling for completion...")

                    while time.time() - start_time < poll_timeout:
                        time.sleep(poll_interval)
                        try:
                            poll_response = requests.get(status_url, headers=headers, timeout=30)
                            if poll_response.status_code == 200:
                                result_data = poll_response.json()
                                state = result_data.get('status', {}).get('state')
                                if DEBUG:
                                    elapsed = int(time.time() - start_time)
                                    self.output.add_line(f"Poll {elapsed}s: statement state = {state}")
                                if state in ('SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED'):
                                    break
                            else:
                                if DEBUG:
                                    self.output.add_line(f"Poll request failed (HTTP {poll_response.status_code})")
                        except requests.exceptions.RequestException as poll_err:
                            if DEBUG:
                                self.output.add_line(f"Poll network error: {str(poll_err)}")
                    else:
                        if DEBUG:
                            self.output.add_line(f"Timed out polling for statement {statement_id} after {poll_timeout}s")
                        return {"status": "error", "message": f"Query timed out after {poll_timeout}s"}

                # Check if the query completed successfully
                if result_data.get('status', {}).get('state') == 'SUCCEEDED':
                    # Extract the result data
                    if 'result' in result_data and 'data_array' in result_data['result']:
                        table_records = result_data['result']['data_array']
                        columns = [col['name'] for col in result_data['result'].get('columns', [])]

                        # Fallback column names when API doesn't provide them (SELECT * queries issue)
                        if not columns and table_records and len(table_records[0]) == 35:
                            if DEBUG:
                                self.output.add_line("Using fallback column names for athena_tickets table")
                            columns = [
                                'TicketType', 'Location', 'Floor', 'Room', 'CreatedDate', 'ResolvedDate', 'Priority', 'Id', 'Title',
                                'Description', 'SupportGroup', 'Source', 'Status', 'Impact', 'Urgency', 'AssignedToUserName',
                                'AssignedToBaseManagedEntityId', 'AffectedUserName', 'AffectedBaseManagedEntityId', 'LastModifiedDate',
                                'Escalated', 'First_Call_Resolution', 'Classification/Area', 'ResolutionCategory', 'ResolutionNotes',
                                'CommandCenter', 'ConfirmedResolution', 'Increments', 'FeedbackValue', 'Feedback_Notes', 'Tags',
                                'Specialty', 'Next_Steps', 'User_Assign_Change', 'Support_Group_Change'
                            ]

                        # Fallback for aggregate queries when no columns are provided
                        if not columns and table_records and len(table_records[0]) == 1:
                            columns = ['count']

                        # Fallback for similarity search queries (id, similarity)
                        if not columns and table_records and len(table_records[0]) == 2:
                            if DEBUG:
                                self.output.add_line("Using fallback column names for similarity search query")
                            columns = ['id', 'similarity']

                        # Fallback for onenote similarity search queries (title, content, notebook, section, similarity)
                        if not columns and table_records and len(table_records[0]) == 5:
                            if DEBUG:
                                self.output.add_line("Using fallback column names for onenote similarity search query")
                            columns = ['title', 'content', 'notebook', 'section', 'similarity']

                        if DEBUG:
                            self.output.add_line(f"Query executed successfully, returned {len(table_records)} records, columns found: {len(columns)}")

                        # Convert list rows to normalized dictionaries
                        normalized_data = []
                        for row in table_records:
                            if len(row) != len(columns):
                                if DEBUG:
                                    self.output.add_line(f"Row length {len(row)} doesn't match columns {len(columns)}")
                                continue
                            row_dict = dict(zip(columns, row))
                            normalized_row = FieldMapper.normalize_databricks_data(row_dict)
                            normalized_data.append(normalized_row)

                        return {"status": "success", "data": normalized_data, "count": len(normalized_data)}
                    else:
                        if DEBUG:
                            self.output.add_line("Query succeeded but no data returned")
                        return {"status": "success", "columns": [], "data": [], "count": 0, "message": "No data returned"}
                elif result_data.get('status', {}).get('state') == 'FAILED':
                    error_msg = result_data.get('status', {}).get('error', {}).get('message', 'Unknown error')
                    if DEBUG:
                        self.output.add_line(f"Query failed: {error_msg}")
                    return {"status": "failed", "error": error_msg}
                else:
                    state = result_data.get('status', {}).get('state')
                    if DEBUG:
                        self.output.add_line(f"Query in unexpected state: {state}")
                    return {"status": "unknown", "state": state}
            else:
                if DEBUG:
                    self.output.add_line(f"Failed to submit SQL query (HTTP {response.status_code}): {response.text}")
                return {"status": "error", "http_code": response.status_code, "message": response.text}

        except requests.exceptions.RequestException as e:
            if DEBUG:
                self.output.add_line(f"Network error during SQL execution: {str(e)}")
            return {"status": "error", "message": f"Network error: {str(e)}"}
        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Unexpected error during SQL execution: {str(e)}")
            return {"status": "error", "message": f"Unexpected error: {str(e)}"}

    def similarity_search(self, table_name: str, query_text: str, limit: int = 5):
        """
        Perform vector similarity search on the specified table.
        Generates embedding for query_text and finds similar records by cosine similarity.

        Args:
            table_name (str): Full table path like 'catalog.schema.table' (must have 'id' and 'ticket_embedding' columns)
            query_text (str): Input text to search for similarity
            limit (int): Number of top similar results to return (default: 5)

        Returns:
            list: List of dictionaries with 'id' and 'similarity' keys, or None if failed
        """
        # Initialize embedding model
        embedding_model = EmbeddingModel()

        # Generate embedding for query text
        query_embedding = embedding_model.get_embedding(query_text)
        if not query_embedding:
            if DEBUG:
                self.output.add_line("Failed to generate embedding for similarity search")
            return None

        # Convert embedding list to JSON-like string for CAST
        embedding_json = "[" + ",".join([str(x) for x in query_embedding]) + "]"

        # Construct SQL query for similarity search using array functions
        sql_query = f"""
        WITH query_vec AS (
            SELECT CAST(PARSE_JSON('{embedding_json}') AS ARRAY<DOUBLE>) as v
        )
        SELECT id,
          (aggregate(zip_with(ticket_embedding, query_vec.v, (x, y) -> x * y), 0D, (acc, x) -> acc + x) /
           (sqrt(aggregate(transform(ticket_embedding, x -> x * x), 0D, (acc, x) -> acc + x)) *
            sqrt(aggregate(transform(query_vec.v, x -> x * x), 0D, (acc, x) -> acc + x)))) as similarity
        FROM {table_name}, query_vec
        ORDER BY similarity DESC
        LIMIT {limit}
        """

        # Execute the query
        result = self.execute_sql_query(sql_query, max_results=limit+1)  # +1 to allow for context

        if result and result.get("status") == "success":
            return result.get("data", [])
        else:
            if DEBUG:
                self.output.add_line(f"Similarity search query failed: {result}")
            return None

    def get_table_data(self, catalog_name, schema_name, table_name):
        """
        Execute a SELECT query to access table contents.
        Returns the query results as a list of records, or None if failed.
        Prints table contents to output.txt.
        """
        if not all([self.api_key, self.server_hostname, self.http_path]):
            if DEBUG:
                self.output.add_line("Missing required environment variables for SQL execution")
            return None

        # Construct the SQL query
        sql_query = f"SELECT * FROM {catalog_name}.{schema_name}.{table_name}"

        # API endpoint for executing SQL statements
        execute_url = f"https://{self.server_hostname}/api/2.0/sql/statements"

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        payload = {
            "warehouse_id": self.http_path.split('/')[-1],  # Extract warehouse ID from http_path
            "statement": sql_query,
            "wait_timeout": "30s"  # Wait up to 30 seconds for completion
        }

        try:
            if DEBUG:
                self.output.add_line(f"Executing SQL query: {sql_query}")
                self.output.add_line(f"Using warehouse: {payload['warehouse_id']}")

            # Submit the SQL statement
            response = requests.post(execute_url, headers=headers, json=payload, timeout=60)

            if response.status_code == 200:
                result_data = response.json()

                # Check if the query completed successfully
                if result_data.get('status', {}).get('state') == 'SUCCEEDED':
                    # Extract the result data
                    if 'result' in result_data and 'data_array' in result_data['result']:
                        table_records = result_data['result']['data_array']
                        if DEBUG:
                            self.output.add_line(f"Query executed successfully, returned {len(table_records)} records")
                            self.output.add_line(f"=== Table Contents: {catalog_name}.{schema_name}.{table_name} ===")
                            # Print all records to output.txt
                            for i, record in enumerate(table_records, 1):
                                self.output.add_line(f"Record {i}: {json.dumps(record)}")
                            self.output.add_line("=" * 50)
                        return table_records
                    else:
                        if DEBUG:
                            self.output.add_line("Query succeeded but no data returned")
                        return []
                elif result_data.get('status', {}).get('state') == 'FAILED':
                    if DEBUG:
                        self.output.add_line(f"Query failed: {result_data.get('status', {}).get('error', {}).get('message', 'Unknown error')}")
                    return None
                elif result_data.get('status', {}).get('state') == 'PENDING':
                    if DEBUG:
                        self.output.add_line("Query is still running - try again later")
                    return None
                else:
                    if DEBUG:
                        self.output.add_line(f"Query in unexpected state: {result_data.get('status', {}).get('state')}")
                    return None
            else:
                if DEBUG:
                    self.output.add_line(f"Failed to submit SQL query (HTTP {response.status_code}): {response.text}")
                return None

        except requests.exceptions.RequestException as e:
            if DEBUG:
                self.output.add_line(f"Network error during SQL execution: {str(e)}")
            return None
        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Unexpected error during SQL execution: {str(e)}")
            return None

    def semantic_search_onenote(self, query_text: str, limit: int = 5) -> list:
        """
        Perform semantic search on onenote_documentation table.
        Generates embedding for query_text and finds similar documentation pages by cosine similarity.

        Args:
            query_text (str): Input text to search for in OneNote documentation
            limit (int): Number of top similar results to return (default: 5)

        Returns:
            list: List of dictionaries with 'title', 'content', 'notebook', 'section', 'similarity' keys, or [] if failed
        """
        # Initialize embedding model
        embedding_model = EmbeddingModel()

        # Generate embedding for query text
        query_embedding = embedding_model.get_embedding(query_text)
        if not query_embedding:
            if DEBUG:
                self.output.add_line("Failed to generate embedding for semantic search")
            return []

        # Table name
        table_name = "scratchpad.aslanuka.onenote_documentation"
        embedding_json = "[" + ",".join([str(x) for x in query_embedding]) + "]"

        # Construct SQL query for similarity search using array functions
        sql_query = f"""
        SELECT title, content, notebook, section,
          (aggregate(zip_with(embeddings, CAST(PARSE_JSON('{embedding_json}') AS ARRAY<DOUBLE>), (x, y) -> x * y), 0D, (acc, x) -> acc + x) /
           (sqrt(aggregate(transform(embeddings, x -> x * x), 0D, (acc, x) -> acc + x)) *
            sqrt(aggregate(transform(CAST(PARSE_JSON('{embedding_json}') AS ARRAY<DOUBLE>), x -> x * x), 0D, (acc, x) -> acc + x)))) as similarity
        FROM {table_name}
        ORDER BY similarity DESC
        LIMIT {limit}
        """

        # Execute the query
        result = self.execute_sql_query(sql_query, max_results=limit+1)

        if result and result.get("status") == "success":
            data = result.get("data", [])
            # Print results to output.txt if DEBUG is enabled
            if DEBUG:
                self.output.add_line(f"Semantic search results for '{query_text}': {len(data)} results")
                for row in data:
                    content_str = str(row.get('content', ''))
                    content_preview = content_str[:100] + '...' if len(content_str) > 100 else content_str
                    embeddings_str = str(row.get('embeddings', ''))
                    embeddings_preview = embeddings_str[:50] + '...' if len(embeddings_str) > 50 else embeddings_str
                    self.output.add_line(f"Title: {row.get('title')}, Notebook: {row.get('notebook')}, Section: {row.get('section')}, Content: {content_preview}, Embeddings: {embeddings_preview}, Similarity: {row.get('similarity')}")
            return data
        else:
            if DEBUG:
                self.output.add_line(f"Semantic search query failed: {result}")
            return []


if __name__ == "__main__" and TEST_RUN:
    # Test instance creation, API key validity, and table access
    databricks_client = Databricks()

    # Test API key validity
    if DEBUG:
        databricks_client.output.add_line("Testing Databricks API key validity...")
    api_valid = databricks_client.test_api_key_validity()
    if api_valid:
        databricks_client.output.add_line("API key validation successful")
    else:
        databricks_client.output.add_line("API key validation failed")
        exit(1)

    # Template query: Search by substring in Description
    # search_substring = "Issues with Caregility"
    # example_query = f"SELECT * FROM prepared.ticketing.athena_tickets WHERE Description LIKE '%{search_substring}%';"
    # example_query = "SELECT * FROM prepared.ticketing.athena_tickets WHERE Id IN ('IR4964858', 'IR4971857');"
    # example_query = "SELECT COUNT(*) FROM scratchpad.aslanuka.ir_embeddings;"
    # result = databricks_client.execute_sql_query(example_query)
    # result = databricks_client.similarity_search("scratchpad.aslanuka.ir_embeddings", "Add new providers")
    # print(result)
    # parsed_result = ParseJson().parse_object(result)
    # databricks_client.output.add_line(parsed_result)
    databricks_client.semantic_search_onenote("Who is responsible for handling issues with Cerner label printers?")
