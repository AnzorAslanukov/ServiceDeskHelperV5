"""
In-memory presence registry.

Tracks which users are currently viewing the validation manager.
Each session is identified by a UUID and has a server-assigned color
and display name.
"""

import threading
import time
from collections import Counter

from app.config import SESSION_EXPIRY_SECONDS, PRESENCE_COLORS

_lock = threading.Lock()
_active_sessions: dict = {}   # session_id -> {last_seen, color, label}
_session_counter: int = 0


def heartbeat(session_id: str, display_name: str | None = None) -> list[dict]:
    """
    Register or refresh a session.  Expires stale sessions first.

    Returns:
        List of all active sessions as ``[{session_id, color, label}, ...]``.
        Also returns a list of stale session IDs that were removed (for
        consensus cleanup).
    """
    global _session_counter
    now = time.time()

    stale_ids: list[str] = []

    with _lock:
        # Expire stale sessions
        stale_ids = [
            sid for sid, info in _active_sessions.items()
            if now - info['last_seen'] > SESSION_EXPIRY_SECONDS
        ]
        for sid in stale_ids:
            del _active_sessions[sid]

        # Register or refresh
        if session_id not in _active_sessions:
            _session_counter += 1
            label = display_name if display_name else f'Viewer {_session_counter}'

            # Assign first unused palette color
            used_colors = [info['color'] for info in _active_sessions.values()]
            assigned_color = None
            for c in PRESENCE_COLORS:
                if c not in used_colors:
                    assigned_color = c
                    break
            if assigned_color is None:
                color_counts = Counter(used_colors)
                assigned_color = min(PRESENCE_COLORS, key=lambda c: color_counts.get(c, 0))

            _active_sessions[session_id] = {
                'last_seen': now,
                'color': assigned_color,
                'label': label,
            }
        else:
            _active_sessions[session_id]['last_seen'] = now
            if display_name:
                _active_sessions[session_id]['label'] = display_name

        sessions = [
            {'session_id': sid, 'color': info['color'], 'label': info['label']}
            for sid, info in _active_sessions.items()
        ]

    return sessions, stale_ids


def leave(session_id: str) -> None:
    """Explicitly remove a session (called on page unload)."""
    with _lock:
        _active_sessions.pop(session_id, None)


def get_active_session_ids() -> set[str]:
    """Return the set of currently active session IDs."""
    with _lock:
        return set(_active_sessions.keys())


def get_active_count() -> int:
    """Return the number of currently active sessions."""
    with _lock:
        return len(_active_sessions)


def get_session_info(session_id: str) -> dict | None:
    """
    Read-only lookup of a session's color and label.
    Returns ``{session_id, color, label}`` or ``None`` if the session is not active.
    Does NOT refresh the session's last_seen timestamp.
    """
    with _lock:
        info = _active_sessions.get(session_id)
        if info is None:
            return None
        return {
            'session_id': session_id,
            'color': info['color'],
            'label': info['label'],
        }
