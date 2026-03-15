"""
Ticket advice / assignment recommendation logic.

Orchestrates the LLM-based recommendation pipeline:
  1. Fetch original ticket from Athena
  2. Find similar tickets (vector search) and OneNote docs (in parallel)
  3. Match relevant support groups via keyword matching
  4. Build a structured prompt and call the text generation model
  5. Post-process the result (EUS mapping, etc.)
"""

import json
import concurrent.futures

from services.athena import Athena
from services.databricks import Databricks
from services.keyword_match import KeywordMatch
from services.text_generation_model import TextGenerationModel
from services.prompts import PROMPTS
from services.output import Output

from app.config import DEBUG
from app.logic.search import ticket_vector_search
from app.logic.support_groups import map_eus_to_location_group


def _extract_fields(ticket: dict) -> dict:
    """Extract the subset of ticket fields used in the LLM prompt."""
    return {
        "title": ticket.get("title", ""),
        "description": ticket.get("description", ""),
        "priority": ticket.get("priority", "") or ticket.get("priorityValue", ""),
        "location": ticket.get("location", ""),
        "floorValue": ticket.get("floorValue", ""),
        "affectedUser_Department": ticket.get("affectedUser_Department", ""),
        "affectedUser_Title": ticket.get("affectedUser_Title", ""),
    }


def get_ticket_advice(ticket_number: str) -> dict | None:
    """
    Full ticket-advice pipeline for a single ticket.

    Returns a dict with recommendation fields on success, a dict with an
    ``'error'`` key on failure, or ``None`` if the ticket cannot be fetched.
    """
    output = Output()

    if DEBUG:
        output.add_line("Starting get_ticket_advice function")

    # ── 1. Fetch original ticket ──────────────────────────────────────────
    athena = Athena()
    original_result = athena.get_ticket_data(ticket_number=ticket_number, view=True)

    if not original_result or not original_result.get('result'):
        output.add_line(f"Could not retrieve original ticket {ticket_number}")
        return None

    original_data = original_result['result'][0]

    if DEBUG:
        output.add_line(f"original_data:\n{original_data}")

    # Validate ticket number format
    if not isinstance(ticket_number, str) or len(ticket_number) < 2:
        output.add_line(f"Invalid ticket number format: {ticket_number}")
        return {'error': f'Invalid ticket number format: {ticket_number}'}

    ticket_type = ticket_number[:2].lower()
    if DEBUG:
        output.add_line(f"Detected ticket type: {ticket_type}")

    # ── 2. Match relevant support groups ──────────────────────────────────
    keyword_matcher = KeywordMatch()
    support_match_result = keyword_matcher.match_support_groups(original_data)
    available_support_groups = (
        support_match_result['location_specific_support']
        + support_match_result['global_support']
    )

    if DEBUG:
        total = len(available_support_groups)
        loc_count = len(support_match_result['location_specific_support'])
        glob_count = len(support_match_result['global_support'])
        output.add_line(
            f"Available support groups ({total} total): "
            f"{loc_count} location-specific, {glob_count} global"
        )

    # ── 3. Parallel: similar tickets + OneNote docs ───────────────────────
    search_text = (
        f"{original_data.get('title', '')} "
        f"{original_data.get('description', '')}"
    ).strip()

    similar_tickets: list = []
    onenote_docs: list = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        sim_future = executor.submit(
            ticket_vector_search, ticket_data=original_data, max_results=5
        )
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

    if DEBUG:
        output.add_line(f"similar_tickets:\n{similar_tickets}")
        output.add_line(f"onenote_docs:\n{onenote_docs}")

    # ── 4. Build prompt and call LLM ──────────────────────────────────────
    structured_data = {
        "original_ticket": _extract_fields(original_data),
        "similar_tickets": similar_tickets,
        "onenote_documentation": onenote_docs,
        "location_specific_support_groups": support_match_result['location_specific_support'],
        "global_support_groups": support_match_result['global_support'],
    }

    json_data = json.dumps(structured_data, indent=2)

    # Optional: dump full prompt context for debugging
    DEBUG_JSON_DATA = True
    if DEBUG_JSON_DATA:
        dbg_output = Output()
        dbg_output.add_line("=== FULL JSON_DATA CONTENTS FOR DEBUGGING ===")
        dbg_output.add_line(json_data)
        dbg_output.add_line("=== END JSON_DATA DEBUG OUTPUT ===")

    prompt = PROMPTS["ticket_assignment"].format(json_data=json_data)

    model = TextGenerationModel()
    assignment_result = model.ask(prompt, max_retries=3)

    # ── 5. Post-process ───────────────────────────────────────────────────
    output.add_line("Ticket Advice Request:")
    output.add_line(f"Ticket: {ticket_number}")
    output.add_line("Assignment Recommendations:")

    if "error" in assignment_result:
        output.add_line(f"Error: {assignment_result['error']}")
        return {'error': assignment_result['error']}

    # Map generic "EUS" to location-specific group
    original_group = assignment_result.get('recommended_support_group', 'N/A')
    if original_group == 'EUS':
        ticket_location = original_data.get('location', '')
        if ticket_location:
            mapped = map_eus_to_location_group(ticket_location, available_support_groups)
            if mapped != 'EUS':
                assignment_result['recommended_support_group'] = mapped
                output.add_line(f"Mapped generic EUS to location-specific group: {mapped}")
            else:
                output.add_line("Warning: Generic 'EUS' could not be mapped to location-specific group")

    output.add_line(f"Recommended Support Group: {assignment_result.get('recommended_support_group', 'N/A')}")
    output.add_line(f"Second Choice Support Group: {assignment_result.get('second_choice_support_group', 'N/A')}")
    output.add_line(f"Third Choice Support Group: {assignment_result.get('third_choice_support_group', 'N/A')}")
    output.add_line(f"Recommended Priority Level: {assignment_result.get('recommended_priority_level', 'N/A')}")
    output.add_line("Detailed Explanation:")
    output.add_line(assignment_result.get('detailed_explanation', 'N/A'))

    return {
        'original_data': original_data,
        'similar_tickets': similar_tickets,
        'onenote_documentation': onenote_docs,
        'recommended_support_group': assignment_result.get('recommended_support_group'),
        'second_choice_support_group': assignment_result.get('second_choice_support_group'),
        'third_choice_support_group': assignment_result.get('third_choice_support_group'),
        'recommended_priority_level': assignment_result.get('recommended_priority_level'),
        'detailed_explanation': assignment_result.get('detailed_explanation'),
    }