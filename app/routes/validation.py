"""
Validation ticket routes — broadcast, check, and hydrate.

/api/trigger-validation-load        (POST, shared broadcast trigger)
/api/validation-broadcast           (GET, long-lived SSE)
/api/check-validation-tickets       (GET, polling diff)
/api/get-single-validation-ticket   (GET, single ticket hydration)
"""

import json
import threading
import concurrent.futures
import queue as _queue_module
import uuid

from flask import Blueprint, request, jsonify, current_app

from services.athena import Athena
from services.output import Output

from app.config import DEBUG, VALIDATION_FETCH_MAX_WORKERS, VALIDATION_FETCH_TOTAL_TIMEOUT
from app.logic.ticket_format import format_validation_ticket
from app.state import validation_cache
from app.state import recommendation_state
from app.state import sync_state
from app.state import ui_state

validation_bp = Blueprint('validation', __name__)


# ── Shared broadcast trigger ──────────────────────────────────────────────────

@validation_bp.route('/api/trigger-validation-load', methods=['POST'])
def api_trigger_validation_load():
    state = validation_cache.get_state()

    if state == 'loading':
        return jsonify({'status': 'loading'})

    if validation_cache.is_cache_fresh():
        return jsonify({
            'status': 'already_loaded',
            'count': validation_cache.get_ticket_count(),
        })

    # Transition to loading and start background fetch
    validation_cache.set_loading()
    validation_cache.broadcast('state', {'state': 'loading'}, buffer=False)
    # ui_state is recomputed via button_rules when tickets_in_view changes
    threading.Thread(target=_do_validation_fetch, daemon=True).start()

    if DEBUG:
        output = Output()
        output.add_line('api_trigger_validation_load: started background fetch')

    return jsonify({'status': 'loading_started'})


# ── Long-lived SSE broadcast ─────────────────────────────────────────────────

@validation_bp.route('/api/validation-broadcast', methods=['GET'])
def api_validation_broadcast():
    session_id = request.args.get('session_id', '').strip()
    if not session_id:
        session_id = str(uuid.uuid4())

    client_queue, current_state, load_buffer_snapshot, cached_tickets = \
        validation_cache.register_client(session_id)

    def generate():
        try:
            # ── Initial state burst ───────────────────────────────────────
            if current_state == 'loaded' and cached_tickets:
                yield f"event: state\ndata: {json.dumps({'state': 'loaded'})}\n\n"
                yield f"event: count\ndata: {json.dumps({'count': len(cached_tickets)})}\n\n"
                for ticket in cached_tickets:
                    yield f"event: ticket\ndata: {json.dumps(ticket)}\n\n"
                yield f"event: complete\ndata: {json.dumps({'count': len(cached_tickets)})}\n\n"

                # Replay recommendation state
                rec_cache = recommendation_state.get_cache()
                rec_toggle = recommendation_state.is_active()
                rec_error_count = recommendation_state.get_error_count()
                yield f"event: recommendation-toggle\ndata: {json.dumps({'active': rec_toggle})}\n\n"
                for tid, rec_data in rec_cache.items():
                    yield f"event: recommendation-complete\ndata: {json.dumps({'ticket_id': tid, 'data': rec_data})}\n\n"
                if rec_cache or rec_error_count:
                    yield f"event: recommendation-progress\ndata: {json.dumps({'completed': len(rec_cache) + rec_error_count, 'total': len(cached_tickets)})}\n\n"

                # Replay sync state
                sync_checkboxes = sync_state.get_checkbox_state()
                sync_assignments = sync_state.get_assignment_selections()
                sync_editors = sync_state.get_assignment_editors()
                sync_next_poll = sync_state.get_next_poll()
                if sync_checkboxes or sync_editors:
                    yield f"event: sync-state-burst\ndata: {json.dumps({'checkboxes': sync_checkboxes, 'assignments': sync_assignments, 'editors': sync_editors, 'next_poll_at': sync_next_poll})}\n\n"

            elif current_state == 'loading':
                yield f"event: state\ndata: {json.dumps({'state': 'loading'})}\n\n"
                for msg in load_buffer_snapshot:
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'])}\n\n"
            else:
                yield f"event: state\ndata: {json.dumps({'state': 'idle'})}\n\n"

            # Always replay centralised UI state for the three workflow buttons
            # (sent after the if/elif/else so it applies regardless of cache state)
            # Use session_id for per-session consensus tooltip personalisation
            yield f"event: ui-state-update\ndata: {json.dumps(ui_state.get_state(session_id=session_id))}\n\n"

            # ── Relay broadcast events ────────────────────────────────────
            while True:
                try:
                    msg = client_queue.get(timeout=10)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'])}\n\n"
                except _queue_module.Empty:
                    yield ': keepalive\n\n'

        finally:
            validation_cache.unregister_client(session_id, client_queue)
            if DEBUG:
                output = Output()
                output.add_line(f'api_validation_broadcast: client {session_id[:8]}… disconnected')

    return current_app.response_class(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


# ── Polling diff ──────────────────────────────────────────────────────────────

@validation_bp.route('/api/check-validation-tickets', methods=['GET'])
def api_check_validation_tickets():
    output = Output()
    ids_param = request.args.get('ids', '').strip()
    displayed_ids = set(
        i.strip() for i in ids_param.split(',') if i.strip()
    ) if ids_param else set()

    try:
        athena = Athena()
        current_ids = athena.get_validation_tickets()
        if current_ids is None:
            return jsonify({'error': 'Failed to fetch validation tickets from Athena'}), 500

        current_set = set(current_ids)
        left_queue = list(displayed_ids - current_set)
        new_in_queue = list(current_set - displayed_ids)

        result = {
            'still_in_queue': list(displayed_ids & current_set),
            'left_queue': left_queue,
            'new_in_queue': new_in_queue,
        }

        # Purge caches for tickets that left
        if left_queue:
            recommendation_state.purge_tickets(left_queue)
            sync_state.purge_tickets(left_queue)
            if DEBUG:
                output.add_line(
                    f"check-validation-tickets: purged {len(left_queue)} "
                    f"ticket(s) that left the queue"
                )

        # Auto-queue recommendations for new tickets if toggle is ON
        if new_in_queue and recommendation_state.is_active():
            recommendation_state.queue_for_tickets(new_in_queue)
            if DEBUG:
                output.add_line(
                    f"check-validation-tickets: auto-queued {len(new_in_queue)} "
                    f"new ticket(s) for recommendations"
                )

        if DEBUG:
            output.add_line(
                f"check-validation-tickets: displayed={len(displayed_ids)}, "
                f"left={len(left_queue)}, new={len(new_in_queue)}"
            )

        return jsonify(result)

    except Exception as e:
        output.add_line(f"Error in api_check_validation_tickets: {e}")
        return jsonify({'error': str(e)}), 500


# ── Single ticket hydration ──────────────────────────────────────────────────

@validation_bp.route('/api/get-single-validation-ticket', methods=['GET'])
def api_get_single_validation_ticket():
    output = Output()
    ticket_id = request.args.get('id', '').strip()

    if not ticket_id:
        return jsonify({'error': 'Missing id parameter'}), 400

    try:
        athena = Athena()
        ticket_data = athena.get_ticket_data(ticket_number=ticket_id, view=True)

        if not ticket_data or 'result' not in ticket_data or not ticket_data['result']:
            return jsonify({'error': f'Could not retrieve ticket {ticket_id}'}), 404

        vt = format_validation_ticket(ticket_data['result'][0], 0)
        # Remove the index field — the caller assigns its own
        vt.pop('index', None)
        return jsonify(vt)

    except Exception as e:
        output.add_line(f"Error in api_get_single_validation_ticket: {e}")
        return jsonify({'error': str(e)}), 500


# ── Background fetch (runs in a daemon thread) ───────────────────────────────

def _do_validation_fetch() -> None:
    """
    Fetch all validation tickets from Athena in parallel and broadcast
    each one to every connected client as it arrives.
    """
    output = Output()

    def _fetch_one(args):
        index, ticket_id = args
        try:
            a = Athena()
            ticket_data = a.get_ticket_data(ticket_number=ticket_id, view=True)
            if ticket_data and ticket_data.get('result'):
                return (index, ticket_id, ticket_data['result'][0], None)
            return (index, ticket_id, None, 'Failed to fetch ticket data')
        except Exception as exc:
            return (index, ticket_id, None, str(exc))

    try:
        athena = Athena()
        ticket_ids = athena.get_validation_tickets()

        if not ticket_ids:
            validation_cache.set_idle()
            validation_cache.broadcast('count', {'count': 0})
            validation_cache.broadcast('complete', {'message': 'No validation tickets found', 'count': 0})
            ui_state.set_tickets_in_view(0)
            if DEBUG:
                output.add_line('_do_validation_fetch: no tickets found')
            return

        total = len(ticket_ids)
        if DEBUG:
            output.add_line(
                f'_do_validation_fetch: fetching {total} tickets '
                f'(parallel, {VALIDATION_FETCH_MAX_WORKERS} workers)'
            )

        validation_cache.broadcast('count', {'count': total})

        fetched: list = []
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=VALIDATION_FETCH_MAX_WORKERS)
        future_to_args = {
            executor.submit(_fetch_one, (i, tid)): (i, tid)
            for i, tid in enumerate(ticket_ids)
        }

        try:
            for future in concurrent.futures.as_completed(
                    future_to_args, timeout=VALIDATION_FETCH_TOTAL_TIMEOUT):
                i, tid = future_to_args[future]
                try:
                    index, ticket_id, ticket, err = future.result()
                    if ticket:
                        vt = format_validation_ticket(ticket, index)
                        fetched.append(vt)
                        validation_cache.broadcast('ticket', vt)
                        if DEBUG:
                            output.add_line(f'_do_validation_fetch: broadcast ticket {ticket_id} (index {index})')
                    else:
                        validation_cache.broadcast('error', {
                            'index': index, 'ticket_id': ticket_id,
                            'message': err or 'Failed to fetch ticket data',
                        })
                except Exception as exc:
                    validation_cache.broadcast('error', {
                        'index': i, 'ticket_id': tid, 'message': str(exc),
                    })

        except concurrent.futures.TimeoutError:
            for future, (i, tid) in future_to_args.items():
                if not future.done():
                    output.add_line(f'_do_validation_fetch: timeout waiting for ticket {tid}')
                    validation_cache.broadcast('error', {
                        'index': i, 'ticket_id': tid,
                        'message': 'Timeout: Athena did not respond in time',
                    })

        finally:
            executor.shutdown(wait=False)

        validation_cache.set_loaded(fetched)
        validation_cache.broadcast('complete', {'count': len(fetched)})
        # Update tickets_in_view so button_rules recomputes all buttons
        ui_state.set_tickets_in_view(len(fetched))

        if DEBUG:
            output.add_line(f'_do_validation_fetch: complete, {len(fetched)} tickets cached')

    except Exception as e:
        output.add_line(f'_do_validation_fetch: fatal error: {e}')
        validation_cache.set_idle()
        validation_cache.broadcast('error', {'message': str(e)})
        ui_state.set_tickets_in_view(0)