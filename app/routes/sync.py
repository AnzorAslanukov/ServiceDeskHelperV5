"""
Cross-client state synchronisation routes.

/api/sync-checkbox              (POST)
/api/sync-assignment-selection  (POST)
/api/sync-poll-timer            (POST)
/api/sync-implement             (POST)
/api/sync-state                 (GET)
"""

from flask import Blueprint, request, jsonify

from app.state import validation_cache
from app.state import sync_state
from app.state import presence
from app.state import ui_state

sync_bp = Blueprint('sync', __name__)


@sync_bp.route('/api/sync-checkbox', methods=['POST'])
def api_sync_checkbox():
    """
    Synchronise checkbox state across all connected clients.

    Request body:
      ``{"ticket_id": "IR12345", "checked": true}``
      OR
      ``{"select_all": true, "checked": true}``
    """
    data = request.get_json(silent=True) or {}

    if 'select_all' in data:
        checked = bool(data.get('checked', False))
        # Get all ticket IDs from validation cache for completeness
        cached_ids = [t['id'] for t in validation_cache.get_tickets()]
        sync_state.set_all_checkboxes(checked, cached_ids)
        sync_state.broadcast_checkbox(None, checked, is_select_all=True)
        return jsonify({'status': 'ok'})

    ticket_id = data.get('ticket_id', '').strip()
    if not ticket_id:
        return jsonify({'error': 'Missing ticket_id'}), 400

    checked = bool(data.get('checked', False))
    sync_state.set_checkbox(ticket_id, checked)
    sync_state.broadcast_checkbox(ticket_id, checked)
    return jsonify({'status': 'ok'})


@sync_bp.route('/api/sync-assignment-selection', methods=['POST'])
def api_sync_assignment_selection():
    """
    Synchronise support group / priority selection across all clients.

    Request body:
      ``{"ticket_id": "IR12345", "field": "support_group_radio", "value": "...",
         "session_id": "<uuid>"}``

    When *session_id* is provided the server looks up the user's display name
    and presence color and stores editor attribution alongside the selection.
    The attribution is included in the broadcast so all clients can show who
    made the change.
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

    sync_state.set_assignment(ticket_id, field, value)

    # ── Editor attribution ────────────────────────────────────────────────
    editor_info = None
    if session_id:
        # Read-only lookup — does not refresh the session timer
        user = presence.get_session_info(session_id)
        if user:
            label = user['label']
            color = user['color']
            if value:
                # Record the editor for this field
                sync_state.set_assignment_editor(
                    ticket_id, field, session_id, label, color)
                editor_info = {
                    'session_id': session_id,
                    'label': label,
                    'color': color,
                }
            else:
                # Empty value means the field was cleared (e.g. manual SG removed)
                sync_state.clear_assignment_editor(ticket_id, field)

    sync_state.broadcast_assignment(ticket_id, field, value, editor_info)
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
        return jsonify({'status': 'ok'})

    elif action == 'complete':
        sync_state.set_implement_in_progress(False)
        results = data.get('results', {})
        validation_cache.broadcast('implement-complete', {
            'results': results,
        }, buffer=False)
        return jsonify({'status': 'ok'})

    return jsonify({'error': f'Invalid action: {action}'}), 400


@sync_bp.route('/api/sync-state', methods=['GET'])
def api_sync_state():
    """
    Return the full cross-client synchronisation state.
    Used by late-joining clients to restore checkbox, assignment, timer,
    and editor attribution state.
    """
    return jsonify({
        'checkboxes': sync_state.get_checkbox_state(),
        'assignments': sync_state.get_assignment_selections(),
        'editors': sync_state.get_assignment_editors(),
        'next_poll_at': sync_state.get_next_poll(),
        'implement_in_progress': sync_state.is_implement_in_progress(),
    })


@sync_bp.route('/api/ui-state', methods=['GET'])
def api_ui_state():
    """
    Return the current centralised UI state for the three workflow buttons.
    Used by late-joining clients or as a fallback after SSE reconnect.
    """
    return jsonify(ui_state.get_state())
