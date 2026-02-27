"""
Flask application entry point for Databricks Apps.
This file exports the Flask app instance for proper route registration.
"""
from run import app

# This ensures the app is properly exported when Flask starts
__all__ = ['app']
