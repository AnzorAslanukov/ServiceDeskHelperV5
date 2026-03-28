"""
Centralised UI state — single source of truth for the three workflow buttons.

Stores the visual properties (label, disabled, style, tooltip) of:
  1. Get validation tickets
  2. Get ticket recommendations
  3. Implement ticket assignment

Every state mutation broadcasts a ``ui-state-update`` SSE event so all
connected clients render identical button states at all times.
"""

import threading
import copy

from app.state import validation_cache as _vc

_lock = threading.Lock()

# ── Default state ─────────────────────────────────────────────────────────────

def _default_state() -> dict:
    return {
        'workflow_phase': 'idle',

        'buttons': {
            'get_validation_tickets': {
                'disabled': False,
                'label': 'Get validation tickets',
                'style': 'primary',       # primary | loading | locked
            },
            'get_recommendations': {
                'disabled': True,
                'label': 'Get ticket recommendations',
                'style': 'disabled',      # disabled | toggle-off | toggle-on | loading
            },
            'implement_assignment': {
                'disabled': True,
                'label': 'Implement ticket assignment',
                'style': 'secondary',     # secondary | success | consensus | loading
            },
        },

        'recommendation_toggle_active': False,

        'recommendation_progress': {
            'visible': False,
            'current': 0,
            'total': 0,
            'current_ticket_id': None,
            'complete_message': None,
        },
    }


_state: dict = _default_state()


# ── Read ──────────────────────────────────────────────────────────────────────

def get_state() -> dict:
    """Return a deep copy of the current UI state."""
    with _lock:
        return copy.deepcopy(_state)


# ── Broadcast helper ──────────────────────────────────────────────────────────

def _broadcast() -> None:
    """Push the current state snapshot to every connected SSE client."""
    snapshot = get_state()
    _vc.broadcast('ui-state-update', snapshot, buffer=False)


# ── Workflow transitions ──────────────────────────────────────────────────────

def set_idle() -> dict:
    """Reset to the initial idle state."""
    with _lock:
        _state.update(_default_state())
    _broadcast()
    return get_state()


def set_tickets_loading() -> dict:
    """Transition: user clicked *Get validation tickets*."""
    with _lock:
        _state['workflow_phase'] = 'tickets-loading'

        btn = _state['buttons']['get_validation_tickets']
        btn['disabled'] = True
        btn['label'] = 'Loading...'
        btn['style'] = 'loading'

        rec = _state['buttons']['get_recommendations']
        rec['disabled'] = True
        rec['label'] = 'Get ticket recommendations'
        rec['style'] = 'disabled'

        imp = _state['buttons']['implement_assignment']
        imp['disabled'] = True
        imp['label'] = 'Implement ticket assignment'
        imp['style'] = 'secondary'

        _state['recommendation_toggle_active'] = False
        _state['recommendation_progress'] = {
            'visible': False, 'current': 0, 'total': 0,
            'current_ticket_id': None, 'complete_message': None,
        }

    _broadcast()
    return get_state()


def set_tickets_loaded(total_tickets: int = 0) -> dict:
    """Transition: all validation tickets have been fetched."""
    with _lock:
        _state['workflow_phase'] = 'tickets-loaded'

        btn = _state['buttons']['get_validation_tickets']
        btn['disabled'] = True
        btn['label'] = 'Get validation tickets'
        btn['style'] = 'locked'

        rec = _state['buttons']['get_recommendations']
        rec['disabled'] = False
        rec['label'] = 'Get ticket recommendations'
        rec['style'] = 'toggle-off'

        imp = _state['buttons']['implement_assignment']
        imp['disabled'] = True
        imp['label'] = 'Implement ticket assignment'
        imp['style'] = 'secondary'

        _state['recommendation_toggle_active'] = False

    _broadcast()
    return get_state()


def set_recommendations_loading() -> dict:
    """Transition: recommendation engine toggled ON."""
    with _lock:
        _state['workflow_phase'] = 'recommendations-loading'

        btn = _state['buttons']['get_validation_tickets']
        btn['disabled'] = True
        btn['label'] = 'Get validation tickets'
        btn['style'] = 'locked'

        rec = _state['buttons']['get_recommendations']
        rec['disabled'] = False
        rec['label'] = 'Processing...'
        rec['style'] = 'toggle-on'

        imp = _state['buttons']['implement_assignment']
        imp['disabled'] = True
        imp['label'] = 'Implement ticket assignment'
        imp['style'] = 'secondary'

        _state['recommendation_toggle_active'] = True

    _broadcast()
    return get_state()


def set_recommendations_complete(total: int = 0) -> dict:
    """Transition: all recommendations finished."""
    with _lock:
        _state['workflow_phase'] = 'recommendations-complete'

        btn = _state['buttons']['get_validation_tickets']
        btn['disabled'] = True
        btn['label'] = 'Get validation tickets'
        btn['style'] = 'locked'

        rec = _state['buttons']['get_recommendations']
        rec['disabled'] = False
        rec['label'] = 'Get ticket recommendations'
        rec['style'] = 'toggle-on'

        imp = _state['buttons']['implement_assignment']
        imp['disabled'] = False
        imp['label'] = 'Implement ticket assignment'
        imp['style'] = 'success'

        _state['recommendation_toggle_active'] = True

        prog = _state['recommendation_progress']
        prog['visible'] = False
        prog['complete_message'] = f'{total} recommendations complete'

    _broadcast()
    return get_state()


def set_recommendations_toggled_off() -> dict:
    """Transition: recommendation engine toggled OFF.

    If some recommendations already exist the implement button stays enabled;
    otherwise we fall back to tickets-loaded.
    """
    with _lock:
        _state['recommendation_toggle_active'] = False

        rec = _state['buttons']['get_recommendations']
        rec['disabled'] = False
        rec['label'] = 'Get ticket recommendations'
        rec['style'] = 'toggle-off'

        prog = _state['recommendation_progress']
        prog['visible'] = False
        prog['current_ticket_id'] = None

        # Determine whether any recommendations exist.
        # The caller should set the phase appropriately, but we provide a
        # sensible default: keep 'recommendations-complete' if we were there,
        # otherwise fall back to 'tickets-loaded'.
        if _state['workflow_phase'] == 'recommendations-complete':
            # Keep implement button enabled
            pass
        elif _state['workflow_phase'] == 'recommendations-loading':
            # Check if any recommendations were completed before toggle-off.
            # The caller can override this by calling set_recommendations_complete
            # or set_tickets_loaded afterwards.  For now, check the progress.
            if _state['recommendation_progress']['current'] > 0:
                _state['workflow_phase'] = 'recommendations-complete'
                imp = _state['buttons']['implement_assignment']
                imp['disabled'] = False
                imp['label'] = 'Implement ticket assignment'
                imp['style'] = 'success'
            else:
                _state['workflow_phase'] = 'tickets-loaded'
                imp = _state['buttons']['implement_assignment']
                imp['disabled'] = True
                imp['label'] = 'Implement ticket assignment'
                imp['style'] = 'secondary'

    _broadcast()
    return get_state()


def set_implement_in_progress(ticket_ids: list[str] | None = None) -> dict:
    """Transition: implement assignment started."""
    with _lock:
        imp = _state['buttons']['implement_assignment']
        imp['disabled'] = True
        imp['label'] = 'Assigning...'
        imp['style'] = 'loading'

    _broadcast()
    return get_state()


def set_implement_complete() -> dict:
    """Transition: implement assignment finished.

    Re-enables the implement button (the frontend will refresh the label
    based on remaining checkbox selection).
    """
    with _lock:
        imp = _state['buttons']['implement_assignment']
        imp['disabled'] = False
        imp['label'] = 'Implement ticket assignment'
        imp['style'] = 'success'

    _broadcast()
    return get_state()


# ── Recommendation progress (high-frequency, targeted update) ─────────────────

def update_recommendation_progress(current: int, total: int,
                                   ticket_id: str | None = None) -> None:
    """Update the recommendation progress indicator.

    This is called frequently (once per ticket) so it broadcasts a smaller
    targeted event rather than the full state dict.
    """
    with _lock:
        prog = _state['recommendation_progress']
        prog['visible'] = True
        prog['current'] = current
        prog['total'] = total
        prog['current_ticket_id'] = ticket_id

    # Don't broadcast full state — the existing recommendation-start /
    # recommendation-progress SSE events handle this.  We just keep the
    # server-side dict in sync for late-joining clients.


# ── Implement button label (selection-dependent) ─────────────────────────────

def update_implement_label(selected: int, total: int) -> None:
    """Update the implement button label based on checkbox selection.

    Called from the sync-checkbox route so the server always knows the
    correct label.  Broadcasts the full state.
    """
    with _lock:
        imp = _state['buttons']['implement_assignment']
        if not imp['disabled'] or imp['style'] == 'success':
            if selected == 0:
                imp['disabled'] = True
                imp['label'] = 'Implement ticket assignment'
                imp['style'] = 'secondary'
            elif selected < total:
                imp['disabled'] = False
                imp['label'] = f'Implement {selected}/{total} ticket assignment'
                imp['style'] = 'success'
            else:
                imp['disabled'] = False
                imp['label'] = 'Implement ticket assignment'
                imp['style'] = 'success'

    _broadcast()