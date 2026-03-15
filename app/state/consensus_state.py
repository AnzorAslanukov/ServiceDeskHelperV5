"""
Consensus-based implement button state.

When multiple users are present and more than CONSENSUS_TICKET_THRESHOLD
tickets are selected, all users must agree before the implement button
is unlocked.
"""

import threading

from app.state import presence as presence_state
from app.state import validation_cache

_lock = threading.Lock()
_active: bool = False
_votes: set = set()  # session_ids that have agreed


# ── Public accessors ──────────────────────────────────────────────────────────

def is_active() -> bool:
    with _lock:
        return _active


def get_state() -> dict:
    """
    Build and return the current consensus state dict.

    Returns:
        ``{active, agreed, required, unlocked}``
    """
    active_count = presence_state.get_active_count()
    with _lock:
        return {
            'active': _active,
            'agreed': list(_votes),
            'required': active_count,
            'unlocked': _active and active_count > 0 and len(_votes) >= active_count,
        }


def activate() -> dict:
    """Activate consensus mode. Clears any previous votes."""
    global _active
    with _lock:
        if not _active:
            _active = True
            _votes.clear()
    return get_state()


def deactivate() -> dict:
    """Deactivate consensus mode and clear all votes."""
    global _active
    with _lock:
        _active = False
        _votes.clear()
    return get_state()


def vote(session_id: str, agree: bool) -> dict:
    """Record or remove a user's agreement vote."""
    with _lock:
        if not _active:
            return get_state()
        if agree:
            _votes.add(session_id)
        else:
            _votes.discard(session_id)
    return get_state()


def broadcast_state() -> None:
    """Broadcast the current consensus state to all connected SSE clients."""
    state = get_state()
    validation_cache.broadcast('consensus-state', state, buffer=False)


def check_after_presence_change() -> None:
    """
    Called after a presence change (session expired, session left, new session).

    - Removes votes from sessions that are no longer active.
    - If only 1 user remains, auto-deactivates consensus.
    - Broadcasts updated state if consensus is active.
    """
    global _active

    active_sids = presence_state.get_active_session_ids()
    active_count = len(active_sids)

    with _lock:
        if not _active:
            return

        # Remove votes from departed sessions
        stale_votes = _votes - active_sids
        if stale_votes:
            _votes -= stale_votes

        # If only 1 (or 0) users remain, consensus is no longer needed
        if active_count <= 1:
            _active = False
            _votes.clear()

    broadcast_state()