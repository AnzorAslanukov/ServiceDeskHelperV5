import requests
import json
import os
import sys
from dotenv import load_dotenv

# Add current directory to path for imports when running as script
sys.path.insert(0, os.path.dirname(__file__))

from output import Output
from parse_json import ParseJson

load_dotenv()

DEBUG = True  # Global debug setting for print statements
TEST_RUN = True  # Set to True to enable the test section when running the file
PROCESS_INDICATORS = True  # Enable/disable process loading indicator print statements

class Athena:

    def __init__(self):
        """
        Initialize Athena API client.
        Credentials must be set via environment variables:
        - ATHENA_USERNAME
        - ATHENA_PASSWORD
        - ATHENA_CLIENT_ID
        - ATHENA_BASE_URL
        - ATHENA_JSON_TEMPLATE
        """
        self.username = os.getenv('ATHENA_USERNAME')
        self.password = os.getenv('ATHENA_PASSWORD')
        self.client_id = os.getenv('ATHENA_CLIENT_ID')
        
        self.base_url = os.getenv('ATHENA_BASE_URL')
        self.auth_url = os.getenv('ATHENA_AUTH_URL')
        self.irv_url= os.getenv('ATHENA_INCIDENT_VIEW_URL')
        self.ir_url = os.getenv('ATHENA_INCIDENT_URL')
        self.sr_url = os.getenv('ATHENA_SERVICEREQUEST_URL')
        self.cr_url = os.getenv('ATHENA_CHANGEREQUEST_URL')
        
        # Get JSON template from environment
        self.json_template = os.getenv('ATHENA_JSON_TEMPLATE')
        
        self.token = None
        self.output = Output()
        if DEBUG:
            self.output.add_line("Athena client initialized")

    def get_token(self):
        """
        Retrieves an OAuth2 token using username, password, and client_id.
        Returns the token if successful, None otherwise.
        """
        if not all([self.username, self.password, self.client_id]):
            if DEBUG:
                self.output.add_line("Missing credentials for authentication")
            return None

        if PROCESS_INDICATORS:
            print("Contacting Athena API for authentication...")
        
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        data = {
            'username': self.username,
            'password': self.password,
            'grant_type': 'password',
            'client_id': self.client_id
        }

        try:
            if DEBUG:
                self.output.add_line(f"Making auth request to {self.auth_url}")
            response = requests.post(self.auth_url, headers=headers, data=data, timeout=30)
            if DEBUG:
                self.output.add_line(f"Auth response status: {response.status_code}")

            if response.status_code == 200:
                response_json = response.json()
                self.token = response_json.get('access_token')
                if self.token and DEBUG:
                    self.output.add_line("Token retrieved successfully")
                elif not self.token:
                    if DEBUG:
                        self.output.add_line("No access_token in response")
                if PROCESS_INDICATORS:
                    print("Authentication successful")
                return self.token
            else:
                if DEBUG:
                    self.output.add_line(f"Auth failed: {response.status_code} - {response.text}")
                if PROCESS_INDICATORS:
                    print("Authentication failed")

        except requests.exceptions.RequestException as e:
            if DEBUG:
                self.output.add_line(f"Network error during auth: {str(e)}")
            if PROCESS_INDICATORS:
                print("Network error during authentication")
        except json.JSONDecodeError as e:
            if DEBUG:
                self.output.add_line(f"JSON decode error: {str(e)}")
            if PROCESS_INDICATORS:
                print("Response parsing error during authentication")
        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Unexpected error during auth: {str(e)}")
            if PROCESS_INDICATORS:
                print("Unexpected error during authentication")

        return None

    def get_ticket_data(self, ticket_number=None, view=False, conditions=None):
        if not self.token:
            self.token = self.get_token()
            if not self.token:
                return None

        headers = {
            'Authorization': f'Bearer {self.token}'
        }

        if view:
            # Replace placeholder
            json_str = self.json_template.replace('{{TICKET_ID}}', ticket_number)

            try:
                payload = json.loads(json_str)
            except json.JSONDecodeError:
                if DEBUG:
                    self.output.add_line("Invalid JSON template")
                return None

            headers['Content-Type'] = 'application/json'

            try:
                response = requests.post(self.irv_url, headers=headers, json=payload, timeout=30)
                if response.status_code == 200:
                    return response.json()  # Assuming you want to return the data
                else:
                    if DEBUG:
                        self.output.add_line(f"GET ticket data failed: {response.status_code} - {response.text}")
                    return None
            except requests.exceptions.RequestException as e:
                if DEBUG:
                    self.output.add_line(f"Network error: {str(e)}")
                return None

        else:
            # Check if conditions provided with contactMethod filter (only when ticket_number is None)
            if ticket_number is None and conditions and "contactMethod" in conditions and conditions["contactMethod"]:
                # Proceed with POST request using filters for contactMethod (ticket number not used for search)
                # Determine operator based on contactMethodContains flag
                operator = "contains" if conditions.get("contactMethodContains", False) else "eq"
                payload = [
                    {
                        "condition": "and",
                        "filters": [
                            {
                                "property": "ContactMethod",
                                "operator": operator,
                                "value": conditions["contactMethod"]
                            }
                        ]
                    }
                ]

                headers['Content-Type'] = 'application/json'

                try:
                    response = requests.post(self.irv_url, headers=headers, json=payload, timeout=120)
                    if response.status_code == 200:
                        return response.json()
                    else:
                        if DEBUG:
                            self.output.add_line(f"Filtered ticket data failed: {response.status_code} - {response.text}")
                        return None
                except requests.exceptions.RequestException as e:
                    if DEBUG:
                        self.output.add_line(f"Network error: {str(e)}")
                    return None

            else:
                # Determine ticket type by first two characters (case-insensitive)
                prefix = ticket_number[:2].upper() if ticket_number else ""

                if prefix == "IR":
                    url = f"{self.ir_url}{ticket_number}"
                elif prefix == "SR":
                    url = f"{self.sr_url}{ticket_number}"
                elif prefix == "CR":
                    url = f"{self.cr_url}{ticket_number}"
                else:
                    if DEBUG:
                        self.output.add_line(f"Unknown ticket type prefix: {prefix}")
                    return None

                try:
                    response = requests.get(url, headers=headers, timeout=30)
                    if response.status_code == 200:
                        return response.json()
                    else:
                        if DEBUG:
                            self.output.add_line(f"{prefix} ticket data failed: {response.status_code} - {response.text}")
                        return None
                except requests.exceptions.RequestException as e:
                    if DEBUG:
                        self.output.add_line(f"Network error: {str(e)}")
                    return None


if __name__ == "__main__" and TEST_RUN:
    # Test instance creation, token retrieval, and incident ticket lookup
    athena_client = Athena()

    token = athena_client.get_token()

    if token:
        athena_client.output.add_line("Token obtained successfully")

        # Test get_ticket_data
        ticket_data = athena_client.get_ticket_data("IR10107172", view=True)
        # filters = {"contactMethod":"2156871743"}
        # ticket_data = athena_client.get_ticket_data(conditions=filters)
        if ticket_data:
            athena_client.output.add_line("Ticket data retrieved:")
            athena_client.output.add_line(json.dumps(ticket_data, indent=4))
        else:
            athena_client.output.add_line("Failed to retrieve ticket data")
