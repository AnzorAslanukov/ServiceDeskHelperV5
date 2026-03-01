
import os
import requests
import json
import sys
from dotenv import load_dotenv

# Add current directory to path for imports when running as script
sys.path.insert(0, os.path.dirname(__file__))

from output import Output

load_dotenv()

DEBUG = True  # Global debug setting for print statements
TEST_RUN = True  # Set to True to enable the test section when running the file

class TextGenerationModel:
    def __init__(self):
        self.api_key = os.getenv('DATABRICKS_API_KEY')
        self.url = os.getenv('DATABRICKS_SONNET_4.5_URL')
        self.output = Output()
        if DEBUG:
            self.output.add_line("TextGenerationModel client initialized")

    def ask(self, prompt: str, max_retries: int = 3) -> dict:
        """
        Enhanced Q&A method with structured output validation and retry logic.
        Args:
            prompt: Formatted prompt to send to LLM
            max_retries: Maximum number of retry attempts (default 3)
        Returns:
            Parsed JSON dict from LLM response with required keys, or error dict
        """
        for attempt in range(max_retries):
            try:
                if DEBUG:
                    self.output.add_line(f"LLM Query attempt {attempt + 1}: {prompt[:200]}{'...' if len(prompt) > 200 else ''}")

                payload = {
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 1000  # Increased for longer assignment responses
                }

                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }

                response = requests.post(self.url, headers=headers, json=payload)
                response.raise_for_status()

                data = response.json()
                content = data.get('choices', [{}])[0].get('message', {}).get('content', '')

                if DEBUG:
                    self.output.add_line(f"LLM Response (attempt {attempt + 1}): {content}")

                # Parse JSON response
                try:
                    # Clean up markdown formatting if present
                    clean_content = content.strip()
                    if clean_content.startswith('```json'):
                        clean_content = clean_content[7:].strip()  # Remove ```json
                    if clean_content.endswith('```'):
                        clean_content = clean_content[:-3].strip()  # Remove trailing ```

                    result = json.loads(clean_content)
                except json.JSONDecodeError:
                    if DEBUG:
                        self.output.add_line(f"JSON parse error on attempt {attempt + 1}, retrying...")
                    if attempt == max_retries - 1:  # Last attempt
                        return {"error": "Failed to parse JSON response after all retries"}
                    continue

                # Validate required keys
                required_keys = ["recommended_support_group", "recommended_priority_level", "detailed_explanation"]
                if not all(key in result for key in required_keys):
                    missing = [key for key in required_keys if key not in result]
                    if DEBUG:
                        self.output.add_line(f"Missing required keys {missing} on attempt {attempt + 1}, retrying...")
                    if attempt == max_retries - 1:  # Last attempt
                        return {"error": f"Response missing required keys after all retries: {missing}"}
                    continue

                # Success - return the response
                return result

            except requests.exceptions.RequestException as e:
                error_msg = f"Request error on attempt {attempt + 1}: {str(e)}"
                if DEBUG:
                    self.output.add_line(error_msg)
                if attempt == max_retries - 1:
                    return {"error": error_msg}
            except Exception as e:
                error_msg = f"Unexpected error on attempt {attempt + 1}: {str(e)}"
                if DEBUG:
                    self.output.add_line(error_msg)
                if attempt == max_retries - 1:
                    return {"error": error_msg}

        return {"error": "All retry attempts exhausted"}


if __name__ == '__main__' and TEST_RUN:
    # Test the ask method
    model = TextGenerationModel()
    test_question = "What is Databricks?"
    response = model.ask(test_question)
    if DEBUG:
        model.output.add_line("Test Response: " + response)
