"""
Cross-client state synchronisation routes.

/api/sync-checkbox              (POST)
/api/sync-assignment-selection  (POST)
/api/sync-poll-timer            (POST)
/api/sync-implement             (POST)
/api/sync-state                 (GET)
/api/toggle-validation          (POST)
/api/ui-state                   (GET)
"""

from flask import Blueprint, request, jsonify

from app.config import CONSENSUS_TICKET_THRESHOLD
from app.state import validation_cache
from app.state import sync_state
from app.state import presence
from app.state import ui_state
from app.state import consensus_state
from app.state import recommendation_originals

sync_bp = Blueprint('sync', __name__)


@sync_bp.route('/api/sync-checkbox', methods=['POST'])
def api_sync_checkbox():
    """
    Synchronise checkbox state across all connected clients.

    Also recomputes the implement button state via ui_state (which delegates
    to button_rules) and checks whether consensus should be activated,
    deactivated, or revoked.

    Request body:
      ``{"ticket_id": "IR12345", "checked": true}``
      OR
      ``{"select_all": true, "checked": true}``
    """
    data = request.get_json(silent=True) or {}

    if 'select_all' in data:
        checked = bool(data.get('checked', False))
        cached_ids = [t['id'] for t in validation_cache.get_tickets()]
        sync_state.set_all_checkboxes(checked, cached_ids)
        sync_state.broadcast_checkbox(None, checked, is_select_all=True)
        # Recompute button state via rules engine
        _recompute_from_checkboxes()
        return jsonify({'status': 'ok'})

    ticket_id = data.get('ticket_id', '').strip()
    if not ticket_id:
        return jsonify({'error': 'Missing ticket_id'}), 400

    checked = bool(data.get('checked', False))
    sync_state.set_checkbox(ticket_id, checked)
    sync_state.broadcast_checkbox(ticket_id, checked)

    # Check if this new checkbox check should revoke full assignment
    if checked and consensus_state.is_full_assignment_active():
        if consensus_state.check_new_checkbox(ticket_id):
            # New checkbox not in original consensus set → revoke
            consensus_state.revoke_full_assignment_new_checkbox()
            consensus_state.broadcast_state()

    # Recompute button state via rules engine
    _recompute_from_checkboxes()
    return jsonify({'status': 'ok'})


@sync_bp.route('/api/sync-assignment-selection', methods=['POST'])
def api_sync_assignment_selection():
    """
    Synchronise support group / priority selection across all clients.

    The server compares the incoming value against the stored original AI
    recommendation to determine whether editor attribution should be applied
    or cleared.  This is the **single source of truth** — clients never
    need to decide locally whether a value is "original".

    Request body:
      ``{"ticket_id": "IR12345", "field": "support_group_radio", "value": "...",
         "session_id": "<uuid>"}``
    """
    data = request.get_json(silent=True) or {}
    ticket_id = data.get('ticket_id', '').strip()
    field = data.get('field', '').strip()
    value = data.get('value', '')
    session_id = data.get('session_id', '').strip()

    if not ticket_id or not field:
        return jsonify({'error': 'Missing ticket_id or field'}), 400

    valid_fields = ('support_group_radio', 'manual_support_group', 'priority_radio')
    if field not in valid_fields:
        return jsonify({'error': f'Invalid field: {field}'}), 400

    # ── Server-side "is original?" comparison ─────────────────────────────
    is_original = _is_original_value(ticket_id, field, value)

    # Always store the actual value (never empty-string for reverts)
    sync_state.set_assignment(ticket_id, field, value)

    # ── Editor attribution (server decides based on original comparison) ──
    editor_info = None
    if is_original:
        # Value matches original → clear editor attribution for this field
        sync_state.clear_assignment_editor(ticket_id, field)
    elif session_id:
        user = presence.get_session_info(session_id)
        if user:
            label = user['label']
            color = user['color']
            sync_state.set_assignment_editor(
                ticket_id, field, session_id, label, color)
            editor_info = {
                'session_id': session_id,
                'label': label,
                'color': color,
            }

    # Broadcast the assignment selection change to all clients
    sync_state.broadcast_assignment(ticket_id, field, value, editor_info)

    # Compute and broadcast the authoritative header state
    sync_state.compute_and_broadcast_header(ticket_id)

    return jsonify({'status': 'ok'})


@sync_bp.route('/api/sync-poll-timer', methods=['POST'])
def api_sync_poll_timer():
    """
    Broadcast the next poll epoch timestamp so all clients show the same countdown.

    Request body: ``{"next_poll_at": <epoch_ms>}``
    """
    data = request.get_json(silent=True) or {}
    next_poll_at = data.get('next_poll_at', 0)

    sync_state.set_next_poll(next_poll_at)
    sync_state.broadcast_poll_timer(next_poll_at)
    return jsonify({'status': 'ok'})


@sync_bp.route('/api/sync-implement', methods=['POST'])
def api_sync_implement():
    """
    Broadcast implement-assignment lifecycle events.

    Request body:
      ``{"action": "started", "session_id": "<uuid>", "ticket_ids": [...]}``
      OR
      ``{"action": "complete", "results": {...}}``
    """
    data = request.get_json(silent=True) or {}
    action = data.get('action', '').strip()

    if action == 'started':
        sync_state.set_implement_in_progress(True)
        sync_state.broadcast_implement_started(data.get('ticket_ids', []))
        ui_state.set_implement_in_progress(True)
        return jsonify({'status': 'ok'})

    elif action == 'complete':
        sync_state.set_implement_in_progress(False)
        results = data.get('results', {})
        validation_cache.broadcast('implement-complete', {
            'results': results,
        }, buffer=False)
        ui_state.set_implement_in_progress(False)
        return jsonify({'status': 'ok'})

    return jsonify({'error': f'Invalid action: {action}'}), 400


@sync_bp.route('/api/toggle-validation', methods=['POST'])
def api_toggle_validation():
    """
    Toggle the 'Get validation tickets' button on or off.

    Request body: ``{"active": true/false}`` (optional — defaults to toggling)
    """
    data = request.get_json(silent=True) or {}

    if 'active' in data:
        active = bool(data['active'])
    else:
        active = not sync_state.is_validation_toggle_on()

    sync_state.set_validation_toggle(active)
    ui_state.set_validation_toggle(active)

    return jsonify({'status': 'ok', 'active': active})


@sync_bp.route('/api/sync-state', methods=['GET'])
def api_sync_state():
    """
    Return the full cross-client synchronisation state.
    Used by late-joining clients to restore checkbox, assignment, timer,
    editor attribution state, and pre-computed header states.
    """
    return jsonify({
        'checkboxes': sync_state.get_checkbox_state(),
        'assignments': sync_state.get_assignment_selections(),
        'editors': sync_state.get_assignment_editors(),
        'headers': sync_state.compute_all_headers(),
        'next_poll_at': sync_state.get_next_poll(),
        'implement_in_progress': sync_state.is_implement_in_progress(),
        'validation_toggle_on': sync_state.is_validation_toggle_on(),
    })


@sync_bp.route('/api/ui-state', methods=['GET'])
def api_ui_state():
    """
    Return the current centralised UI state for the three workflow buttons.
    Used by late-joining clients or as a fallback after SSE reconnect.

    Accepts an optional ``session_id`` query parameter to personalise
    consensus tooltip text.
    """
    session_id = request.args.get('session_id', '').strip() or None
    return jsonify(ui_state.get_state(session_id=session_id))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_original_value(ticket_id: str, field: str, value: str) -> bool:
    """Check whether *value* matches the original AI recommendation for *field*.

    For ``manual_support_group``, the original is always empty (no manual SG).
    For radio fields, the original is the AI-recommended value stored in
    :mod:`recommendation_originals`.

    Values are stripped of leading/trailing whitespace before comparison to
    guard against minor formatting differences between the LLM output and
    the radio-button value round-tripped through the browser.
    """
    if field == 'manual_support_group':
        # Original state is "no manual SG selected"
        return not value or not value.strip()

    original = recommendation_originals.get_original(ticket_id)
    if not original:
        # No original stored yet — cannot determine; treat as not original
        return False

    clean_value = (value or '').strip()

    if field == 'support_group_radio':
        return clean_value == (original.get('support_group', '') or '').strip()
    elif field == 'priority_radio':
        return clean_value == (original.get('priority', '') or '').strip()

    return False


def _recompute_from_checkboxes() -> None:
    """Read the authoritative checkbox counts and update ui_state."""
    cb = sync_state.get_checkbox_state()
    total = len(cb)
    checked = sum(1 for v in cb.values() if v)

    # Check consensus activation / deactivation
    user_count = presence.get_active_count()
    if user_count > 1 and checked > CONSENSUS_TICKET_THRESHOLD:
        if not consensus_state.is_active():
            consensus_state.activate()
            consensus_state.broadcast_state()
    elif consensus_state.is_active() and checked <= CONSENSUS_TICKET_THRESHOLD:
        consensus_state.deactivate()
        consensus_state.broadcast_state()

    # Update consensus context in ui_state
    cs = consensus_state.get_state()
    ui_state.set_consensus_state(
        active=cs['active'],
        agreed=len(cs['agreed']),
        required=cs['required'],
        unlocked=cs.get('unlocked', False),
        full_assignment_active=cs.get('full_assignment_active', False),
    )

    # Update checkbox counts (this also recomputes and broadcasts)
    ui_state.set_checkbox_counts(checked, total)