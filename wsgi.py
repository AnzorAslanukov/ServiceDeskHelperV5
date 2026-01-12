#!/usr/bin/env python
"""
WSGI entry point for the Service Desk Helper application.

This module provides the WSGI application object for production deployment.
"""

from run import app

if __name__ == "__main__":
    # Allow the module to be run directly for testing
    app.run(debug=False)
