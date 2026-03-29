"""
Consensus routes — activate, vote, deactivate, disagree, state.

/api/consensus/activate    (POST)
/api/consensus/vote        (POST)
/api/consensus/deactivate  (POST)
/api/consensus/disagree    (POST)  — banner disagree in full assignment mode
/api/consensus/state       (GET)
"""

from flask import Blueprint, request, jsonify

from services.output import Output
from app.config import DEBUG
from app.state import presence as presence_state
from app.state import consensus_state
from app.state import sync_state
from app.state import ui_state

consensus_bp = Blueprint('consensus', __name__)


def _sync_consensus_to_ui():
    """Read consensus state and push it into ui_state for button_rules recomputation."""
    cs = consensus_state.get_state()
    ui_state.set_consensus_state(
        active=cs['active'],
        agreed=len(cs['agreed']),
        required=cs['required'],
        unlocked=cs.get('unlocked', False),
        full_assignment_active=cs.get('full_assignment_active', False),
    )


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
            'unlocked': False, 'full_assignment_active': False,
        })

    state = consensus_state.activate()

    if DEBUG:
        output.add_line(
            f'consensus/activate: activated by '
            f'{session_id[:8] if session_id else "unknown"}'
        )

    consensus_state.broadcast_state()
    _sync_consensus_to_ui()
    return jsonify(state)


@consensus_bp.route('/api/consensus/vote', methods=['POST'])
def api_consensus_vote():
    """
    Record or remove a user's agreement vote.

    The implement button itself acts as the consensus toggle:
    clicking it when in consensus mode toggles the user's vote.

    Request body: ``{"session_id": "<uuid>", "agree": true/false}``
    """
    output = Output()
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()
    agree = data.get('agree', True)

    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400

    state = consensus_state.vote(session_id, agree)

    # If consensus was just achieved, record the currently checked ticket IDs
    if state.get('unlocked') and state.get('full_assignment_active'):
        cb = sync_state.get_checkbox_state()
        checked_ids = {tid for tid, checked in cb.items() if checked}
        consensus_state.set_consensus_checked_ids(checked_ids)

    if DEBUG:
        output.add_line(
            f'consensus/vote: {session_id[:8]}… voted '
            f'{"agree" if agree else "disagree"}'
        )

    consensus_state.broadcast_state()
    _sync_consensus_to_ui()
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
    _sync_consensus_to_ui()
    return jsonify(state)


@consensus_bp.route('/api/consensus/disagree', methods=['POST'])
def api_consensus_disagree():
    """
    Disagree from the consensus banner during full assignment mode.

    Reverts from full assignment back to consensus mode.  Only the
    disagreeing user's vote is removed; other votes are preserved.

    Request body: ``{"session_id": "<uuid>"}``
    """
    output = Output()
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400

    state = consensus_state.revoke_full_assignment_disagree(session_id)

    if DEBUG:
        output.add_line(
            f'consensus/disagree: {session_id[:8]}… disagreed from banner'
        )

    consensus_state.broadcast_state()
    _sync_consensus_to_ui()
    return jsonify(state)


@consensus_bp.route('/api/consensus/state', methods=['GET'])
def api_consensus_state():
    """Return the current consensus state."""
    return jsonify(consensus_state.get_state())