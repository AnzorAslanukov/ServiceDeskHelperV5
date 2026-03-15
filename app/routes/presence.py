"""
Presence routes — heartbeat and leave.

/api/presence/heartbeat  (POST)
/api/presence/leave      (POST)
"""

from flask import Blueprint, request, jsonify

from app.state import presence as presence_state
from app.state import consensus_state

presence_bp = Blueprint('presence', __name__)


@presence_bp.route('/api/presence/heartbeat', methods=['POST'])
def api_presence_heartbeat():
    """
    Register or refresh a viewer's presence.

    Request body: ``{"session_id": "<uuid>", "display_name": "Jane Smith"}``
    Response:     ``{"sessions": [{session_id, color, label}, ...]}``
    """
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()
    display_name = (data.get('display_name') or '').strip() or None

    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400

    sessions, stale_ids = presence_state.heartbeat(session_id, display_name)

    # If stale sessions were removed, check consensus state
    if stale_ids:
        consensus_state.check_after_presence_change()

    return jsonify({'sessions': sessions})


@presence_bp.route('/api/presence/leave', methods=['POST'])
def api_presence_leave():
    """
    Explicitly remove a viewer's presence (called on page unload).

    Request body: ``{"session_id": "<uuid>"}``
    """
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    if session_id:
        presence_state.leave(session_id)
        consensus_state.check_after_presence_change()

    return jsonify({'status': 'ok'})