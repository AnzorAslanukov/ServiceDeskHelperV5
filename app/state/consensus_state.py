"""
Consensus-based implement button state.

When multiple users are present and more than CONSENSUS_TICKET_THRESHOLD
tickets are selected, all users must agree before the implement button
is unlocked (full assignment mode).

This module tracks:
  • Whether consensus mode is active
  • Which sessions have voted to agree
  • Whether full assignment has been achieved (all agreed)
  • The set of ticket IDs that were checked when consensus was achieved
    (used to detect new checkbox checks that should revert to consensus)
"""

import threading

from app.config import CONSENSUS_TICKET_THRESHOLD
from app.state import presence as presence_state
from app.state import validation_cache

_lock = threading.Lock()
_active: bool = False
_votes: set = set()                    # session_ids that have agreed
_full_assignment_active: bool = False  # consensus was achieved → full assignment
_consensus_checked_ids: set = set()    # ticket IDs checked when consensus was achieved


# ── Public accessors ──────────────────────────────────────────────────────────

def is_active() -> bool:
    with _lock:
        return _active


def is_full_assignment_active() -> bool:
    with _lock:
        return _full_assignment_active


def get_consensus_checked_ids() -> set:
    """Return the set of ticket IDs that were checked when consensus was achieved."""
    with _lock:
        return set(_consensus_checked_ids)


def get_state() -> dict:
    """
    Build and return the current consensus state dict.

    Returns:
        ``{active, agreed, required, unlocked, full_assignment_active}``
    """
    active_count = presence_state.get_active_count()
    with _lock:
        return {
            'active': _active,
            'agreed': list(_votes),
            'required': active_count,
            'unlocked': _active and active_count > 0 and len(_votes) >= active_count,
            'full_assignment_active': _full_assignment_active,
        }


def activate(checked_ticket_ids: set | None = None) -> dict:
    """Activate consensus mode. Clears any previous votes and full assignment."""
    global _active, _full_assignment_active
    with _lock:
        if not _active:
            _active = True
            _votes.clear()
            _full_assignment_active = False
            _consensus_checked_ids.clear()
    return get_state()


def deactivate() -> dict:
    """Deactivate consensus mode and clear all votes and full assignment."""
    global _active, _full_assignment_active
    with _lock:
        _active = False
        _votes.clear()
        _full_assignment_active = False
        _consensus_checked_ids.clear()
    return get_state()


def vote(session_id: str, agree: bool) -> dict:
    """Record or remove a user's agreement vote.

    If all users have agreed after this vote, transitions to full assignment
    mode and records the currently checked ticket IDs.
    """
    global _full_assignment_active
    active_count = presence_state.get_active_count()

    with _lock:
        if not _active:
            return get_state()
        if agree:
            _votes.add(session_id)
        else:
            _votes.discard(session_id)

        # Check if consensus has been achieved
        if len(_votes) >= active_count and active_count > 0:
            _full_assignment_active = True
            # Record the checked IDs at the moment of consensus achievement
            # (caller should provide these via set_consensus_checked_ids before
            # or the sync route will set them)

    return get_state()


def set_consensus_checked_ids(ticket_ids: set) -> None:
    """Record the ticket IDs that were checked when consensus was achieved."""
    with _lock:
        _consensus_checked_ids.clear()
        _consensus_checked_ids.update(ticket_ids)


def check_new_checkbox(new_ticket_id: str) -> bool:
    """Check if a newly checked ticket ID was NOT in the original consensus set.

    Returns True if the ticket is new (consensus should be revoked), False
    if it was part of the original set (no action needed).

    Only meaningful when full_assignment_active is True.
    """
    with _lock:
        if not _full_assignment_active:
            return False
        return new_ticket_id not in _consensus_checked_ids


def revoke_full_assignment_new_checkbox() -> dict:
    """Revert from full assignment to consensus mode because a new checkbox
    was checked that wasn't in the original consensus set.

    ALL votes are reset — everyone must re-vote.
    """
    global _full_assignment_active
    with _lock:
        _full_assignment_active = False
        _votes.clear()
        _consensus_checked_ids.clear()
        # _active stays True — we're still in consensus mode, just reset votes
    return get_state()


def revoke_full_assignment_disagree(session_id: str) -> dict:
    """Revert from full assignment to consensus mode because a user clicked
    the disagree button in the banner.

    Only the disagreeing user's vote is removed — other votes are preserved.
    """
    global _full_assignment_active
    with _lock:
        _full_assignment_active = False
        _votes.discard(session_id)
        # _active stays True — we're still in consensus mode
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
    global _active, _full_assignment_active

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
            _full_assignment_active = False
            _consensus_checked_ids.clear()

    broadcast_state()


def reset_after_implement() -> dict:
    """Reset consensus state after tickets have been successfully assigned."""
    global _active, _full_assignment_active
    with _lock:
        _active = False
        _votes.clear()
        _full_assignment_active = False
        _consensus_checked_ids.clear()
    return get_state()