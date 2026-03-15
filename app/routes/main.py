"""
Main routes — index page, favicon, and test file serving.
"""

from flask import Blueprint, render_template, send_from_directory, current_app

main_bp = Blueprint('main', __name__)


@main_bp.route('/favicon.ico')
def favicon():
    return send_from_directory(current_app.static_folder, 'images/upenn_logo_simplified.ico')


@main_bp.route('/tests/<path:filename>')
def serve_test_file(filename):
    """Serve files from the tests/ directory (used for debug/test JS files)."""
    return send_from_directory('tests', filename)


@main_bp.route('/')
def index():
    return render_template('index.html')