"""
Consensus routes — activate, vote, deactivate, state.

/api/consensus/activate    (POST)
/api/consensus/vote        (POST)
/api/consensus/deactivate  (POST)
/api/consensus/state       (GET)
"""

from flask import Blueprint, request, jsonify

from services.output import Output
from app.config import DEBUG
from app.state import presence as presence_state
from app.state import consensus_state

consensus_bp = Blueprint('consensus', __name__)


@consensus_bp.route('/api/consensus/activate', methods=['POST'])
def api_consensus_activate():
    """
    Activate consensus mode.  Only activates if 2+ users are present.

    Request body: ``{"session_id": "<uuid>"}``
    """
    output = Output()
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    if presence_state.get_active_count() < 2:
        return jsonify({
            'active': False, 'agreed': [], 'required': presence_state.get_active_count(),
            'unlocked': False,
        })

    state = consensus_state.activate()

    if DEBUG:
        output.add_line(
            f'consensus/activate: activated by '
            f'{session_id[:8] if session_id else "unknown"}'
        )

    consensus_state.broadcast_state()
    return jsonify(state)


@consensus_bp.route('/api/consensus/vote', methods=['POST'])
def api_consensus_vote():
    """
    Record or remove a user's agreement vote.

    Request body: ``{"session_id": "<uuid>", "agree": true/false}``
    """
    output = Output()
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()
    agree = data.get('agree', True)

    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400

    state = consensus_state.vote(session_id, agree)

    if DEBUG:
        output.add_line(
            f'consensus/vote: {session_id[:8]}… voted '
            f'{"agree" if agree else "disagree"}'
        )

    consensus_state.broadcast_state()
    return jsonify(state)


@consensus_bp.route('/api/consensus/deactivate', methods=['POST'])
def api_consensus_deactivate():
    """
    Deactivate consensus mode.

    Request body: ``{"session_id": "<uuid>"}``
    """
    output = Output()
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    state = consensus_state.deactivate()

    if DEBUG:
        output.add_line(
            f'consensus/deactivate: deactivated by '
            f'{session_id[:8] if session_id else "unknown"}'
        )

    consensus_state.broadcast_state()
    return jsonify(state)


@consensus_bp.route('/api/consensus/state', methods=['GET'])
def api_consensus_state():
    """Return the current consensus state."""
    return jsonify(consensus_state.get_state())