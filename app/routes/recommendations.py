"""
Recommendation engine routes.

/api/toggle-recommendations  (POST)
/api/recommendation-state    (GET)
"""

from flask import Blueprint, request, jsonify

from services.output import Output
from app.config import DEBUG
from app.state import validation_cache
from app.state import recommendation_state
from app.state import ui_state

recommendations_bp = Blueprint('recommendations', __name__)


@recommendations_bp.route('/api/toggle-recommendations', methods=['POST'])
def api_toggle_recommendations():
    """
    Toggle the recommendation engine on or off.

    When toggled ON:  processes all loaded validation tickets without recommendations.
    When toggled OFF: stops submitting new tickets; in-flight ones complete and are cached.

    Request body: ``{"active": true/false}`` (optional — defaults to toggling)
    """
    output = Output()
    data = request.get_json(silent=True) or {}

    if 'active' in data:
        active = bool(data['active'])
    else:
        active = not recommendation_state.is_active()

    recommendation_state.set_active(active)

    # Broadcast toggle state to all clients
    validation_cache.broadcast('recommendation-toggle', {'active': active}, buffer=False)

    if active:
        recommendation_state.clear_errors()
        # Update ui_state via button_rules
        ui_state.set_recommendations_toggle(True)

        loaded_tickets = validation_cache.get_tickets()
        ticket_ids = [t['id'] for t in loaded_tickets]
        ids_queued = recommendation_state.queue_for_tickets(ticket_ids)

        cached_count = recommendation_state.get_cached_count()
        total = len(loaded_tickets)

        validation_cache.broadcast('recommendation-progress', {
            'completed': cached_count,
            'total': total,
        }, buffer=False)

        if DEBUG:
            output.add_line(
                f'toggle-recommendations: ON — {len(ids_queued)} queued, '
                f'{cached_count} cached, {total} total'
            )
    else:
        recommendation_state.signal_stop()
        # Update ui_state via button_rules
        ui_state.set_recommendations_toggle(False)
        if DEBUG:
            output.add_line('toggle-recommendations: OFF — stop event set')

    return jsonify({
        'active': active,
        'cached': recommendation_state.get_cached_count(),
        'total': validation_cache.get_ticket_count(),
        'processing': len(recommendation_state.get_processing_list()),
    })


@recommendations_bp.route('/api/recommendation-state', methods=['GET'])
def api_recommendation_state():
    """
    Return the current recommendation engine state and all cached recommendations.
    Used by clients on page load / reconnect.
    """
    return jsonify({
        'active': recommendation_state.is_active(),
        'cache': recommendation_state.get_cache(),
        'processing': recommendation_state.get_processing_list(),
        'total': validation_cache.get_ticket_count(),
    })