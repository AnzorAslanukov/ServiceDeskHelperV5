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

load_dotenv()

DEBUG = True  # Global debug setting for print statements
TEST_RUN = False  # Set to True to enable the test section when running the file

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
            "wait_timeout": "30s"  # Wait up to 30 seconds for completion
        }

        try:
            if DEBUG:
                self.output.add_line(f"Executing SQL query: {sql_query[:100]}{'...' if len(sql_query) > 100 else ''}")
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
                        columns = [col['name'] for col in result_data['result'].get('columns', [])]
                        if DEBUG:
                            self.output.add_line(f"Query executed successfully, returned {len(table_records)} records, columns found: {len(columns)}")
                        return {"status": "success", "columns": columns, "data": table_records, "count": len(table_records)}
                    else:
                        if DEBUG:
                            self.output.add_line("Query succeeded but no data returned")
                        return {"status": "success", "columns": [], "data": [], "count": 0, "message": "No data returned"}
                elif result_data.get('status', {}).get('state') == 'FAILED':
                    error_msg = result_data.get('status', {}).get('error', {}).get('message', 'Unknown error')
                    if DEBUG:
                        self.output.add_line(f"Query failed: {error_msg}")
                    return {"status": "failed", "error": error_msg}
                elif result_data.get('status', {}).get('state') == 'PENDING':
                    if DEBUG:
                        self.output.add_line("Query is still running - try again later")
                    return {"status": "pending", "message": "Query is still running"}
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
    example_query = "SELECT * FROM prepared.ticketing.athena_tickets WHERE Id IN ('IR4964858', 'IR4971857');"
    result = databricks_client.execute_sql_query(example_query)
    print(result)
    parsed_result = ParseJson().parse_object(result)
    databricks_client.output.add_line(parsed_result)
