import requests
import json
import os
from dotenv import load_dotenv
from typing import List, Dict
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# Add current directory to path for imports when running as script
import sys
sys.path.insert(0, os.path.dirname(__file__))

from output import Output

load_dotenv()

DEBUG = True  # Global debug setting for print statements
TEST_RUN = False  # Set to True to enable test section when running the file

class EmbeddingModel:
    """
    Class for interacting with Databricks embedding model to compute text embeddings and similarities.
    """

    def __init__(self):
        """
        Initialize EmbeddingModel.
        """
        self.api_key = os.getenv('DATABRICKS_API_KEY')
        self.embedding_url = os.getenv('DATABRICKS_EMBEDDING_URL')
        self.output = Output()
        if DEBUG:
            self.output.add_line("EmbeddingModel initialized")

    def get_embedding(self, text: str) -> List[float]:
        """
        Generate embedding vector for the given text using Databricks embedding model.
        """
        if not self.api_key or not self.embedding_url:
            if DEBUG:
                self.output.add_line("Missing API key or embedding URL")
            return []

        payload = {
            "input": text
        }

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        try:
            if DEBUG:
                self.output.add_line(f"Generating embedding for text, length: {len(text)}, first 50: {text[:50]}...")
                self.output.add_line(f"Making request to: {self.embedding_url}")
            response = requests.post(self.embedding_url, headers=headers, json=payload, timeout=60)
            if response.status_code == 200:
                result = response.json()
                # Assuming result structure similar to other models, extract vector
                # Adjust based on actual API response
                if 'data' in result and len(result['data']) > 0:
                    embedding = result['data'][0].get('embedding', [])
                    if DEBUG:
                        self.output.add_line(f"Embedding generated, length: {len(embedding)}")
                    return embedding
                else:
                    if DEBUG:
                        self.output.add_line("No embedding in response")
                    return []
            else:
                if DEBUG:
                    self.output.add_line(f"Embedding API error: {response.status_code} - {response.text}")
                return []
        except Exception as e:
            if DEBUG:
                self.output.add_line(f"Embedding error: {str(e)}")
            return []

if __name__ == "__main__" and TEST_RUN:
    # Test embedding functionality
    embedding_model = EmbeddingModel()

    test_text = "Cannot sign into upennmed.emscloudservice.com"
    embedding = embedding_model.get_embedding(test_text)
    if embedding:
        embedding_model.output.add_line(f"Test embedding length: {len(embedding)}")
        embedding_model.output.add_line(f"First 5 values: {embedding[:5]}")
    else:
        embedding_model.output.add_line("Test embedding failed")
