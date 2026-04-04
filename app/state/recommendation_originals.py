"""
Original AI recommendation store.

Stores the original AI-recommended values (support group and priority) for
each ticket so that the server can determine whether a user's selection
matches the original or represents a change.

This is the authoritative reference for "what did the AI originally
recommend?" — used by :mod:`ticket_header_rules` to decide whether editor
attribution should be applied or cleared.
"""

import threading

_lock = threading.Lock()
_originals: dict = {}   # ticket_id -> {'support_group': str, 'priority': str}


def set_original(ticket_id: str, support_group: str, priority: str) -> None:
    """Store the original AI recommendation for a ticket."""
    with _lock:
        _originals[ticket_id] = {
            'support_group': support_group or '',
            'priority': priority or '',
        }


def get_original(ticket_id: str) -> dict | None:
    """Return the original recommendation for a ticket, or None if not stored."""
    with _lock:
        entry = _originals.get(ticket_id)
        return dict(entry) if entry else None


def get_all() -> dict:
    """Return a copy of all stored originals."""
    with _lock:
        return {k: dict(v) for k, v in _originals.items()}


def purge_tickets(ticket_ids: list[str]) -> None:
    """Remove stored originals for the given ticket IDs."""
    with _lock:
        for tid in ticket_ids:
            _originals.pop(tid, None)


def clear() -> None:
    """Remove all stored originals."""
    with _lock:
        _originals.clear()