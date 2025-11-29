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
        - ATHENA_AUTH_URL
        - ATHENA_BASE_URL
        - ATHENA_JSON_TEMPLATE
        """
        self.username = os.getenv('ATHENA_USERNAME')
        self.password = os.getenv('ATHENA_PASSWORD')
        self.client_id = os.getenv('ATHENA_CLIENT_ID')
        
        self.auth_url = os.getenv('ATHENA_AUTH_URL')
        self.base_url = os.getenv('ATHENA_BASE_URL')
        
        # Get JSON template from environment
        self.json_template = os.getenv('ATHENA_JSON_TEMPLATE')
        
        self.token = None
        self.output = Output()
        if DEBUG:
            self.output.add_line("Athena client initialized")
            self.output.add_line(f"Auth URL: {self.auth_url}")
            self.output.add_line(f"Base URL: {self.base_url}")

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

        token_url = f"{self.auth_url}oauth2/token"
        
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
                self.output.add_line(f"Making auth request to {token_url}")
            response = requests.post(token_url, headers=headers, data=data, timeout=30)
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

    def get_ticket_data(self, ticket_number):
        return None


if __name__ == "__main__" and TEST_RUN:
    # Test instance creation, token retrieval, and incident ticket lookup
    athena_client = Athena()

    token = athena_client.get_token()

    if token:
        athena_client.output.add_line("Token obtained successfully")

        
