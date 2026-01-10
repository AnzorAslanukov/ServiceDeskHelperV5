import requests
import json
import os
import sys
from dotenv import load_dotenv

# Add current directory to path for imports when running as script
sys.path.insert(0, os.path.dirname(__file__))

from output import Output
from parse_json import ParseJson
from field_mapping import FieldMapper

load_dotenv()

DEBUG = True  # Global debug setting for print statements 
TEST_RUN = False  # Set to True to enable the test section when running the file 
PROCESS_INDICATORS = False  # Enable/disable process loading indicator print statements 

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
        self.srv_url = os.getenv('ATHENA_SERVICEREQUEST_VIEW_URL')
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
            # Determine ticket type and appropriate view URL
            prefix = ticket_number[:2].upper()
            if prefix == "IR":
                url = self.irv_url
            elif prefix == "SR":
                url = self.srv_url
            else:
                if DEBUG:
                    self.output.add_line(f"View not supported for ticket type: {prefix}")
                return None

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
                response = requests.post(url, headers=headers, json=payload, timeout=30)
                if response.status_code == 200:
                    raw_data = response.json()
                    return FieldMapper.normalize_athena_data(raw_data)  # Normalize field names
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
                        raw_data = response.json()
                        return FieldMapper.normalize_athena_data(raw_data)  # Normalize field names
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
                        raw_data = response.json()
                        return FieldMapper.normalize_athena_data(raw_data)  # Normalize field names
                    else:
                        if DEBUG:
                            self.output.add_line(f"{prefix} ticket data failed: {response.status_code} - {response.text}")
                        return None
                except requests.exceptions.RequestException as e:
                    if DEBUG:
                        self.output.add_line(f"Network error: {str(e)}")
                    return None

    def get_validation_tickets(self):
        """
        Get all ticket numbers from the 'Validation' support group.

        Queries active IR tickets and filters by support_group client-side.
        Queries active SR tickets with server-side filtering by support_group.

        Returns:
            list: Combined list of ticket numbers from both types
            None: If requests fail
        """
        if not self.token:
            self.token = self.get_token()
            if not self.token:
                return None

        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json'
        }

        # Payload for IR tickets: get active tickets, then filter by support_group client-side
        ir_payload = [
            {
                "condition": "and",
                "filters": [
                    {
                        "condition": "and",
                        "property": "status",
                        "operator": "eq",
                        "value": "5e2d3932-ca6d-1515-7310-6f58584df73e"
                    }
                ]
            }
        ]

        all_ticket_numbers = []

        # Get incident report tickets from Validation group
        try:
            if DEBUG:
                self.output.add_line("Querying all incident reports and filtering for Validation support group")

            response = requests.post(self.irv_url, headers=headers, json=ir_payload, timeout=120)

            if response.status_code == 200:
                raw_data = response.json()
                normalized_data = FieldMapper.normalize_athena_data(raw_data)

                ir_count = 0
                if 'result' in normalized_data:
                    for ticket in normalized_data['result']:
                        # Filter client-side by support_group
                        if ticket.get('support_group') == 'Validation' and 'id' in ticket:
                            all_ticket_numbers.append(ticket['id'])
                            ir_count += 1

                if DEBUG:
                    self.output.add_line(f"Found {ir_count} IR validation tickets")

            else:
                if DEBUG:
                    self.output.add_line(f"IR tickets query failed: {response.status_code} - {response.text}")

        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Error getting IR validation tickets: {str(e)}")
            return None

        # Get service request tickets from Validation group (server-side filter)
        sr_payload = [
            {
                "condition": "and",
                "filters": [
                    {
                        "condition": "and",
                        "property": "status",
                        "operator": "eq",
                        "value": "72b55e17-1c7d-b34c-53ae-f61f8732e425"
                    },
                    {
                        "condition": "and",
                        "property": "supportgroup",
                        "operator": "eq",
                        "value": "c954d465-65a0-9e43-9b02-b353e87bdb37"
                    }
                ]
            }
        ]

        try:
            if DEBUG:
                self.output.add_line("Querying service requests filtered for Validation support group server-side")

            response = requests.post(self.srv_url, headers=headers, json=sr_payload, timeout=120)

            if response.status_code == 200:
                raw_data = response.json()
                normalized_data = FieldMapper.normalize_athena_data(raw_data)

                sr_count = 0
                if 'result' in normalized_data:
                    for ticket in normalized_data['result']:
                        if 'id' in ticket:
                            all_ticket_numbers.append(ticket['id'])
                            sr_count += 1

                if DEBUG:
                    self.output.add_line(f"Found {sr_count} SR validation tickets")

            else:
                if DEBUG:
                    self.output.add_line(f"SR tickets query failed: {response.status_code} - {response.text}")

        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Error getting SR validation tickets: {str(e)}")
            return None

        if DEBUG:
            self.output.add_line(f"Total validation tickets found: {len(all_ticket_numbers)}")

        return all_ticket_numbers


if __name__ == "__main__" and TEST_RUN:
    # Test instance creation, token retrieval, and incident ticket lookup
    athena_client = Athena()

    token = athena_client.get_token()

    if token:
        athena_client.output.add_line("Token obtained successfully")

        # Test get_ticket_data
        # ticket_data = athena_client.get_ticket_data("IR10154685", view=True)
        # ticket_data = athena_client.get_ticket_data("SR10158406", view=True)
        # ticket_data = athena_client.get_validation_tickets() 
        filters = {"contactMethod":"215-485-6549"}
        ticket_data = athena_client.get_ticket_data(conditions=filters)
        if ticket_data: 
            athena_client.output.add_line("Ticket data retrieved:") 
            athena_client.output.add_line(json.dumps(ticket_data, indent=4)) 
            # for ticket in ticket_data:
            #     athena_client.output.add_line(ticket) 
        else: 
            athena_client.output.add_line("Failed to retrieve ticket data")
