"""
Ticket advice routes — single-ticket assignment recommendations.

/api/get-ticket-advice       (POST, legacy non-streaming)
/api/get-ticket-advice-stream (GET, SSE streaming with progress)
"""

import json
import concurrent.futures

from flask import Blueprint, request, jsonify, current_app

from services.athena import Athena
from services.databricks import Databricks
from services.keyword_match import KeywordMatch
from services.text_generation_model import TextGenerationModel
from services.prompts import PROMPTS
from services.output import Output

from app.config import DEBUG
from app.logic.search import ticket_vector_search
from app.logic.support_groups import map_eus_to_location_group
from app.logic.ticket_advice import get_ticket_advice, _extract_fields

ticket_advice_bp = Blueprint('ticket_advice', __name__)


@ticket_advice_bp.route('/api/get-ticket-advice', methods=['POST'])
def api_get_ticket_advice():
    data = request.get_json()
    if DEBUG:
        output = Output()
        output.add_line(f"api_get_ticket_advice called with data: {data}")

    if 'ticketId' not in data:
        return jsonify({'error': 'Missing ticketId'}), 400

    ticket_number = data['ticketId']
    if DEBUG:
        output = Output()
        output.add_line(f"Starting get_ticket_advice for {ticket_number}")

    result = get_ticket_advice(ticket_number)

    if DEBUG:
        output = Output()
        output.add_line(f"Finished get_ticket_advice for {ticket_number}")

    if result:
        return jsonify(result)
    else:
        return jsonify({'error': 'Could not retrieve ticket advice'}), 500


@ticket_advice_bp.route('/api/get-ticket-advice-stream', methods=['GET'])
def api_get_ticket_advice_stream():
    """
    Stream ticket advice generation using Server-Sent Events (SSE).
    Provides real-time progress updates during the analysis process.

    Query params:
        ticketId: The ticket number to analyze

    Event types:
        progress: {step, message} — current step update
        complete: Full result data when analysis is finished
        error:    Error message if something goes wrong
    """
    ticket_number = request.args.get('ticketId')

    if not ticket_number:
        def error_stream():
            yield f"event: error\ndata: {json.dumps({'message': 'Missing ticketId parameter'})}\n\n"
        return current_app.response_class(error_stream(), mimetype='text/event-stream')

    def generate():
        output = Output()

        try:
            # Step 1: Fetch original ticket
            yield f"event: progress\ndata: {json.dumps({'step': 1, 'message': 'Fetching ticket data...'})}\n\n"

            athena = Athena()
            original_result = athena.get_ticket_data(ticket_number=ticket_number, view=True)

            if not original_result or not original_result.get('result'):
                yield f"event: error\ndata: {json.dumps({'message': f'Could not retrieve ticket {ticket_number}'})}\n\n"
                return

            original_data = original_result['result'][0]

            if not isinstance(ticket_number, str) or len(ticket_number) < 2:
                yield f"event: error\ndata: {json.dumps({'message': f'Invalid ticket number format: {ticket_number}'})}\n\n"
                return

            # Match support groups
            keyword_matcher = KeywordMatch()
            support_match_result = keyword_matcher.match_support_groups(original_data)
            available_support_groups = (
                support_match_result['location_specific_support']
                + support_match_result['global_support']
            )

            search_text = f"{original_data.get('title', '')} {original_data.get('description', '')}".strip()

            # Step 2 & 3: Parallel search
            yield f"event: progress\ndata: {json.dumps({'step': 2, 'message': 'Finding similar tickets...'})}\n\n"
            yield f"event: progress\ndata: {json.dumps({'step': 3, 'message': 'Searching documentation...'})}\n\n"

            similar_tickets = []
            onenote_docs = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                sim_future = executor.submit(ticket_vector_search, None, original_data, 5)
                onenote_future = executor.submit(
                    lambda: Databricks().semantic_search_onenote(search_text, limit=5)
                )
                try:
                    similar_tickets = sim_future.result(timeout=60)
                    onenote_docs = onenote_future.result(timeout=60)
                except concurrent.futures.TimeoutError:
                    output.add_line("Warning: Parallel operations timed out")
                except Exception as e:
                    output.add_line(f"Warning: Parallel operations failed: {e}")

            # Step 4: AI recommendations
            yield f"event: progress\ndata: {json.dumps({'step': 4, 'message': 'Getting AI recommendations...'})}\n\n"

            structured_data = {
                "original_ticket": _extract_fields(original_data),
                "similar_tickets": similar_tickets,
                "onenote_documentation": onenote_docs,
                "location_specific_support_groups": support_match_result['location_specific_support'],
                "global_support_groups": support_match_result['global_support'],
            }

            json_data = json.dumps(structured_data, indent=2)
            prompt = PROMPTS["ticket_assignment"].format(json_data=json_data)
            output.add_line(f"Length of prompt: {len(prompt)}")

            model = TextGenerationModel()
            assignment_result = model.ask(prompt, max_retries=3)

            # Step 5: Finalize
            yield f"event: progress\ndata: {json.dumps({'step': 5, 'message': 'Finalizing results...'})}\n\n"

            # Map EUS to location-specific group
            original_group = assignment_result.get('recommended_support_group', 'N/A')
            if original_group == 'EUS':
                ticket_location = original_data.get('location', '')
                if ticket_location:
                    mapped = map_eus_to_location_group(ticket_location, available_support_groups)
                    if mapped != 'EUS':
                        assignment_result['recommended_support_group'] = mapped

            result = {
                'original_data': original_data,
                'similar_tickets': similar_tickets,
                'onenote_documentation': onenote_docs,
                'recommended_support_group': assignment_result.get('recommended_support_group'),
                'second_choice_support_group': assignment_result.get('second_choice_support_group'),
                'third_choice_support_group': assignment_result.get('third_choice_support_group'),
                'recommended_priority_level': assignment_result.get('recommended_priority_level'),
                'detailed_explanation': assignment_result.get('detailed_explanation'),
            }

            if "error" in assignment_result:
                result['error'] = assignment_result['error']

            yield f"event: complete\ndata: {json.dumps(result)}\n\n"

        except Exception as e:
            error_msg = str(e)
            output.add_line(f"Error in advice stream: {error_msg}")
            yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"

    return current_app.response_class(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )