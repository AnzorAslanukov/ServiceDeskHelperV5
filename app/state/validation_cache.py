"""
Shared validation-ticket broadcast state.

Manages the cached list of validation tickets, the loading state, and the
SSE broadcast infrastructure that pushes events to all connected clients.
"""

import threading
import time
import queue as _queue_module

from app.config import VALIDATION_CACHE_TTL

_lock = threading.Lock()
_state: str = 'idle'          # 'idle' | 'loading' | 'loaded'
_tickets: list = []           # cached ticket dicts (set when state == 'loaded')
_fetched_at: float = 0.0
_clients: dict = {}           # session_id -> queue.Queue (one per SSE connection)
_load_buffer: list = []       # events broadcast during the current load session


# ── Public state accessors ────────────────────────────────────────────────────

def get_state() -> str:
    with _lock:
        return _state


def get_tickets() -> list:
    with _lock:
        return list(_tickets)


def get_fetched_at() -> float:
    with _lock:
        return _fetched_at


def get_ticket_count() -> int:
    with _lock:
        return len(_tickets)


def is_cache_fresh() -> bool:
    with _lock:
        return _state == 'loaded' and (time.time() - _fetched_at) < VALIDATION_CACHE_TTL


def set_loading() -> None:
    """Transition to 'loading' state and clear the mid-load buffer."""
    with _lock:
        global _state
        _state = 'loading'
        _load_buffer.clear()


def set_loaded(tickets: list) -> None:
    """Transition to 'loaded' state with the given ticket list."""
    global _state, _tickets, _fetched_at
    with _lock:
        _state = 'loaded'
        _tickets = tickets
        _fetched_at = time.time()


def set_idle() -> None:
    global _state
    with _lock:
        _state = 'idle'


# ── Client (SSE connection) management ────────────────────────────────────────

def register_client(session_id: str) -> _queue_module.Queue:
    """
    Register an SSE client and return its event queue.

    Also returns a snapshot of the current state and load buffer so the
    caller can send the initial burst.
    """
    client_queue: _queue_module.Queue = _queue_module.Queue(maxsize=200)
    with _lock:
        _clients[session_id] = client_queue
        current_state = _state
        load_buffer_snapshot = list(_load_buffer)
        cached_tickets = list(_tickets)
    return client_queue, current_state, load_buffer_snapshot, cached_tickets


def unregister_client(session_id: str, client_queue: _queue_module.Queue) -> None:
    """
    Remove a client queue, but only if it still points to the same object
    (prevents a reconnecting client's new queue from being evicted).
    """
    with _lock:
        if _clients.get(session_id) is client_queue:
            _clients.pop(session_id, None)


# ── Broadcast ─────────────────────────────────────────────────────────────────

def broadcast(event_type: str, data: dict, buffer: bool = True) -> None:
    """
    Push a single SSE event to every connected client.

    When *buffer* is True and the current state is ``'loading'``, the event
    is also appended to ``_load_buffer`` so that clients connecting mid-load
    can replay missed events.
    """
    with _lock:
        if buffer and _state == 'loading':
            _load_buffer.append({'event': event_type, 'data': data})

        dead: list[str] = []
        for sid, q in _clients.items():
            try:
                q.put_nowait({'event': event_type, 'data': data})
            except _queue_module.Full:
                dead.append(sid)
        for sid in dead:
            del _clients[sid]