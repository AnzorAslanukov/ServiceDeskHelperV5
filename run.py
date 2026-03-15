"""
Service Desk Helper — Application entry point.

This is the slim entry point that creates the Flask app via the factory
and starts the development server.  All routes, business logic, and state
management live in the ``app/`` package.

Usage:
    python run.py
"""

import os
import sys
import threading

# Ensure the project root is on sys.path
sys.path.insert(0, os.path.dirname(__file__))

from app.factory import create_app, warm_up_warehouse

app = create_app()

if __name__ == '__main__':
    # When Flask runs in debug mode it uses a reloader that spawns a child
    # process.  WERKZEUG_RUN_MAIN is set to 'true' only in the child (the
    # actual serving process), so we start the warm-up thread there to avoid
    # firing it twice.  When debug=False (production), the condition is also
    # satisfied.
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        threading.Thread(target=warm_up_warehouse, daemon=True).start()

    app.run(host='0.0.0.0', debug=True, threaded=True)