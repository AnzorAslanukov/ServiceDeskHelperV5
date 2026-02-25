"""
Configuration module for loading environment variables.
This module loads the .env file and makes environment variables available to all services.
"""
import os
from dotenv import load_dotenv

def load_environment():
    """
    Load environment variables from .env file.
    
    This function looks for the .env file in the project root directory
    (one level up from the services folder).
    
    Works in both local development environments and Databricks workspace.
    """
    # Get the directory of this config file
    config_dir = os.path.dirname(os.path.abspath(__file__))
    # Go up one level to project root
    project_root = os.path.dirname(config_dir)
    env_path = os.path.join(project_root, '.env')
    load_dotenv(env_path)

# Call it once when this module is imported
load_environment()
