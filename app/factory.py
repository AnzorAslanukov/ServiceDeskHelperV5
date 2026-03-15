"""
Flask application factory.

Creates and configures the Flask app, registers all Blueprints.
Separated from __init__.py to work around .clineignore restrictions
on __init__.py files.
"""

import sys
import os
import threading

from flask import Flask

from services.databricks import Databricks
from services.output import Output


def create_app() -> Flask:
    """
    Create and configure the Flask application.

    Returns:
        Configured Flask app with all Blueprints registered.
    """
    # Ensure the project root is on sys.path so that ``services.*`` and
    # ``app.*`` imports work regardless of how the app is launched.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    app = Flask(
        __name__,
        template_folder='templates',
        static_folder='static',
    )

    _register_blueprints(app)

    return app


def _register_blueprints(app: Flask) -> None:
    """Import and register all route Blueprints."""
    from app.routes.main import main_bp
    from app.routes.search import search_bp
    from app.routes.ticket_advice import ticket_advice_bp
    from app.routes.validation import validation_bp
    from app.routes.recommendations import recommendations_bp
    from app.routes.assignments import assignments_bp
    from app.routes.presence import presence_bp
    from app.routes.consensus import consensus_bp
    from app.routes.sync import sync_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(ticket_advice_bp)
    app.register_blueprint(validation_bp)
    app.register_blueprint(recommendations_bp)
    app.register_blueprint(assignments_bp)
    app.register_blueprint(presence_bp)
    app.register_blueprint(consensus_bp)
    app.register_blueprint(sync_bp)


def warm_up_warehouse() -> None:
    """
    Start the Databricks SQL warehouse in the background at app startup.
    Ensures the warehouse is running before the first user request arrives.
    """
    output = Output()
    try:
        output.add_line("Warehouse warm-up: initiating SQL warehouse start...")
        db = Databricks()
        success = db.start_warehouse(wait_for_running=True, timeout=300)
        if success:
            output.add_line("Warehouse warm-up: SQL warehouse is RUNNING and ready")
        else:
            output.add_line("Warehouse warm-up: warehouse did not reach RUNNING state within timeout")
    except Exception as e:
        output.add_line(f"Warehouse warm-up: unexpected error: {e}")