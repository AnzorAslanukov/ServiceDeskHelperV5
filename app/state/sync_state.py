"""
Cross-client state synchronisation.

Stores checkbox states, assignment selections (support group / priority
radio buttons), poll timer, and implement-in-progress flag so that all
connected clients stay in sync.
"""

import threading

from app.state import validation_cache
from app.state import ticket_header_rules
from app.state import recommendation_originals

_lock = threading.Lock()
_checkbox_state: dict = {}           # ticket_id -> bool
_assignment_selections: dict = {}    # ticket_id -> {field: value, ...}
_assignment_editors: dict = {}       # ticket_id -> {field: {session_id, label, color}}
_next_poll_epoch_ms: int = 0
_implement_in_progress: bool = False
_validation_toggle_on: bool = False  # "Get validation tickets" toggle state


# ── Checkbox sync ─────────────────────────────────────────────────────────────

def set_checkbox(ticket_id: str, checked: bool) -> None:
    with _lock:
        _checkbox_state[ticket_id] = checked


def set_all_checkboxes(checked: bool, ticket_ids: list[str] | None = None) -> None:
    """
    Set all checkboxes to *checked*.  If *ticket_ids* is provided, also
    ensures those IDs are included (covers tickets from the validation cache
    that may not yet be in ``_checkbox_state``).
    """
    with _lock:
        for tid in list(_checkbox_state.keys()):
            _checkbox_state[tid] = checked
        if ticket_ids:
            for tid in ticket_ids:
                _checkbox_state[tid] = checked


def get_checkbox_state() -> dict:
    with _lock:
        return dict(_checkbox_state)


# ── Assignment selection sync ─────────────────────────────────────────────────

def set_assignment(ticket_id: str, field: str, value: str) -> None:
    with _lock:
        if ticket_id not in _assignment_selections:
            _assignment_selections[ticket_id] = {}
        _assignment_selections[ticket_id][field] = value


def get_assignment_selections() -> dict:
    with _lock:
        return {k: dict(v) for k, v in _assignment_selections.items()}


# ── Assignment editor tracking ────────────────────────────────────────────────

def set_assignment_editor(ticket_id: str, field: str, session_id: str,
                          label: str, color: str) -> None:
    """Record which user last changed a particular field on a ticket."""
    with _lock:
        if ticket_id not in _assignment_editors:
            _assignment_editors[ticket_id] = {}
        _assignment_editors[ticket_id][field] = {
            'session_id': session_id,
            'label': label,
            'color': color,
        }


def clear_assignment_editor(ticket_id: str, field: str) -> None:
    """Remove editor attribution for a specific field (e.g. when manual SG is cleared)."""
    with _lock:
        if ticket_id in _assignment_editors:
            _assignment_editors[ticket_id].pop(field, None)
            if not _assignment_editors[ticket_id]:
                del _assignment_editors[ticket_id]


def get_assignment_editors() -> dict:
    """Return the full editor attribution map: ticket_id -> {field: {session_id, label, color}}."""
    with _lock:
        return {k: {f: dict(v) for f, v in fields.items()}
                for k, fields in _assignment_editors.items()}


# ── Poll timer sync ──────────────────────────────────────────────────────────

def set_next_poll(epoch_ms: int) -> None:
    global _next_poll_epoch_ms
    with _lock:
        _next_poll_epoch_ms = int(epoch_ms)


def get_next_poll() -> int:
    with _lock:
        return _next_poll_epoch_ms


# ── Validation toggle sync ────────────────────────────────────────────────────

def set_validation_toggle(on: bool) -> None:
    global _validation_toggle_on
    with _lock:
        _validation_toggle_on = on


def is_validation_toggle_on() -> bool:
    with _lock:
        return _validation_toggle_on


# ── Implement-in-progress flag ───────────────────────────────────────────────

def set_implement_in_progress(in_progress: bool) -> None:
    global _implement_in_progress
    with _lock:
        _implement_in_progress = in_progress


def is_implement_in_progress() -> bool:
    with _lock:
        return _implement_in_progress


# ── Purge helpers ─────────────────────────────────────────────────────────────

def purge_tickets(ticket_ids: list[str]) -> None:
    """Remove checkbox, assignment, and editor state for the given ticket IDs."""
    with _lock:
        for tid in ticket_ids:
            _checkbox_state.pop(tid, None)
            _assignment_selections.pop(tid, None)
            _assignment_editors.pop(tid, None)


# ── Broadcast helpers ─────────────────────────────────────────────────────────

def broadcast_checkbox(ticket_id: str | None, checked: bool, is_select_all: bool = False) -> None:
    if is_select_all:
        validation_cache.broadcast('checkbox-sync', {
            'select_all': True,
            'checked': checked,
        }, buffer=False)
    else:
        validation_cache.broadcast('checkbox-sync', {
            'ticket_id': ticket_id,
            'checked': checked,
        }, buffer=False)


def broadcast_assignment(ticket_id: str, field: str, value: str,
                         editor_info: dict | None = None) -> None:
    payload = {
        'ticket_id': ticket_id,
        'field': field,
        'value': value,
    }
    if editor_info:
        payload['editor'] = editor_info
    validation_cache.broadcast('assignment-selection-sync', payload, buffer=False)


# ── Ticket header state (server-driven) ──────────────────────────────────────

def compute_and_broadcast_header(ticket_id: str) -> dict:
    """Compute the authoritative header state for *ticket_id* and broadcast it.

    Uses :mod:`ticket_header_rules` (pure computation) with inputs from
    :mod:`recommendation_originals` and the local assignment / editor stores.

    Returns the computed header state dict.
    """
    original = recommendation_originals.get_original(ticket_id) or {}

    with _lock:
        current = dict(_assignment_selections.get(ticket_id, {}))
        editors = {
            f: dict(v)
            for f, v in _assignment_editors.get(ticket_id, {}).items()
        }

    header_state = ticket_header_rules.compute(original, current, editors)
    header_state['ticket_id'] = ticket_id

    validation_cache.broadcast('ticket-header-update', header_state, buffer=False)
    return header_state


def compute_all_headers() -> dict:
    """Compute header states for ALL tickets that have originals stored.

    Returns a dict of ``ticket_id -> header_state``.  Used for sync-state-burst
    replay to late-joining clients.
    """
    all_originals = recommendation_originals.get_all()
    result = {}

    with _lock:
        for ticket_id, original in all_originals.items():
            current = dict(_assignment_selections.get(ticket_id, {}))
            editors = {
                f: dict(v)
                for f, v in _assignment_editors.get(ticket_id, {}).items()
            }
            result[ticket_id] = ticket_header_rules.compute(
                original, current, editors)

    return result


def broadcast_poll_timer(epoch_ms: int) -> None:
    validation_cache.broadcast('poll-timer-sync', {
        'next_poll_at': epoch_ms,
    }, buffer=False)


def broadcast_implement_started(ticket_ids: list[str]) -> None:
    validation_cache.broadcast('implement-started', {
        'ticket_ids': ticket_ids,
    }, buffer=False)


def broadcast_implement_complete(results: list, errors: list, assigned_ids: list[str]) -> None:
    validation_cache.broadcast('implement-complete', {
        'results': results,
        'errors': errors,
        'assigned_ticket_ids': assigned_ids,
    }, buffer=False)