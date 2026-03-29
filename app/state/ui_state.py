"""
Centralised UI state — single source of truth for the three workflow buttons.

Every state mutation calls :func:`button_rules.compute` to obtain the
authoritative button configuration, stores the result, and broadcasts a
``ui-state-update`` SSE event so all connected clients render identical
button states at all times.

**No other module** is permitted to compute button properties.  The only
way to change what a button looks like is to mutate the context variables
in this module and call :func:`recompute`.
"""

import threading
import copy

from app.state import button_rules
from app.state import validation_cache as _vc

_lock = threading.Lock()

# ── Mutable context variables ─────────────────────────────────────────────────
# These are the *inputs* to button_rules.compute().  Every public function in
# this module updates one or more of these, then calls _recompute_and_broadcast().

_ctx = {
    'validation_toggle_on': False,
    'tickets_in_view': 0,
    'recommendations_toggle_on': False,
    'checked_count': 0,
    'total_tickets': 0,
    'user_count': 1,
    'consensus_active': False,
    'consensus_agreed': 0,
    'consensus_required': 0,
    'consensus_unlocked': False,
    'full_assignment_active': False,
    'implement_in_progress': False,
    'user_has_agreed': False,       # placeholder; per-session override at read time
    'recommendation_progress': {
        'visible': False,
        'current': 0,
        'total': 0,
        'current_ticket_id': None,
        'complete_message': None,
    },
}

# The last computed snapshot (output of button_rules.compute).
_snapshot: dict = {}


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def _initial_snapshot() -> dict:
    """Compute the initial snapshot from default context."""
    return button_rules.compute(dict(_ctx))

_snapshot = _initial_snapshot()


# ── Read ──────────────────────────────────────────────────────────────────────

def get_state(session_id: str | None = None) -> dict:
    """Return a deep copy of the current UI state snapshot.

    If *session_id* is provided the ``implement_assignment`` button's tooltip
    is personalised for that user's consensus vote status.
    """
    with _lock:
        snap = copy.deepcopy(_snapshot)

    # Per-session tooltip override for consensus mode
    if session_id is not None:
        _apply_per_session_consensus(snap, session_id)

    return snap


def get_context() -> dict:
    """Return a deep copy of the raw context (for debugging / tests)."""
    with _lock:
        return dict(_ctx)


# ── Core recompute + broadcast ────────────────────────────────────────────────

def _recompute_and_broadcast() -> dict:
    """Recompute the snapshot from the current context and broadcast.

    MUST be called while ``_lock`` is already held.
    """
    global _snapshot
    _snapshot = button_rules.compute(dict(_ctx))
    snap = copy.deepcopy(_snapshot)
    # Release lock before broadcasting (broadcast acquires its own lock)
    return snap


def _broadcast(snap: dict) -> None:
    """Push the snapshot to every connected SSE client."""
    _vc.broadcast('ui-state-update', snap, buffer=False)


def recompute() -> dict:
    """Public recompute + broadcast.  Use when external state has changed."""
    with _lock:
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


# ── Context mutators ──────────────────────────────────────────────────────────
# Each mutator updates one or more context keys, recomputes, and broadcasts.

def set_validation_toggle(on: bool) -> dict:
    """Toggle the 'Get validation tickets' button on or off."""
    with _lock:
        _ctx['validation_toggle_on'] = on
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def set_tickets_in_view(count: int) -> dict:
    """Update the number of tickets currently displayed."""
    with _lock:
        _ctx['tickets_in_view'] = count
        _ctx['total_tickets'] = count
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def set_recommendations_toggle(on: bool) -> dict:
    """Toggle the 'Get recommendations' button on or off."""
    with _lock:
        _ctx['recommendations_toggle_on'] = on
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def set_checkbox_counts(checked: int, total: int) -> dict:
    """Update checkbox selection counts and recompute."""
    with _lock:
        _ctx['checked_count'] = checked
        _ctx['total_tickets'] = total
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def set_user_count(count: int) -> dict:
    """Update the number of active presence sessions."""
    with _lock:
        _ctx['user_count'] = count
        # If only 1 user remains, consensus is not possible
        if count <= 1:
            _ctx['consensus_active'] = False
            _ctx['consensus_agreed'] = 0
            _ctx['consensus_required'] = 0
            _ctx['consensus_unlocked'] = False
            _ctx['full_assignment_active'] = False
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def set_consensus_state(*, active: bool, agreed: int, required: int,
                        unlocked: bool, full_assignment_active: bool | None = None) -> dict:
    """Update consensus-related context variables."""
    with _lock:
        _ctx['consensus_active'] = active
        _ctx['consensus_agreed'] = agreed
        _ctx['consensus_required'] = required
        _ctx['consensus_unlocked'] = unlocked
        if full_assignment_active is not None:
            _ctx['full_assignment_active'] = full_assignment_active
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def set_implement_in_progress(in_progress: bool) -> dict:
    """Mark implement-assignment as in-progress or complete."""
    with _lock:
        _ctx['implement_in_progress'] = in_progress
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


def update_recommendation_progress(current: int, total: int,
                                   ticket_id: str | None = None) -> None:
    """Update the recommendation progress indicator.

    Called frequently (once per ticket) so it updates the context but does
    NOT broadcast the full state — the existing recommendation-start /
    recommendation-progress SSE events handle per-ticket updates.  The
    context is kept in sync for late-joining clients.
    """
    with _lock:
        prog = _ctx['recommendation_progress']
        prog['visible'] = True
        prog['current'] = current
        prog['total'] = total
        prog['current_ticket_id'] = ticket_id


def set_recommendation_complete(total: int) -> dict:
    """Mark recommendation processing as complete.

    Sets ``complete_message`` so the current broadcast carries the completion
    indicator, then immediately clears it so subsequent broadcasts (triggered
    by unrelated state changes like presence heartbeats) do not re-trigger
    the completion animation on connected clients.
    """
    with _lock:
        prog = _ctx['recommendation_progress']
        prog['visible'] = False
        prog['complete_message'] = f'{total} recommendations complete'
        snap = _recompute_and_broadcast()
        # Clear the one-shot complete_message so it doesn't persist
        prog['complete_message'] = None
    _broadcast(snap)
    return snap


def reset() -> dict:
    """Reset all context to defaults (e.g. when leaving multi-ticket mode)."""
    with _lock:
        _ctx.update({
            'validation_toggle_on': False,
            'tickets_in_view': 0,
            'recommendations_toggle_on': False,
            'checked_count': 0,
            'total_tickets': 0,
            'user_count': _ctx.get('user_count', 1),  # preserve presence count
            'consensus_active': False,
            'consensus_agreed': 0,
            'consensus_required': 0,
            'consensus_unlocked': False,
            'full_assignment_active': False,
            'implement_in_progress': False,
            'user_has_agreed': False,
            'recommendation_progress': {
                'visible': False,
                'current': 0,
                'total': 0,
                'current_ticket_id': None,
                'complete_message': None,
            },
        })
        snap = _recompute_and_broadcast()
    _broadcast(snap)
    return snap


# ── Per-session consensus tooltip helper ──────────────────────────────────────

def _apply_per_session_consensus(snap: dict, session_id: str) -> None:
    """Adjust the implement button tooltip based on whether *session_id* has
    voted in the current consensus round.

    This is called at read-time (get_state) so the broadcast snapshot stays
    generic while each client's initial-state fetch gets a personalised tooltip.
    """
    from app.state import consensus_state as _cs

    imp = snap.get('buttons', {}).get('implement_assignment', {})
    if imp.get('mode') != 'consensus':
        return

    cs = _cs.get_state()
    agreed_list = cs.get('agreed', [])
    has_agreed = session_id in agreed_list

    if has_agreed:
        imp['tooltip'] = 'You voted to agree on bulk ticket assignment'
        imp['style'] = 'consensus-on'
    else:
        imp['tooltip'] = 'You have not yet agreed on bulk ticket assignment'
        imp['style'] = 'consensus-off'
