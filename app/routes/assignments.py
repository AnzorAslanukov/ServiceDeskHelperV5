"""
Assignment implementation route.

/api/implement-assignments  (POST)
"""

from flask import Blueprint, request, jsonify

from services.athena import Athena
from services.output import Output

from app.config import DEBUG
from app.state import recommendation_state
from app.state import sync_state

assignments_bp = Blueprint('assignments', __name__)


@assignments_bp.route('/api/implement-assignments', methods=['POST'])
def api_implement_assignments():
    """
    Implement ticket assignments in Athena based on AI recommendations.

    Handles two assignment types:
      - Normal tickets: assign to a support group and optionally update priority.
      - Facilities tickets: resolve with a resolution comment.

    After processing, successfully assigned ticket IDs are purged from all
    server-side caches and an ``implement-complete`` SSE event is broadcast.
    """
    output = Output()

    try:
        data = request.get_json()

        if not data or 'assignments' not in data:
            return jsonify({'error': 'Missing assignments data'}), 400

        assignments = data['assignments']
        if not isinstance(assignments, list) or len(assignments) == 0:
            return jsonify({'error': 'Assignments must be a non-empty list'}), 400

        if DEBUG:
            output.add_line(f"Starting batch assignment for {len(assignments)} tickets")

        # Broadcast implement-started
        ticket_ids = [a.get('ticket_id', '') for a in assignments]
        sync_state.set_implement_in_progress(True)
        sync_state.broadcast_implement_started(ticket_ids)

        athena = Athena()
        results = []
        errors = []

        for assignment in assignments:
            ticket_id = assignment.get('ticket_id')
            support_group = assignment.get('support_group')
            priority = assignment.get('priority')
            status = assignment.get('status')
            resolution_comment = assignment.get('resolution_comment')

            if not ticket_id:
                results.append({
                    'ticket_id': ticket_id or 'unknown',
                    'success': False,
                    'support_group': support_group,
                    'message': 'Missing ticket_id',
                })
                continue

            # ── Facilities ticket — resolve ───────────────────────────────
            if status and status.lower() == 'resolved':
                if not resolution_comment:
                    results.append({
                        'ticket_id': ticket_id,
                        'success': False,
                        'support_group': None,
                        'message': 'Missing resolution_comment for resolved status',
                    })
                    continue

                try:
                    if DEBUG:
                        output.add_line(f"Resolving facilities ticket {ticket_id}")

                    athena.modify_ticket(
                        ticket_id=ticket_id,
                        status='resolved',
                        resolution_comment=resolution_comment,
                    )
                    results.append({
                        'ticket_id': ticket_id,
                        'success': True,
                        'support_group': 'Facilities (resolved)',
                        'message': 'Successfully resolved with comment',
                    })
                except Exception as e:
                    results.append({
                        'ticket_id': ticket_id,
                        'success': False,
                        'support_group': None,
                        'message': f'Error: {e}',
                    })
                    errors.append(f"Ticket {ticket_id}: {e}")
                continue

            # ── Normal ticket — assign support group ──────────────────────
            if not support_group:
                results.append({
                    'ticket_id': ticket_id,
                    'success': False,
                    'support_group': None,
                    'message': 'Missing support_group',
                })
                continue

            try:
                if DEBUG:
                    output.add_line(f"Assigning ticket {ticket_id} to: {support_group}")

                athena.modify_ticket(
                    ticket_id=ticket_id,
                    username=None,
                    priority=priority,
                    support_group=support_group,
                )
                results.append({
                    'ticket_id': ticket_id,
                    'success': True,
                    'support_group': support_group,
                    'message': f'Successfully assigned to {support_group}',
                })
            except Exception as e:
                results.append({
                    'ticket_id': ticket_id,
                    'success': False,
                    'support_group': support_group,
                    'message': f'Error: {e}',
                })
                errors.append(f"Ticket {ticket_id}: {e}")

        # ── Purge successfully assigned tickets from caches ───────────────
        assigned_ids = [r['ticket_id'] for r in results if r['success']]

        if assigned_ids:
            recommendation_state.purge_tickets(assigned_ids)
            sync_state.purge_tickets(assigned_ids)

        if DEBUG:
            output.add_line(
                f"Batch assignment complete: {len(assigned_ids)}/{len(results)} successful"
            )

        # ── Broadcast implement-complete ──────────────────────────────────
        sync_state.set_implement_in_progress(False)
        sync_state.broadcast_implement_complete(results, errors, assigned_ids)

        return jsonify({
            'results': results,
            'errors': errors,
            'assigned_ticket_ids': assigned_ids,
        })

    except Exception as e:
        error_msg = f"Error in api_implement_assignments: {e}"
        if DEBUG:
            output.add_line(error_msg)
        sync_state.set_implement_in_progress(False)
        sync_state.broadcast_implement_complete([], [error_msg], [])
        return jsonify({'error': error_msg}), 500