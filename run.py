from flask import Flask, render_template, send_from_directory, request, jsonify
import json
import sys
import os
import time
import threading
import concurrent.futures
from services.athena import Athena
from services.databricks import Databricks
from services.embedding_model import EmbeddingModel
from services.text_generation_model import TextGenerationModel
from services.keyword_match import KeywordMatch
from services.prompts import PROMPTS
from services.field_mapping import FieldMapper

# Add current directory to path for imports when running as script
sys.path.insert(0, os.path.dirname(__file__))

from services.output import Output

DEBUG = True  # Global debug setting for print statements


def load_support_groups_from_json(ticket_type="ir"):
    """
    Load support groups from support_group_description.json filtered by ticket type.
    
    Args:
        ticket_type (str): "ir" or "sr" to filter support groups by ticket type
        
    Returns:
        list: List of dictionaries containing name, fullname, and description for each support group
              that has a non-null description and matches the ticket_type.
              Groups with descriptions are preferred as they indicate assignable groups.
    """
    output = Output()
    json_path = os.path.join(os.path.dirname(__file__), 'services', 'support_group_description.json')
    
    if DEBUG:
        output.add_line(f"Loading support groups from: {json_path}")
        output.add_line(f"Filtering for ticket_type: {ticket_type}")
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            support_groups = json.load(f)
        
        # Filter by ticket_type and require a non-null description
        # Groups with descriptions indicate they are appropriate for assignment
        filtered_groups = []
        for group in support_groups:
            if (group.get('ticket_type') == ticket_type.lower() and 
                group.get('description') is not None and
                group.get('name') != "--Please Select a Support Group--"):  # Skip placeholder
                filtered_groups.append({
                    'name': group.get('name', ''),
                    'fullname': group.get('fullname', ''),
                    'description': group.get('description', '')
                })
        
        if DEBUG:
            output.add_line(f"Loaded {len(filtered_groups)} support groups for ticket_type '{ticket_type}'")
        
        return filtered_groups
        
    except FileNotFoundError:
        output.add_line(f"Support group description file not found: {json_path}")
        return []
    except json.JSONDecodeError as e:
        output.add_line(f"Error parsing support group JSON: {str(e)}")
        return []
    except Exception as e:
        output.add_line(f"Error loading support groups: {str(e)}")
        return []

app = Flask(__name__, template_folder='app/templates', static_folder='app/static')

# ── In-memory presence registry ───────────────────────────────────────────────
_presence_lock = threading.Lock()
_active_sessions: dict = {}   # session_id -> {last_seen, color, label}
_session_counter = 0           # monotonically increasing label counter
SESSION_EXPIRY_SECONDS = 60    # remove sessions silent for this long

# ── Shared validation-ticket broadcast state ──────────────────────────────────
import queue as _queue_module

_validation_lock = threading.Lock()
_validation_state = 'idle'      # 'idle' | 'loading' | 'loaded'
_validation_tickets: list = []  # cached ticket dicts (set when state == 'loaded')
_validation_fetched_at: float = 0.0
_validation_clients: dict = {}  # session_id -> queue.Queue  (one per SSE connection)
_validation_load_buffer: list = []  # events broadcast during the current load session
                                    # used to catch up clients that connect mid-load
VALIDATION_CACHE_TTL = 300      # seconds before a re-fetch is allowed
# ─────────────────────────────────────────────────────────────────────────────

# ── Recommendation engine state ───────────────────────────────────────────────
_recommendation_lock = threading.Lock()
_recommendation_cache: dict = {}       # ticket_id -> full recommendation dict
_recommendation_toggle: bool = False   # whether auto-recommend is active
_recommendation_processing: set = set()  # ticket_ids currently being processed
_recommendation_stop_event = threading.Event()  # signal to stop processing new tickets
RECOMMENDATION_MAX_WORKERS = 3         # concurrent LLM recommendation threads
# ─────────────────────────────────────────────────────────────────────────────

# ── Consensus-based implement button state ────────────────────────────────────
_consensus_lock = threading.Lock()
_consensus_active: bool = False        # whether consensus mode is currently active
_consensus_votes: set = set()          # session_ids that have agreed to unlock
CONSENSUS_TICKET_THRESHOLD = 5         # consensus required when > this many tickets selected
# ─────────────────────────────────────────────────────────────────────────────

# ── Cross-client state synchronisation ────────────────────────────────────────
_sync_lock = threading.Lock()
_checkbox_state: dict = {}             # ticket_id → bool (checked/unchecked)
_assignment_selections: dict = {}      # ticket_id → { sg_choice, manual_sg, priority }
_next_poll_epoch_ms: int = 0           # next poll timestamp for timer sync
_implement_in_progress: bool = False   # whether an implement operation is running
# ─────────────────────────────────────────────────────────────────────────────

# 30 visually distinct colors for presence circles.
# Colors are assigned server-side to guarantee no two active sessions share a color.
PRESENCE_COLORS = [
    '#0d6efd',  # blue
    '#198754',  # green
    '#fd7e14',  # orange
    '#6f42c1',  # purple
    '#0dcaf0',  # cyan
    '#dc3545',  # red
    '#6610f2',  # indigo
    '#d63384',  # pink
    '#20c997',  # teal
    '#ffc107',  # yellow
    '#0d9488',  # dark teal
    '#7c3aed',  # violet
    '#db2777',  # rose
    '#ea580c',  # deep orange
    '#16a34a',  # dark green
    '#2563eb',  # royal blue
    '#9333ea',  # bright purple
    '#e11d48',  # crimson
    '#0891b2',  # sky blue
    '#65a30d',  # lime green
    '#c2410c',  # burnt orange
    '#4f46e5',  # slate blue
    '#be185d',  # hot pink
    '#0f766e',  # dark cyan
    '#b45309',  # amber brown
    '#7e22ce',  # deep violet
    '#15803d',  # forest green
    '#1d4ed8',  # cobalt blue
    '#9f1239',  # dark rose
    '#a16207',  # gold
]
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(app.static_folder, 'images/upenn_logo_simplified.ico')

@app.route('/tests/<path:filename>')
def serve_test_file(filename):
    """Serve files from the tests/ directory (used for debug/test JS files)."""
    return send_from_directory('tests', filename)

@app.route('/')
def index():
    return render_template('index.html')

def semantic_search(description, max_results=5):
    """
    Perform semantic search by embedding the description and finding
    similar ticket vectors in ir_embeddings.jsonl file, then retrieving full details from Databricks.
    """
    from services.output import Output
    output = Output()

    output.add_line(f"Starting semantic search for: '{description}'")

    emb_model = EmbeddingModel()
    search_embedding = emb_model.get_embedding(description)

    if not search_embedding:
        output.add_line("Embedding generation failed, returned empty")
        return []

    output.add_line(f"Generated embedding with {len(search_embedding)} dimensions")

    # Use Databricks similarity search instead of local file
    db = Databricks()
    table_name = "scratchpad.aslanuka.ir_embeddings"
    output.add_line("Performing similarity search on Databricks ir_embeddings table...")
    embedding_results = db.similarity_search(table_name, description, limit=max_results)

    if not embedding_results:
        output.add_line("No similar tickets found")
        return []

    # Extract ticket IDs and similarities from results
    top_ticket_ids = [result['id'] for result in embedding_results]
    top_similarities = [float(result['similarity']) for result in embedding_results]

    output.add_line(f"Top {len(top_ticket_ids)} similar tickets: {top_ticket_ids}")
    output.add_line(f"Similarities: {[f'{s:.4f}' for s in top_similarities]}")

    # Retrieve full ticket details from Databricks (same as exact_description_search)
    ids_string = ','.join(f"'{id}'" for id in top_ticket_ids)
    query = f"SELECT * FROM prepared.ticketing.athena_tickets WHERE Id IN ({ids_string})"

    db = Databricks()
    result = db.execute_sql_query(query)

    if not result or result.get('status') != 'success' or not result.get('data'):
        output.add_line("No ticket details retrieved from Databricks")
        return []

    tickets = []
    for ticket_dict in result['data']:
        # Map to expected ticket format using normalized field names
        ticket = {
            'id': ticket_dict.get('id'),
            'title': ticket_dict.get('title'),
            'description': ticket_dict.get('description'),
            'statusValue': ticket_dict.get('status'),
            'priorityValue': ticket_dict.get('priority'),
            'assignedTo_DisplayName': ticket_dict.get('assigned_to', ''),
            'affectedUser_DisplayName': ticket_dict.get('affected_user', ''),
            'createdDate': ticket_dict.get('created_at'),
            'completedDate': ticket_dict.get('resolved_at'),
            'locationValue': ticket_dict.get('location'),
            'sourceValue': ticket_dict.get('source'),
            'supportGroupValue': ticket_dict.get('support_group'),
            'resolutionNotes': ticket_dict.get('resolution_notes')
        }
        tickets.append(ticket)

    output.add_line(f"Retrieved {len(tickets)} ticket details from Databricks")

    if tickets:
        output.add_line("Closest tickets identified from the semantic search:")
        for i, ticket in enumerate(tickets, 1):
            output.add_line(f"Closest Ticket {i}:")
            output.add_line(f"  ID: {ticket.get('id', 'N/A')}")
            output.add_line(f"  Title: {ticket.get('title', 'N/A')}")
            desc = ticket.get('description') or 'N/A'
            output.add_line(f"  Description: {str(desc)[:100]}{'...' if len(str(desc)) > 100 else ''}")
            output.add_line(f"  Status: {ticket.get('statusValue', 'N/A')}")
            output.add_line(f"  Priority: {ticket.get('priorityValue', 'N/A')}")
            output.add_line(f"  Assigned To: {ticket.get('assignedTo_DisplayName', 'N/A')}")
            output.add_line(f"  Affected User: {ticket.get('affectedUser_DisplayName', 'N/A')}")
            output.add_line(f"  Created Date: {ticket.get('createdDate', 'N/A')}")
            output.add_line(f"  Resolved Date: {ticket.get('completedDate', 'N/A')}")
            output.add_line(f"  Location: {ticket.get('locationValue', 'N/A')}")
            output.add_line(f"  Support Group: {ticket.get('supportGroupValue', 'N/A')}")
            res_notes = ticket.get('resolutionNotes') or 'N/A'
            output.add_line(f"  Resolution Notes: {str(res_notes)[:100]}{'...' if len(str(res_notes)) > 100 else ''}")
            output.add_line("")

    return tickets

def ticket_vector_search(ticket_number=None, ticket_data=None, max_results=5):
    """
    Perform vector search based on ticket number or pre-fetched data.
    If ticket_data is provided, uses it directly to avoid redundant Athena calls.
    """
    from services.output import Output
    from services.embedding_model import EmbeddingModel
    from services.databricks import Databricks
    output = Output()

    output.add_line(f"Starting ticket-based vector search for ticket: {ticket_number}")

    # If ticket_data is provided, use it; otherwise fetch from Athena
    if ticket_data is not None:
        if DEBUG:
            output.add_line("Using provided ticket_data (avoiding redundant Athena call)")
    elif ticket_number is not None:
        # Step 1: Get ticket details from Athena (only when ticket_data not provided)
        athena = Athena()
        ticket_result = athena.get_ticket_data(ticket_number=ticket_number, view=True)

        if not ticket_result or 'result' not in ticket_result or not ticket_result['result']:
            output.add_line(f"Could not retrieve ticket {ticket_number} from Athena")
            return []

        ticket_data = ticket_result['result'][0]  # Get the first result
    else:
        output.add_line("Either ticket_number or ticket_data must be provided")
        return []

    ticket_title = ticket_data.get('title', '')
    ticket_description = ticket_data.get('description', '')

    # Step 2: Combine title and description for embedding
    search_text = f"{ticket_title} {ticket_description}".strip()
    if not search_text:
        output.add_line(f"No searchable text in ticket {ticket_data.get('id', 'unknown')}")
        return []

    output.add_line(f"Search text from ticket {ticket_data.get('id', 'unknown')}: '{search_text[:100]}{'...' if len(search_text) > 100 else ''}'")

    # Step 3: Generate embedding for the ticket content
    emb_model = EmbeddingModel()
    search_embedding = emb_model.get_embedding(search_text)

    if not search_embedding:
        output.add_line("Embedding generation failed")
        return []

    output.add_line(f"Generated embedding with {len(search_embedding)} dimensions")

    # Step 4: Use Databricks similarity search instead of local file
    db_sim = Databricks()
    table_name = "scratchpad.aslanuka.ir_embeddings"
    output.add_line("Performing similarity search on Databricks ir_embeddings table...")

    embedding_results = db_sim.similarity_search(table_name, search_text, limit=max_results)

    if not embedding_results:
        output.add_line("No similar tickets found")
        return []

    # Extract ticket IDs and similarities from results
    top_ticket_ids = [result['id'] for result in embedding_results]
    top_similarities = [float(result['similarity']) for result in embedding_results]

    output.add_line(f"Top {len(top_ticket_ids)} similar tickets: {top_ticket_ids}")
    output.add_line(f"Similarities: {[f'{s:.4f}' for s in top_similarities]}")

    # Step 5: Retrieve full ticket details from Databricks (same as other searches)
    ids_string = ','.join(f"'{id}'" for id in top_ticket_ids)
    query = f"SELECT * FROM prepared.ticketing.athena_tickets WHERE Id IN ({ids_string})"

    db = Databricks()
    result = db.execute_sql_query(query)

    if not result or result.get('status') != 'success' or not result.get('data'):
        output.add_line("No ticket details retrieved from Databricks")
        return []

    tickets = []
    for ticket_dict in result['data']:
        # Map to expected ticket format using normalized field names
        ticket = {
            'id': ticket_dict.get('id'),
            'title': ticket_dict.get('title'),
            'description': ticket_dict.get('description'),
            'statusValue': ticket_dict.get('status'),
            'priorityValue': ticket_dict.get('priority'),
            'assignedTo_DisplayName': ticket_dict.get('assigned_to', ''),
            'affectedUser_DisplayName': ticket_dict.get('affected_user', ''),
            'createdDate': ticket_dict.get('created_at'),
            'completedDate': ticket_dict.get('resolved_at'),
            'locationValue': ticket_dict.get('location'),
            'sourceValue': ticket_dict.get('source'),
            'supportGroupValue': ticket_dict.get('support_group'),
            'resolutionNotes': ticket_dict.get('resolution_notes')
        }
        tickets.append(ticket)

    output.add_line(f"Retrieved {len(tickets)} ticket details from Databricks")
    return tickets

def map_eus_to_location_group(location_string, available_support_groups):
    """
    Map generic 'EUS' recommendation to location-specific EUS group based on ticket location.

    Args:
        location_string (str): Ticket location (e.g., "RITTENHOUSE - MAIN BLDG (1800 LOMBARD)")
        available_support_groups (list): List of support group dictionaries with 'name' key

    Returns:
        str: Best matching location-specific EUS group name, or 'EUS' if no match
    """
    if not location_string or not available_support_groups:
        return "EUS"  # fallback

    # Extract location keywords by splitting on common separators and taking first meaningful parts
    location_parts = []
    for sep in [' - ', ' (', '(', ' MAIN ', ' CENTER', ' HOSPITAL', ' MEDICAL', ' BUILDING', ' BLDG']:
        if sep in str(location_string).upper():
            # Split and take first part before separator
            parts = str(location_string).upper().split(sep, 1)
            if parts[0] and len(parts[0]) > 2:  # Must be meaningful length
                location_parts.append(parts[0].strip())
            break

    # If no specific separator found, try to extract primary location identifier
    if not location_parts:
        # Common location patterns: RITTENHOUSE, CHERRY HILL, WIDENER, PMUC, PAHC, PRESTON, HUP
        upper_loc = str(location_string).upper()
        primary_loc = None
        for candidate in ['RITTENHOUSE', 'CHERRY HILL', 'WIDENER', 'PMUC', 'PAHC', 'PRESTON', 'HUP', 'PAH', 'MARKET']:
            if candidate in upper_loc:
                primary_loc = candidate
                break

        if primary_loc:
            location_parts = [primary_loc]
        else:
            # Last resort: take first word that's 4+ chars
            words = str(location_string).upper().split()
            for word in words[:3]:  # Check first 3 words
                if len(word) >= 4 and word.replace('(', '').replace(')', '').replace(',', '').isalnum():
                    location_parts = [word]
                    break

    if not location_parts:
        return "EUS"  # unable to extract meaningful location

    # Filter available groups: remove groups with excluded keywords
    filtered_groups = []
    for group in available_support_groups:
        group_name = group.get('name', '')
        group_upper = str(group_name).upper()
        if not any(exclude in group_upper for exclude in ['NETWORK', 'CPD', 'RFID']):
            filtered_groups.append(group)

    # Score each filtered group by location keyword matches
    scored_groups = []
    for group in filtered_groups:
        score = 0
        group_name = group.get('name', '')
        group_upper = str(group_name).upper()

        # Direct substring matches get highest score
        for loc_part in location_parts:
            if loc_part in group_upper:
                score += 3

        # Word boundary matches (whole word) get medium score
        import re
        for loc_part in location_parts:
            if re.search(r'\b' + re.escape(loc_part) + r'\b', group_upper):
                score += 2

        # Partial matches (beginning of group name or location name) get lower score
        for loc_part in location_parts:
            for word in group_upper.split():
                if word.startswith(loc_part) or loc_part.startswith(word):
                    score += 1

        # Handle common location abbreviations
        # If location part is long name, check for short form in group
        for loc_part in location_parts:
            if loc_part == 'RITTENHOUSE' and 'RITT' in group_upper:
                score += 3
            elif loc_part == 'CHERRY HILL' and 'RSI' in group_upper:
                score += 3
            elif loc_part == 'WIDENER' and 'WIDENER' in group_upper:
                score += 3
            elif loc_part == 'MARKET' and 'PMUC' in group_upper:
                score += 3
            elif loc_part.startswith('PAH') and 'PAH' in group_upper:
                score += 3
            elif loc_part == 'PRESTON' and 'PRES' in group_upper:
                score += 3
            elif loc_part.startswith('HUP') and 'HUP' in group_upper:
                score += 3

        if score > 0:
            scored_groups.append((group_name, score))

    # Return highest scoring group, or fallback if none found
    if scored_groups:
        scored_groups.sort(key=lambda x: x[1], reverse=True)
        return scored_groups[0][0]  # highest score group

    return "EUS"  # no matches found, fallback to generic

def exact_description_search(description, max_results=5):
    """
    Perform exact description search using SQL LIKE query on Databricks athena_tickets table.
    Returns tickets in the same format as semantic_search.
    """
    query = f"SELECT * FROM prepared.ticketing.athena_tickets WHERE Description LIKE '%{description}%' LIMIT {max_results}"

    db = Databricks()
    result = db.execute_sql_query(query)

    if not result or result.get('status') != 'success' or not result.get('data'):
        return []

    tickets = []
    for ticket_dict in result['data']:
        # Map to expected ticket format using normalized field names
        ticket = {
            'id': ticket_dict.get('id'),
            'title': ticket_dict.get('title'),
            'description': ticket_dict.get('description'),
            'statusValue': ticket_dict.get('status'),
            'priorityValue': ticket_dict.get('priority'),
            'assignedTo_DisplayName': ticket_dict.get('assigned_to', ''),
            'affectedUser_DisplayName': ticket_dict.get('affected_user', ''),
            'createdDate': ticket_dict.get('created_at'),
            'completedDate': ticket_dict.get('resolved_at'),
            'locationValue': ticket_dict.get('location'),
            'sourceValue': ticket_dict.get('source'),
            'supportGroupValue': ticket_dict.get('support_group'),
            'resolutionNotes': ticket_dict.get('resolution_notes')
        }
        tickets.append(ticket)

    return tickets

def get_ticket_advice(ticket_number):
    """
    Get ticket advice by compiling structured data and using LLM for assignment recommendations.
    """
    output = Output()

    if DEBUG:
        output.add_line("Starting get_ticket_advice function")

    # Get original ticket data
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

    # Detect ticket type from ticket number (first 2 characters)
    ticket_type = ticket_number[:2].lower()  # "ir" or "sr"
    if DEBUG:
        output.add_line(f"Detected ticket type: {ticket_type}")

    # Get relevant support groups for this ticket using keyword matching to reduce context bloat
    keyword_matcher = KeywordMatch()
    support_match_result = keyword_matcher.match_support_groups(original_data)

    # Combine for EUS mapping function (needs all available groups)
    available_support_groups = support_match_result['location_specific_support'] + support_match_result['global_support']

    if DEBUG:
        total_groups = len(support_match_result['location_specific_support']) + len(support_match_result['global_support'])
        output.add_line(f"Available support groups ({total_groups} total): {len(support_match_result['location_specific_support'])} location-specific, {len(support_match_result['global_support'])} global")

    # Prepare search text for parallel operations
    search_text = f"{original_data.get('title', '')} {original_data.get('description', '')}".strip()

    # Execute similar tickets search and OneNote documentation search in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        # Submit both tasks
        similar_tickets_future = executor.submit(ticket_vector_search, ticket_data=original_data, max_results=5)
        onenote_future = executor.submit(lambda: Databricks().semantic_search_onenote(search_text, limit=5))

        # Wait for results with timeout handling
        try:
            similar_tickets = similar_tickets_future.result(timeout=60)  # 60 second timeout
            onenote_docs = onenote_future.result(timeout=60)  # 60 second timeout
        except concurrent.futures.TimeoutError:
            output.add_line("Warning: Parallel operations timed out, falling back to empty results")
            similar_tickets = []
            onenote_docs = []
        except Exception as e:
            output.add_line(f"Warning: Parallel operations failed with error: {str(e)}, falling back to empty results")
            similar_tickets = []
            onenote_docs = []

    if DEBUG:
        output.add_line(f"similar_tickets:\n{similar_tickets}")
        output.add_line(f"onenote_docs:\n{onenote_docs}")

    # Extract fields for original
    def extract_fields(ticket):
        return {
            "title": ticket.get("title", ""),
            "description": ticket.get("description", ""),
            "priority": ticket.get("priority", "") or ticket.get("priorityValue", ""),
            "location": ticket.get("location", ""),  # Use correct field name from Athena data
            "floorValue": ticket.get("floorValue", ""),
            "affectedUser_Department": ticket.get("affectedUser_Department", ""),
            "affectedUser_Title": ticket.get("affectedUser_Title", "")
        }

    structured_data = {
        "original_ticket": extract_fields(original_data),
        "similar_tickets": similar_tickets,
        "onenote_documentation": onenote_docs,
        "location_specific_support_groups": support_match_result['location_specific_support'],
        "global_support_groups": support_match_result['global_support']
    }

    # Convert to JSON string
    json_data = json.dumps(structured_data, indent=2)

    # Debug flag specifically for printing full json_data contents to output.txt
    DEBUG_JSON_DATA = True  # Set to False to disable json_data debugging

    if DEBUG_JSON_DATA:
        output = Output()
        output.add_line("=== FULL JSON_DATA CONTENTS FOR DEBUGGING ===")
        output.add_line(json_data)
        output.add_line("=== END JSON_DATA DEBUG OUTPUT ===")


    # Format prompt with JSON data
    prompt = PROMPTS["ticket_assignment"].format(json_data=json_data)

    # Get LLM recommendations
    model = TextGenerationModel()
    assignment_result = model.ask(prompt, max_retries=3)

    # Log results
    output.add_line("Ticket Advice Request:")
    output.add_line(f"Ticket: {ticket_number}")
    output.add_line("Assignment Recommendations:")
    if "error" in assignment_result:
        output.add_line(f"Error: {assignment_result['error']}")
        return {'error': assignment_result['error']}
    else:
        original_group = assignment_result.get('recommended_support_group', 'N/A')

        # Map "EUS" to location-specific group if needed
        if original_group == 'EUS':
            ticket_location = original_data.get('location', '')
            if ticket_location:
                mapped_group = map_eus_to_location_group(ticket_location, available_support_groups)
                if mapped_group != 'EUS':  # Successful mapping
                    assignment_result['recommended_support_group'] = mapped_group
                    output.add_line(f"Mapped generic EUS to location-specific group: {mapped_group}")
                else:
                    output.add_line("Warning: Generic 'EUS' could not be mapped to location-specific group")

        output.add_line(f"Recommended Support Group: {assignment_result.get('recommended_support_group', 'N/A')}")
        output.add_line(f"Second Choice Support Group: {assignment_result.get('second_choice_support_group', 'N/A')}")
        output.add_line(f"Third Choice Support Group: {assignment_result.get('third_choice_support_group', 'N/A')}")
        output.add_line(f"Recommended Priority Level: {assignment_result.get('recommended_priority_level', 'N/A')}")
        output.add_line("Detailed Explanation:")
        output.add_line(assignment_result.get('detailed_explanation', 'N/A'))

        # Return the structured data for frontend display
        return {
            'original_data': original_data,
            'similar_tickets': similar_tickets,
            'onenote_documentation': onenote_docs,
            'recommended_support_group': assignment_result.get('recommended_support_group'),
            'second_choice_support_group': assignment_result.get('second_choice_support_group'),
            'third_choice_support_group': assignment_result.get('third_choice_support_group'),
            'recommended_priority_level': assignment_result.get('recommended_priority_level'),
            'detailed_explanation': assignment_result.get('detailed_explanation')
        }

@app.route('/api/search-tickets', methods=['POST'])
def search_tickets():
    data = request.get_json()
    
    if 'contactMethod' in data:
        # Phone search using Athena
        search_value = data['contactMethod']
        try:
            athena = Athena()
            result = athena.get_ticket_data(conditions={
                'contactMethod': search_value,
                'contactMethodContains': False  # Use eq operator
            })

            if result:
                # Map Athena fields to frontend format (same as other searches)
                tickets = []
                for ticket_dict in result['result']:
                    ticket = {
                        'id': ticket_dict.get('id'),
                        'title': ticket_dict.get('title'),
                        'description': ticket_dict.get('description'),
                        'statusValue': ticket_dict.get('status'),
                        'priorityValue': ticket_dict.get('priority'),
                        'assignedTo_DisplayName': ticket_dict.get('assigned_to'),
                        'affectedUser_DisplayName': ticket_dict.get('affected_user'),
                        'createdDate': ticket_dict.get('created_at'),
                        'completedDate': ticket_dict.get('completed_at'),
                        'locationValue': ticket_dict.get('location'),
                        'sourceValue': ticket_dict.get('source'),
                        'supportGroupValue': ticket_dict.get('support_group'),
                        'resolutionNotes': ticket_dict.get('resolution_notes'),
                        'contactMethod': ticket_dict.get('contact_method')
                    }
                    tickets.append(ticket)

                # Return consistent response format
                response = {
                    'currentPage': result.get('currentPage', 1),
                    'resultCount': len(tickets),
                    'pageSize': result.get('pageSize', 1000),
                    'hasMoreResults': result.get('hasMoreResults', False),
                    'result': tickets
                }
                return jsonify(response)
            else:
                return jsonify({'error': 'No results found'}), 404

        except Exception as e:
            return jsonify({'error': str(e)}), 500
            
    elif 'description' in data:
        # Exact description search using SQL LIKE
        search_value = data['description']
        try:
            tickets = exact_description_search(search_value, max_results=5)

            # Return Athena-like response format
            response = {
                'currentPage': 1,
                'resultCount': len(tickets),
                'pageSize': 5,
                'hasMoreResults': False,
                'result': tickets
            }
            return jsonify(response)

        except Exception as e:
            return jsonify({'error': str(e)}), 500

    elif 'semanticDescription' in data:
        # Semantic description search using vector similarity
        search_value = data['semanticDescription']
        try:
            tickets = semantic_search(search_value, max_results=5)

            # Return Athena-like response format
            response = {
                'currentPage': 1,
                'resultCount': len(tickets),
                'pageSize': 5,
                'hasMoreResults': False,
                'result': tickets
            }
            return jsonify(response)

        except Exception as e:
            return jsonify({'error': str(e)}), 500

    elif 'ticketId' in data:
        # Ticket-based vector search
        search_value = data['ticketId']
        try:
            tickets = ticket_vector_search(search_value, max_results=5)

            # Return Athena-like response format
            response = {
                'currentPage': 1,
                'resultCount': len(tickets),
                'pageSize': 5,
                'hasMoreResults': False,
                'result': tickets
            }
            return jsonify(response)

        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        return jsonify({'error': 'Missing search parameter (contactMethod, description, semanticDescription, or ticketId)'}), 400

@app.route('/api/get-ticket-advice', methods=['POST'])
def api_get_ticket_advice():
    data = request.get_json()
    if DEBUG:
        output = Output()
        output.add_line(f"api_get_ticket_advice called with data: {data}")
    if 'ticketId' in data:
        ticket_number = data['ticketId']
        if DEBUG:
            output.add_line(f"Starting get_ticket_advice for {ticket_number}")
        result = get_ticket_advice(ticket_number)
        if DEBUG:
            output.add_line(f"Finished get_ticket_advice for {ticket_number}")
        if result:
            return jsonify(result)
        else:
            return jsonify({'error': 'Could not retrieve ticket advice'}), 500
    else:
        return jsonify({'error': 'Missing ticketId'}), 400


@app.route('/api/get-ticket-advice-stream', methods=['GET'])
def api_get_ticket_advice_stream():
    """
    Stream ticket advice generation using Server-Sent Events (SSE).
    Provides real-time progress updates during the analysis process.
    
    Query params:
    - ticketId: The ticket number to analyze
    
    Event types:
    - progress: {step: number, message: string} - Current step update
    - complete: Full result data when analysis is finished
    - error: Error message if something goes wrong
    """
    ticket_number = request.args.get('ticketId')
    
    if not ticket_number:
        def error_stream():
            yield f"event: error\ndata: {json.dumps({'message': 'Missing ticketId parameter'})}\n\n"
        return app.response_class(error_stream(), mimetype='text/event-stream')
    
    def generate_advice_stream():
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
            
            # Validate ticket number format
            if not isinstance(ticket_number, str) or len(ticket_number) < 2:
                yield f"event: error\ndata: {json.dumps({'message': f'Invalid ticket number format: {ticket_number}'})}\n\n"
                return
            
            # Detect ticket type from ticket number
            ticket_type = ticket_number[:2].lower()
            # Get relevant support groups for this ticket using keyword matching to reduce context bloat
            keyword_matcher = KeywordMatch()
            support_match_result = keyword_matcher.match_support_groups(original_data)
            available_support_groups = support_match_result['location_specific_support'] + support_match_result['global_support']
            
            # Prepare search text for parallel operations
            search_text = f"{original_data.get('title', '')} {original_data.get('description', '')}".strip()
            
            # Step 2: Finding similar tickets
            yield f"event: progress\ndata: {json.dumps({'step': 2, 'message': 'Finding similar tickets...'})}\n\n"
            
            # Step 3: Searching documentation (happens in parallel)
            yield f"event: progress\ndata: {json.dumps({'step': 3, 'message': 'Searching documentation...'})}\n\n"
            
            # Execute similar tickets search and OneNote documentation search in parallel
            similar_tickets = []
            onenote_docs = []
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                similar_tickets_future = executor.submit(ticket_vector_search, None, original_data, 5)
                onenote_future = executor.submit(lambda: Databricks().semantic_search_onenote(search_text, limit=5))
                
                try:
                    similar_tickets = similar_tickets_future.result(timeout=60)
                    onenote_docs = onenote_future.result(timeout=60)
                except concurrent.futures.TimeoutError:
                    output.add_line("Warning: Parallel operations timed out")
                except Exception as e:
                    output.add_line(f"Warning: Parallel operations failed: {str(e)}")
            
            # Step 4: Getting AI recommendations
            yield f"event: progress\ndata: {json.dumps({'step': 4, 'message': 'Getting AI recommendations...'})}\n\n"
            
            # Extract fields for original
            def extract_fields(ticket):
                return {
                    "title": ticket.get("title", ""),
                    "description": ticket.get("description", ""),
                    "priority": ticket.get("priority", "") or ticket.get("priorityValue", ""),
                    "location": ticket.get("location", ""),
                    "floorValue": ticket.get("floorValue", ""),
                    "affectedUser_Department": ticket.get("affectedUser_Department", ""),
                    "affectedUser_Title": ticket.get("affectedUser_Title", "")
                }
            
            structured_data = {
                "original_ticket": extract_fields(original_data),
                "similar_tickets": similar_tickets,
                "onenote_documentation": onenote_docs,
                "location_specific_support_groups": support_match_result['location_specific_support'],
                "global_support_groups": support_match_result['global_support']
            }
            
            # Convert to JSON string and format prompt
            json_data = json.dumps(structured_data, indent=2)
            prompt = PROMPTS["ticket_assignment"].format(json_data=json_data)
            output.add_line(f"Length of prompt: {len(prompt)}")
            
            # Get LLM recommendations
            model = TextGenerationModel()
            assignment_result = model.ask(prompt, max_retries=3)
            
            # Step 5: Finalizing results
            yield f"event: progress\ndata: {json.dumps({'step': 5, 'message': 'Finalizing results...'})}\n\n"
            
            # Map "EUS" to location-specific group if needed
            original_group = assignment_result.get('recommended_support_group', 'N/A')
            if original_group == 'EUS':
                ticket_location = original_data.get('location', '')
                if ticket_location:
                    mapped_group = map_eus_to_location_group(ticket_location, available_support_groups)
                    if mapped_group != 'EUS':
                        assignment_result['recommended_support_group'] = mapped_group
            
            # Prepare final result
            result = {
                'original_data': original_data,
                'similar_tickets': similar_tickets,
                'onenote_documentation': onenote_docs,
                'recommended_support_group': assignment_result.get('recommended_support_group'),
                'second_choice_support_group': assignment_result.get('second_choice_support_group'),
                'third_choice_support_group': assignment_result.get('third_choice_support_group'),
                'recommended_priority_level': assignment_result.get('recommended_priority_level'),
                'detailed_explanation': assignment_result.get('detailed_explanation')
            }
            
            # Check for error in result
            if "error" in assignment_result:
                result['error'] = assignment_result['error']
            
            # Send complete event with all data
            yield f"event: complete\ndata: {json.dumps(result)}\n\n"
            
        except Exception as e:
            error_msg = str(e)
            output.add_line(f"Error in advice stream: {error_msg}")
            yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"
    
    return app.response_class(
        generate_advice_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )

@app.route('/api/get-validation-tickets', methods=['POST'])
def api_get_validation_tickets():
    output = Output()
    if DEBUG:
        output.add_line("Starting api_get_validation_tickets")

    try:
        athena = Athena()

        # Get ticket IDs from validation queue
        ticket_ids = athena.get_validation_tickets()
        if not ticket_ids:
            output.add_line("No validation tickets found")
            return jsonify({'tickets': [], 'count': 0})

        if DEBUG:
            output.add_line(f"Found {len(ticket_ids)} validation ticket IDs: {ticket_ids[:5]}{'...' if len(ticket_ids) > 5 else ''}")

        # Get full ticket data for each ID
        validation_tickets = []
        for ticket_id in ticket_ids:
            try:
                ticket_data = athena.get_ticket_data(ticket_number=ticket_id, view=True)
                if ticket_data and 'result' in ticket_data and ticket_data['result']:
                    ticket = ticket_data['result'][0]
                    # Truncate description to first 32 characters
                    truncated_desc = ticket.get('description', '')[:32]
                    if len(ticket.get('description', '')) > 32:
                        truncated_desc += '...'

                    # Format ticket for frontend display
                    validation_ticket = {
                        'id': ticket.get('id'),
                        'title': ticket.get('title'),
                        'description': truncated_desc,  # First 32 chars + ellipsis if truncated
                        'full_description': ticket.get('description', ''),  # Full description for expansion
                        'priority': ticket.get('priority'),  # Priority level
                        'location': ticket.get('location'),   # Location
                        'created_at': ticket.get('created_at'),  # Creation date
                        'status': ticket.get('status', ''),  # Status
                        'assigned_to': ticket.get('assigned_to', ''),  # Assigned to
                        'affected_user': ticket.get('affected_user', ''),  # Affected user
                        'source': ticket.get('source', ''),  # Source
                        'support_group': ticket.get('support_group', ''),  # Support group
                        'resolution_notes': ticket.get('resolution_notes', '')  # Resolution notes
                    }
                    validation_tickets.append(validation_ticket)
                    if DEBUG:
                        output.add_line(f"Added ticket {ticket_id}")
                else:
                    if DEBUG:
                        output.add_line(f"Failed to get data for ticket {ticket_id}")
            except Exception as e:
                output.add_line(f"Error processing ticket {ticket_id}: {str(e)}")
                continue

        if DEBUG:
            output.add_line(f"Returning {len(validation_tickets)} validation tickets")

        return jsonify({
            'tickets': validation_tickets,
            'count': len(validation_tickets)
        })

    except Exception as e:
        output.add_line(f"Error in api_get_validation_tickets: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/get-validation-tickets-stream', methods=['GET'])
def api_get_validation_tickets_stream():
    """
    Stream validation tickets using Server-Sent Events (SSE).
    Each ticket is sent as it's fetched from Athena, allowing progressive display.
    
    Event types:
    - count: Total number of tickets to expect
    - ticket: Individual ticket data
    - complete: All tickets processed
    - error: Error message
    """
    output = Output()
    if DEBUG:
        output.add_line("Starting api_get_validation_tickets_stream")

    def generate_stream():
        try:
            athena = Athena()

            # Get ticket IDs from validation queue
            ticket_ids = athena.get_validation_tickets()
            if not ticket_ids:
                yield f"event: count\ndata: {json.dumps({'count': 0})}\n\n"
                yield f"event: complete\ndata: {json.dumps({'message': 'No validation tickets found'})}\n\n"
                return

            total_count = len(ticket_ids)
            if DEBUG:
                output.add_line(f"Streaming {total_count} validation tickets")

            # Send total count first
            yield f"event: count\ndata: {json.dumps({'count': total_count})}\n\n"

            # Stream each ticket as it's fetched
            for index, ticket_id in enumerate(ticket_ids):
                try:
                    ticket_data = athena.get_ticket_data(ticket_number=ticket_id, view=True)
                    if ticket_data and 'result' in ticket_data and ticket_data['result']:
                        ticket = ticket_data['result'][0]
                        
                        # Truncate description to first 32 characters
                        truncated_desc = ticket.get('description', '')[:32]
                        if len(ticket.get('description', '')) > 32:
                            truncated_desc += '...'

                        # Format ticket for frontend display
                        validation_ticket = {
                            'id': ticket.get('id'),
                            'title': ticket.get('title'),
                            'description': truncated_desc,
                            'full_description': ticket.get('description', ''),
                            'priority': ticket.get('priority'),
                            'location': ticket.get('location'),
                            'created_at': ticket.get('created_at'),
                            'status': ticket.get('status', ''),
                            'assigned_to': ticket.get('assigned_to', ''),
                            'affected_user': ticket.get('affected_user', ''),
                            'source': ticket.get('source', ''),
                            'support_group': ticket.get('support_group', ''),
                            'resolution_notes': ticket.get('resolution_notes', ''),
                            'index': index  # Include index for ordering
                        }
                        
                        if DEBUG:
                            output.add_line(f"Streaming ticket {index + 1}/{total_count}: {ticket_id}")
                        
                        # Send ticket event
                        yield f"event: ticket\ndata: {json.dumps(validation_ticket)}\n\n"
                    else:
                        if DEBUG:
                            output.add_line(f"Failed to get data for ticket {ticket_id}")
                        
                        # Send error for this specific ticket but continue
                        yield f"event: error\ndata: {json.dumps({'index': index, 'ticket_id': ticket_id, 'message': 'Failed to fetch ticket data'})}\n\n"
                
                except Exception as e:
                    error_msg = f"Error processing ticket {ticket_id}: {str(e)}"
                    if DEBUG:
                        output.add_line(error_msg)
                    yield f"event: error\ndata: {json.dumps({'index': index, 'ticket_id': ticket_id, 'message': str(e)})}\n\n"

            # Send completion event
            yield f"event: complete\ndata: {json.dumps({'message': 'All tickets processed', 'count': total_count})}\n\n"
            
            if DEBUG:
                output.add_line("Finished streaming validation tickets")

        except Exception as e:
            error_msg = f"Error in stream: {str(e)}"
            if DEBUG:
                output.add_line(error_msg)
            yield f"event: error\ndata: {json.dumps({'message': error_msg})}\n\n"

    return app.response_class(
        generate_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'  # Disable nginx buffering if present
        }
    )

@app.route('/api/presence/heartbeat', methods=['POST'])
def api_presence_heartbeat():
    """
    Register or refresh a viewer's presence on the validation page.

    Request body: { "session_id": "<uuid>", "color": "#rrggbb" }
    Response:     { "sessions": [ { "session_id", "color", "label" }, ... ] }
    """
    global _session_counter
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()
    display_name = (data.get('display_name') or '').strip() or None
    # Note: clients no longer send a color — it is assigned server-side from PRESENCE_COLORS

    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400

    now = time.time()

    with _presence_lock:
        # Expire stale sessions first
        stale = [sid for sid, info in _active_sessions.items()
                 if now - info['last_seen'] > SESSION_EXPIRY_SECONDS]
        for sid in stale:
            del _active_sessions[sid]

        # Register new session or refresh existing one
        if session_id not in _active_sessions:
            _session_counter += 1
            # Use the provided display name as the label; fall back to Viewer N
            label = display_name if display_name else f'Viewer {_session_counter}'
            # Assign the first palette color not already in use by an active session.
            # If all 30 colors are taken, fall back to the color least frequently used.
            used_colors = [info['color'] for info in _active_sessions.values()]
            assigned_color = None
            for c in PRESENCE_COLORS:
                if c not in used_colors:
                    assigned_color = c
                    break
            if assigned_color is None:
                # All colors taken — pick the least-used one
                from collections import Counter
                color_counts = Counter(used_colors)
                assigned_color = min(PRESENCE_COLORS, key=lambda c: color_counts.get(c, 0))
            _active_sessions[session_id] = {
                'last_seen': now,
                'color': assigned_color,
                'label': label
            }
        else:
            _active_sessions[session_id]['last_seen'] = now
            # Update the label if the client sends a (possibly updated) display name
            if display_name:
                _active_sessions[session_id]['label'] = display_name

        sessions = [
            {'session_id': sid, 'color': info['color'], 'label': info['label']}
            for sid, info in _active_sessions.items()
        ]

    # Check if any stale sessions affected consensus state
    if stale:
        _check_consensus_after_presence_change()

    return jsonify({'sessions': sessions})


@app.route('/api/presence/leave', methods=['POST'])
def api_presence_leave():
    """
    Explicitly remove a viewer's presence (called on page unload).

    Request body: { "session_id": "<uuid>" }
    """
    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    if session_id:
        with _presence_lock:
            _active_sessions.pop(session_id, None)
        # Check if the departing session affects consensus state
        _check_consensus_after_presence_change()

    return jsonify({'status': 'ok'})


@app.route('/api/check-validation-tickets', methods=['GET'])
def api_check_validation_tickets():
    """
    Compare a caller-supplied list of ticket IDs against the current Athena
    Validation queue and return which IDs have left, which are new, and which
    are unchanged.

    Query params:
    - ids: comma-separated list of ticket IDs currently displayed in the UI

    Returns:
    {
        "still_in_queue": [...],
        "left_queue":     [...],   # were displayed, no longer in Validation
        "new_in_queue":   [...]    # now in Validation, not yet displayed
    }
    """
    output = Output()
    ids_param = request.args.get('ids', '').strip()
    displayed_ids = set(i.strip() for i in ids_param.split(',') if i.strip()) if ids_param else set()

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
            'left_queue':     left_queue,
            'new_in_queue':   new_in_queue
        }

        # Clean up recommendation cache and sync state for tickets that left the queue
        if left_queue:
            with _recommendation_lock:
                for tid in left_queue:
                    _recommendation_cache.pop(tid, None)
                    _recommendation_processing.discard(tid)
            with _sync_lock:
                for tid in left_queue:
                    _checkbox_state.pop(tid, None)
                    _assignment_selections.pop(tid, None)
            if DEBUG:
                output.add_line(
                    f"check-validation-tickets: purged {len(left_queue)} "
                    f"recommendation(s) and sync state for tickets that left the queue"
                )

        # Auto-queue recommendations for new tickets if the toggle is ON
        if new_in_queue:
            with _recommendation_lock:
                toggle_on = _recommendation_toggle
            if toggle_on:
                _queue_recommendations_for_tickets(new_in_queue)
                if DEBUG:
                    output.add_line(
                        f"check-validation-tickets: auto-queued {len(new_in_queue)} "
                        f"new ticket(s) for recommendation processing"
                    )

        if DEBUG:
            output.add_line(
                f"check-validation-tickets: displayed={len(displayed_ids)}, "
                f"left={len(left_queue)}, new={len(new_in_queue)}"
            )

        return jsonify(result)

    except Exception as e:
        output.add_line(f"Error in api_check_validation_tickets: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/get-single-validation-ticket', methods=['GET'])
def api_get_single_validation_ticket():
    """
    Fetch full ticket data for a single ticket ID.
    Used to hydrate pending (skeleton) accordion items added by the polling loop.

    Query params:
    - id: ticket ID to fetch

    Returns the same ticket shape used by the streaming validation endpoint.
    """
    output = Output()
    ticket_id = request.args.get('id', '').strip()

    if not ticket_id:
        return jsonify({'error': 'Missing id parameter'}), 400

    try:
        athena = Athena()
        ticket_data = athena.get_ticket_data(ticket_number=ticket_id, view=True)

        if not ticket_data or 'result' not in ticket_data or not ticket_data['result']:
            return jsonify({'error': f'Could not retrieve ticket {ticket_id}'}), 404

        ticket = ticket_data['result'][0]

        truncated_desc = ticket.get('description', '')[:32]
        if len(ticket.get('description', '')) > 32:
            truncated_desc += '...'

        return jsonify({
            'id':               ticket.get('id'),
            'title':            ticket.get('title'),
            'description':      truncated_desc,
            'full_description': ticket.get('description', ''),
            'priority':         ticket.get('priority'),
            'location':         ticket.get('location'),
            'created_at':       ticket.get('created_at'),
            'status':           ticket.get('status', ''),
            'assigned_to':      ticket.get('assigned_to', ''),
            'affected_user':    ticket.get('affected_user', ''),
            'source':           ticket.get('source', ''),
            'support_group':    ticket.get('support_group', ''),
            'resolution_notes': ticket.get('resolution_notes', '')
        })

    except Exception as e:
        output.add_line(f"Error in api_get_single_validation_ticket: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/implement-assignments', methods=['POST'])
def api_implement_assignments():
    """
    Implement ticket assignments in Athena based on AI recommendations.
    
    Request body:
    {
        "assignments": [
            {
                "ticket_id": "IR12345",
                "support_group": "EUS - Some Location",
                "priority": 2
            }
        ]
    }
    
    Returns:
    {
        "results": [
            {
                "ticket_id": "IR12345",
                "success": true/false,
                "support_group": "assigned group",
                "message": "status message"
            }
        ],
        "errors": []  # Any non-fatal errors/warnings
    }
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
        
        # Initialize Athena client
        athena = Athena()
        
        results = []
        errors = []
        
        # Process each assignment
        for assignment in assignments:
            ticket_id = assignment.get('ticket_id')
            support_group = assignment.get('support_group')
            priority = assignment.get('priority')
            
            if not ticket_id:
                results.append({
                    'ticket_id': ticket_id or 'unknown',
                    'success': False,
                    'support_group': support_group,
                    'message': 'Missing ticket_id'
                })
                continue
            
            if not support_group:
                results.append({
                    'ticket_id': ticket_id,
                    'success': False,
                    'support_group': None,
                    'message': 'Missing support_group'
                })
                continue
            
            try:
                if DEBUG:
                    output.add_line(f"Assigning ticket {ticket_id} to support group: {support_group}")
                
                # Call modify_ticket to update the support group
                # Note: username is set to None to leave assignment unassigned (or you could set a specific user)
                athena.modify_ticket(
                    ticket_id=ticket_id,
                    username=None,  # Don't assign to a specific user, just update support group
                    priority=priority,
                    support_group=support_group
                )
                
                results.append({
                    'ticket_id': ticket_id,
                    'success': True,
                    'support_group': support_group,
                    'message': f'Successfully assigned to {support_group}'
                })
                
                if DEBUG:
                    output.add_line(f"Successfully assigned ticket {ticket_id}")
                
            except Exception as e:
                error_msg = str(e)
                if DEBUG:
                    output.add_line(f"Error assigning ticket {ticket_id}: {error_msg}")
                
                results.append({
                    'ticket_id': ticket_id,
                    'success': False,
                    'support_group': support_group,
                    'message': f'Error: {error_msg}'
                })
                errors.append(f"Ticket {ticket_id}: {error_msg}")
        
        if DEBUG:
            success_count = sum(1 for r in results if r['success'])
            output.add_line(f"Batch assignment complete: {success_count}/{len(results)} successful")
        
        return jsonify({
            'results': results,
            'errors': errors
        })
        
    except Exception as e:
        error_msg = f"Error in api_implement_assignments: {str(e)}"
        if DEBUG:
            output.add_line(error_msg)
        return jsonify({'error': error_msg}), 500


# ── Validation broadcast helpers ─────────────────────────────────────────────

def _broadcast_validation_event(event_type: str, data: dict, _buffer: bool = True):
    """
    Push a single SSE event to every connected validation-broadcast client.
    Dead queues (full) are removed silently.

    When _buffer=True and the current state is 'loading', the event is also
    appended to _validation_load_buffer so that clients connecting mid-load
    can replay missed events from the initial burst.
    """
    with _validation_lock:
        if _buffer and _validation_state == 'loading':
            _validation_load_buffer.append({'event': event_type, 'data': data})

        dead = []
        for sid, q in _validation_clients.items():
            try:
                q.put_nowait({'event': event_type, 'data': data})
            except _queue_module.Full:
                dead.append(sid)
        for sid in dead:
            del _validation_clients[sid]


def _format_validation_ticket(ticket: dict, index: int) -> dict:
    """Return the standard ticket dict used by all validation endpoints."""
    truncated_desc = ticket.get('description', '')[:32]
    if len(ticket.get('description', '')) > 32:
        truncated_desc += '...'
    return {
        'id':               ticket.get('id'),
        'title':            ticket.get('title'),
        'description':      truncated_desc,
        'full_description': ticket.get('description', ''),
        'priority':         ticket.get('priority'),
        'location':         ticket.get('location'),
        'created_at':       ticket.get('created_at'),
        'status':           ticket.get('status', ''),
        'assigned_to':      ticket.get('assigned_to', ''),
        'affected_user':    ticket.get('affected_user', ''),
        'source':           ticket.get('source', ''),
        'support_group':    ticket.get('support_group', ''),
        'resolution_notes': ticket.get('resolution_notes', ''),
        'index':            index,
    }


def _do_validation_fetch():
    """
    Background thread: fetch all validation tickets from Athena and broadcast
    each one to every connected client as it arrives.

    Tickets are fetched in PARALLEL using a ThreadPoolExecutor so that a
    single slow or hanging Athena call does not block all subsequent tickets.
    Each worker creates its own Athena instance to avoid token-sharing races.

    A total_timeout of 5 minutes caps the entire operation; any ticket whose
    fetch has not completed by then is reported as an error event.  The
    executor is shut down with wait=False so that lingering threads (e.g. an
    Athena call that has not yet hit its own 30-second socket timeout) do not
    block the broadcast from completing.

    Updates _validation_state / _validation_tickets / _validation_fetched_at.
    """
    global _validation_state, _validation_tickets, _validation_fetched_at
    output = Output()

    # ── Tuning knobs ──────────────────────────────────────────────────────────
    MAX_WORKERS   = 8    # concurrent Athena connections
    TOTAL_TIMEOUT = 300  # seconds before the entire fetch is abandoned
    # ─────────────────────────────────────────────────────────────────────────

    def _fetch_one(args):
        """Fetch a single ticket; each call gets its own Athena instance."""
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
        # Get the list of ticket IDs first (this call is still sequential)
        athena = Athena()
        ticket_ids = athena.get_validation_tickets()

        if not ticket_ids:
            with _validation_lock:
                _validation_state = 'idle'
            _broadcast_validation_event('count', {'count': 0})
            _broadcast_validation_event('complete', {'message': 'No validation tickets found', 'count': 0})
            if DEBUG:
                output.add_line('_do_validation_fetch: no tickets found')
            return

        total = len(ticket_ids)
        if DEBUG:
            output.add_line(f'_do_validation_fetch: fetching {total} tickets '
                            f'(parallel, {MAX_WORKERS} workers)')

        _broadcast_validation_event('count', {'count': total})

        fetched: list = []

        # Do NOT use a 'with' block — shutdown(wait=True) would block until
        # every thread finishes, including any that are hanging on Athena.
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS)
        future_to_args = {
            executor.submit(_fetch_one, (i, tid)): (i, tid)
            for i, tid in enumerate(ticket_ids)
        }

        try:
            for future in concurrent.futures.as_completed(
                    future_to_args, timeout=TOTAL_TIMEOUT):
                i, tid = future_to_args[future]
                try:
                    index, ticket_id, ticket, err = future.result()
                    if ticket:
                        vt = _format_validation_ticket(ticket, index)
                        fetched.append(vt)
                        _broadcast_validation_event('ticket', vt)
                        if DEBUG:
                            output.add_line(
                                f'_do_validation_fetch: broadcast ticket {ticket_id} '
                                f'(index {index})'
                            )
                    else:
                        _broadcast_validation_event('error', {
                            'index': index, 'ticket_id': ticket_id,
                            'message': err or 'Failed to fetch ticket data'
                        })
                except Exception as exc:
                    _broadcast_validation_event('error', {
                        'index': i, 'ticket_id': tid, 'message': str(exc)
                    })

        except concurrent.futures.TimeoutError:
            # Total timeout exceeded — mark remaining futures as timed out
            for future, (i, tid) in future_to_args.items():
                if not future.done():
                    output.add_line(
                        f'_do_validation_fetch: timeout waiting for ticket {tid}'
                    )
                    _broadcast_validation_event('error', {
                        'index': i, 'ticket_id': tid,
                        'message': 'Timeout: Athena did not respond in time'
                    })

        finally:
            # Release the executor without waiting for any lingering threads.
            # Athena's own 30-second socket timeout will clean them up.
            executor.shutdown(wait=False)

        with _validation_lock:
            _validation_state = 'loaded'
            _validation_tickets = fetched
            _validation_fetched_at = time.time()

        _broadcast_validation_event('complete', {'count': len(fetched)})
        if DEBUG:
            output.add_line(f'_do_validation_fetch: complete, {len(fetched)} tickets cached')

    except Exception as e:
        output.add_line(f'_do_validation_fetch: fatal error: {e}')
        with _validation_lock:
            _validation_state = 'idle'
        _broadcast_validation_event('error', {'message': str(e)})


@app.route('/api/trigger-validation-load', methods=['POST'])
def api_trigger_validation_load():
    """
    Any client can POST here to trigger a shared validation-ticket fetch.

    - If already loading → returns {status: 'loading'} immediately; the caller
      should wait on its /api/validation-broadcast SSE connection.
    - If loaded and cache is fresh → returns {status: 'already_loaded', count: N};
      the broadcast connection will replay the cache automatically on connect.
    - Otherwise → starts a background fetch and returns {status: 'loading_started'}.
    """
    global _validation_state, _validation_tickets, _validation_fetched_at

    now = time.time()
    with _validation_lock:
        state = _validation_state
        fetched_at = _validation_fetched_at
        cached_count = len(_validation_tickets)

    if state == 'loading':
        return jsonify({'status': 'loading'})

    if state == 'loaded' and (now - fetched_at) < VALIDATION_CACHE_TTL:
        return jsonify({'status': 'already_loaded', 'count': cached_count})

    # Transition to loading, clear the mid-load buffer, and kick off background fetch.
    # The buffer is cleared here (under the lock) so that any client connecting after
    # this point gets a fresh snapshot of only the current load session's events.
    with _validation_lock:
        _validation_state = 'loading'
        _validation_load_buffer.clear()

    # The 'state: loading' event is NOT buffered (_buffer=False) because clients
    # connecting mid-load receive it from the initial burst in generate(), not the buffer.
    _broadcast_validation_event('state', {'state': 'loading'}, _buffer=False)
    threading.Thread(target=_do_validation_fetch, daemon=True).start()

    if DEBUG:
        output = Output()
        output.add_line('api_trigger_validation_load: started background fetch')

    return jsonify({'status': 'loading_started'})


@app.route('/api/validation-broadcast', methods=['GET'])
def api_validation_broadcast():
    """
    Long-lived SSE connection for real-time validation-ticket synchronisation.

    All clients in Multiple-Tickets mode subscribe here.  When any client
    triggers a fetch via /api/trigger-validation-load, the server fetches once
    and broadcasts every ticket event to ALL connected clients.

    On connect:
    - If state == 'loaded' and cache is fresh → replay cached tickets immediately.
    - If state == 'loading'                   → send {state: 'loading'} so the
                                                 client can show a spinner.
    - If state == 'idle'                      → send {state: 'idle'}.

    A 30-second keepalive comment is sent while waiting for new events so that
    proxies / load-balancers do not close the idle connection.

    Query params:
    - session_id: the caller's presence session ID (used as the queue key)
    """
    session_id = request.args.get('session_id', '').strip()
    if not session_id:
        # Generate a throwaway key so the connection still works
        import uuid
        session_id = str(uuid.uuid4())

    client_queue: _queue_module.Queue = _queue_module.Queue(maxsize=200)

    # Register the client and snapshot state atomically.
    # Reading _validation_load_buffer under the same lock guarantees that any
    # event broadcast after this block will be in client_queue, and any event
    # broadcast before this block will be in load_buffer_snapshot — no gaps.
    with _validation_lock:
        _validation_clients[session_id] = client_queue
        current_state = _validation_state
        load_buffer_snapshot = list(_validation_load_buffer)
        cached_tickets = list(_validation_tickets)
        fetched_at = _validation_fetched_at

    now = time.time()
    cache_fresh = (now - fetched_at) < VALIDATION_CACHE_TTL

    def generate():
        try:
            # ── Initial state burst ───────────────────────────────────────────
            if current_state == 'loaded' and cache_fresh and cached_tickets:
                # Replay the full cached ticket list to this late-joining client
                yield f"event: state\ndata: {json.dumps({'state': 'loaded'})}\n\n"
                yield f"event: count\ndata: {json.dumps({'count': len(cached_tickets)})}\n\n"
                for ticket in cached_tickets:
                    yield f"event: ticket\ndata: {json.dumps(ticket)}\n\n"
                yield f"event: complete\ndata: {json.dumps({'count': len(cached_tickets)})}\n\n"

                # Replay recommendation state for late-joining clients
                with _recommendation_lock:
                    rec_toggle = _recommendation_toggle
                    rec_cache = dict(_recommendation_cache)
                yield f"event: recommendation-toggle\ndata: {json.dumps({'active': rec_toggle})}\n\n"
                for tid, rec_data in rec_cache.items():
                    yield f"event: recommendation-complete\ndata: {json.dumps({'ticket_id': tid, 'data': rec_data})}\n\n"
                if rec_cache:
                    yield f"event: recommendation-progress\ndata: {json.dumps({'completed': len(rec_cache), 'total': len(cached_tickets)})}\n\n"

                # Replay cross-client sync state for late-joining clients
                with _sync_lock:
                    sync_checkboxes = dict(_checkbox_state)
                    sync_assignments = {k: dict(v) for k, v in _assignment_selections.items()}
                    sync_next_poll = _next_poll_epoch_ms
                if sync_checkboxes:
                    yield f"event: sync-state-burst\ndata: {json.dumps({'checkboxes': sync_checkboxes, 'assignments': sync_assignments, 'next_poll_at': sync_next_poll})}\n\n"
            elif current_state == 'loading':
                # Send the loading state indicator first
                yield f"event: state\ndata: {json.dumps({'state': 'loading'})}\n\n"
                # Replay events that were broadcast before this client connected.
                # load_buffer_snapshot was captured atomically with client registration,
                # so together with the queue relay below it covers every event with
                # no gaps and no duplicates.
                for msg in load_buffer_snapshot:
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'])}\n\n"
            else:
                yield f"event: state\ndata: {json.dumps({'state': 'idle'})}\n\n"

            # ── Relay broadcast events ────────────────────────────────────────
            while True:
                try:
                    msg = client_queue.get(timeout=10)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'])}\n\n"
                except _queue_module.Empty:
                    # Send SSE keepalive comment every 10 s to prevent proxy /
                    # load-balancer idle-connection timeouts (most enterprise
                    # proxies drop idle connections after 60 s).
                    yield ': keepalive\n\n'

        finally:
            with _validation_lock:
                # Only remove this session's queue if it still points to THIS
                # generator's queue object.  A client that reconnected with the
                # same session_id will have already registered a new queue; we
                # must not evict it when this (old) generator finally exits.
                # Without this guard the old generator's cleanup races with the
                # new connection's registration and can silently drop the new
                # client from _validation_clients, causing it to never receive
                # the 'complete' event and leaving the UI stuck at loading.
                if _validation_clients.get(session_id) is client_queue:
                    _validation_clients.pop(session_id, None)
            if DEBUG:
                output = Output()
                output.add_line(f'api_validation_broadcast: client {session_id[:8]}… disconnected')

    return app.response_class(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        }
    )

# ─────────────────────────────────────────────────────────────────────────────


# ── Recommendation engine helpers ─────────────────────────────────────────────

def _process_single_recommendation(ticket_id):
    """
    Process a single ticket recommendation via the LLM pipeline and broadcast
    the result to all connected clients.

    Thread-safe: checks _recommendation_cache and _recommendation_processing
    under the lock before starting work.  Skips silently if the ticket already
    has a cached recommendation or is currently being processed.

    Respects _recommendation_stop_event: if the stop event is set before
    processing begins, the ticket is skipped.
    """
    output = Output()

    # Check stop event before starting expensive work
    if _recommendation_stop_event.is_set():
        return

    with _recommendation_lock:
        if ticket_id in _recommendation_cache:
            return  # Already have a recommendation
        if ticket_id in _recommendation_processing:
            return  # Already being processed by another thread
        _recommendation_processing.add(ticket_id)

    try:
        # Broadcast that we're starting this ticket
        _broadcast_validation_event('recommendation-start', {
            'ticket_id': ticket_id
        }, _buffer=False)

        if DEBUG:
            output.add_line(f'_process_single_recommendation: starting {ticket_id}')

        # Run the heavy LLM pipeline
        result = get_ticket_advice(ticket_id)

        # Check stop event again — if toggled off mid-processing, still cache
        # the result (work is already done) but don't start new ones.

        if result and 'error' not in result:
            with _recommendation_lock:
                _recommendation_cache[ticket_id] = result

            _broadcast_validation_event('recommendation-complete', {
                'ticket_id': ticket_id,
                'data': result
            }, _buffer=False)

            if DEBUG:
                output.add_line(f'_process_single_recommendation: completed {ticket_id}')
        else:
            error_msg = (result.get('error', 'Unknown error') if result
                         else 'No result returned')
            _broadcast_validation_event('recommendation-error', {
                'ticket_id': ticket_id,
                'error': error_msg
            }, _buffer=False)

            if DEBUG:
                output.add_line(f'_process_single_recommendation: error for {ticket_id}: {error_msg}')

    except Exception as exc:
        _broadcast_validation_event('recommendation-error', {
            'ticket_id': ticket_id,
            'error': str(exc)
        }, _buffer=False)
        if DEBUG:
            output.add_line(f'_process_single_recommendation: exception for {ticket_id}: {exc}')

    finally:
        with _recommendation_lock:
            _recommendation_processing.discard(ticket_id)

        # Broadcast progress update
        with _recommendation_lock:
            cached_count = len(_recommendation_cache)
        with _validation_lock:
            total_tickets = len(_validation_tickets)
        _broadcast_validation_event('recommendation-progress', {
            'completed': cached_count,
            'total': total_tickets
        }, _buffer=False)


def _do_recommendation_processing(ticket_ids):
    """
    Background thread: process recommendations for the given ticket IDs using
    a ThreadPoolExecutor with controlled concurrency.

    Stops submitting new work when _recommendation_stop_event is set, but
    allows in-flight requests to complete (their results are still cached).
    """
    output = Output()
    if DEBUG:
        output.add_line(f'_do_recommendation_processing: starting for {len(ticket_ids)} tickets')

    executor = concurrent.futures.ThreadPoolExecutor(
        max_workers=RECOMMENDATION_MAX_WORKERS
    )
    futures = {}

    try:
        for tid in ticket_ids:
            if _recommendation_stop_event.is_set():
                if DEBUG:
                    output.add_line('_do_recommendation_processing: stop event set, halting submissions')
                break
            with _recommendation_lock:
                if tid in _recommendation_cache or tid in _recommendation_processing:
                    continue
            future = executor.submit(_process_single_recommendation, tid)
            futures[future] = tid

        # Wait for submitted futures to complete (or timeout)
        for future in concurrent.futures.as_completed(futures, timeout=600):
            try:
                future.result()
            except Exception as exc:
                tid = futures[future]
                if DEBUG:
                    output.add_line(f'_do_recommendation_processing: future error for {tid}: {exc}')

    except concurrent.futures.TimeoutError:
        if DEBUG:
            output.add_line('_do_recommendation_processing: total timeout exceeded')

    finally:
        executor.shutdown(wait=False)
        if DEBUG:
            output.add_line('_do_recommendation_processing: finished')


def _queue_recommendations_for_tickets(ticket_ids):
    """
    Start a background thread to process recommendations for the given ticket IDs.
    Only processes tickets that are not already cached or in-progress.
    """
    # Filter out tickets that already have recommendations or are being processed
    with _recommendation_lock:
        ids_to_process = [
            tid for tid in ticket_ids
            if tid not in _recommendation_cache and tid not in _recommendation_processing
        ]

    if ids_to_process:
        _recommendation_stop_event.clear()
        threading.Thread(
            target=_do_recommendation_processing,
            args=(ids_to_process,),
            daemon=True
        ).start()

    return ids_to_process


@app.route('/api/toggle-recommendations', methods=['POST'])
def api_toggle_recommendations():
    """
    Toggle the recommendation engine on or off.

    When toggled ON:
    - Processes all loaded validation tickets that don't have recommendations yet.
    - Future new tickets (detected by polling) will be auto-processed.

    When toggled OFF:
    - Stops submitting new tickets for processing.
    - In-flight recommendations complete and are cached.
    - Existing cached recommendations are preserved.

    Request body: { "active": true/false }  (optional — defaults to toggling)
    Response:     { "active": true/false, "cached": N, "total": N, "processing": N }
    """
    global _recommendation_toggle
    output = Output()

    data = request.get_json(silent=True) or {}
    # If 'active' is explicitly provided, use it; otherwise toggle
    if 'active' in data:
        active = bool(data['active'])
    else:
        with _recommendation_lock:
            active = not _recommendation_toggle

    with _recommendation_lock:
        _recommendation_toggle = active

    # Broadcast toggle state to all connected clients
    _broadcast_validation_event('recommendation-toggle', {
        'active': active
    }, _buffer=False)

    if active:
        # Get all loaded ticket IDs and start processing those without recommendations
        with _validation_lock:
            loaded_tickets = list(_validation_tickets)

        ticket_ids = [t['id'] for t in loaded_tickets]
        ids_queued = _queue_recommendations_for_tickets(ticket_ids)

        # Broadcast initial progress
        with _recommendation_lock:
            cached_count = len(_recommendation_cache)
        total = len(loaded_tickets)
        _broadcast_validation_event('recommendation-progress', {
            'completed': cached_count,
            'total': total
        }, _buffer=False)

        if DEBUG:
            output.add_line(
                f'api_toggle_recommendations: ON — {len(ids_queued)} tickets queued, '
                f'{cached_count} already cached, {total} total'
            )
    else:
        # Signal the processing threads to stop submitting new work
        _recommendation_stop_event.set()

        if DEBUG:
            output.add_line('api_toggle_recommendations: OFF — stop event set')

    with _recommendation_lock:
        cached_count = len(_recommendation_cache)
        processing_count = len(_recommendation_processing)

    with _validation_lock:
        total_count = len(_validation_tickets)

    return jsonify({
        'active': active,
        'cached': cached_count,
        'total': total_count,
        'processing': processing_count
    })


@app.route('/api/recommendation-state', methods=['GET'])
def api_recommendation_state():
    """
    Return the current recommendation engine state and all cached recommendations.

    Used by clients on page load / reconnect to restore recommendation UI state
    without re-running the LLM pipeline.

    Response:
    {
        "active": true/false,
        "cache": { "IR12345": { ...recommendation data... }, ... },
        "processing": ["IR12346", ...],
        "total": N
    }
    """
    with _recommendation_lock:
        cache_copy = dict(_recommendation_cache)
        processing_list = list(_recommendation_processing)
        toggle_state = _recommendation_toggle

    with _validation_lock:
        total_count = len(_validation_tickets)

    return jsonify({
        'active': toggle_state,
        'cache': cache_copy,
        'processing': processing_list,
        'total': total_count
    })


# ── End recommendation engine helpers ─────────────────────────────────────────


# ── Consensus-based implement button helpers ──────────────────────────────────

def _get_consensus_state():
    """
    Build and return the current consensus state dict.
    Must be called with _consensus_lock already held OR after acquiring it.
    Thread-safe: acquires _presence_lock to read active session count.
    """
    with _presence_lock:
        active_count = len(_active_sessions)
    # _consensus_lock must be held by the caller
    return {
        'active': _consensus_active,
        'agreed': list(_consensus_votes),
        'required': active_count,
        'unlocked': _consensus_active and active_count > 0 and len(_consensus_votes) >= active_count
    }


def _broadcast_consensus_state():
    """
    Broadcast the current consensus state to all connected SSE clients.
    Acquires _consensus_lock internally.
    """
    with _consensus_lock:
        state = _get_consensus_state()
    _broadcast_validation_event('consensus-state', state, _buffer=False)


def _check_consensus_after_presence_change():
    """
    Called after a presence change (session expired, session left, new session).
    Adjusts consensus state:
    - Removes votes from sessions that are no longer active.
    - If only 1 user remains, auto-deactivates consensus.
    - If all remaining users have agreed, the button auto-unlocks.
    Broadcasts updated state if consensus is active.
    """
    global _consensus_active

    with _presence_lock:
        active_sids = set(_active_sessions.keys())
        active_count = len(active_sids)

    with _consensus_lock:
        if not _consensus_active:
            return

        # Remove votes from sessions that are no longer active
        stale_votes = _consensus_votes - active_sids
        if stale_votes:
            _consensus_votes -= stale_votes

        # If only 1 (or 0) users remain, consensus is no longer needed
        if active_count <= 1:
            _consensus_active = False
            _consensus_votes.clear()

    _broadcast_consensus_state()


@app.route('/api/consensus/activate', methods=['POST'])
def api_consensus_activate():
    """
    Activate consensus mode for the implement button.
    Called when a client detects >CONSENSUS_TICKET_THRESHOLD tickets selected
    with 2+ users present.

    Request body: { "session_id": "<uuid>" }
    Response:     current consensus state
    """
    global _consensus_active
    output = Output()

    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    with _presence_lock:
        active_count = len(_active_sessions)

    # Only activate if 2+ users are present
    if active_count < 2:
        return jsonify({'active': False, 'agreed': [], 'required': active_count, 'unlocked': False})

    with _consensus_lock:
        if not _consensus_active:
            _consensus_active = True
            _consensus_votes.clear()
            if DEBUG:
                output.add_line(f'api_consensus_activate: consensus mode activated by {session_id[:8] if session_id else "unknown"}')

    _broadcast_consensus_state()

    with _consensus_lock:
        state = _get_consensus_state()

    return jsonify(state)


@app.route('/api/consensus/vote', methods=['POST'])
def api_consensus_vote():
    """
    Record or remove a user's agreement vote for consensus unlock.

    Request body: { "session_id": "<uuid>", "agree": true/false }
    Response:     current consensus state
    """
    output = Output()

    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()
    agree = data.get('agree', True)

    if not session_id:
        return jsonify({'error': 'Missing session_id'}), 400

    with _consensus_lock:
        if not _consensus_active:
            return jsonify({'active': False, 'agreed': [], 'required': 0, 'unlocked': False})

        if agree:
            _consensus_votes.add(session_id)
        else:
            _consensus_votes.discard(session_id)

        if DEBUG:
            output.add_line(
                f'api_consensus_vote: {session_id[:8]}… voted {"agree" if agree else "disagree"} '
                f'({len(_consensus_votes)} votes)'
            )

    _broadcast_consensus_state()

    with _consensus_lock:
        state = _get_consensus_state()

    return jsonify(state)


@app.route('/api/consensus/deactivate', methods=['POST'])
def api_consensus_deactivate():
    """
    Deactivate consensus mode.
    Called when tickets are unchecked below the threshold or only 1 user remains.

    Request body: { "session_id": "<uuid>" }
    Response:     current consensus state
    """
    global _consensus_active
    output = Output()

    data = request.get_json(silent=True) or {}
    session_id = data.get('session_id', '').strip()

    with _consensus_lock:
        if _consensus_active:
            _consensus_active = False
            _consensus_votes.clear()
            if DEBUG:
                output.add_line(f'api_consensus_deactivate: consensus mode deactivated by {session_id[:8] if session_id else "unknown"}')

    _broadcast_consensus_state()

    return jsonify({'active': False, 'agreed': [], 'required': 0, 'unlocked': False})


@app.route('/api/consensus/state', methods=['GET'])
def api_consensus_state():
    """
    Return the current consensus state.
    Used by clients on page load / reconnect.
    """
    with _consensus_lock:
        state = _get_consensus_state()
    return jsonify(state)


# ── End consensus helpers ─────────────────────────────────────────────────────


# ── Cross-client state synchronisation endpoints ──────────────────────────────

@app.route('/api/sync-checkbox', methods=['POST'])
def api_sync_checkbox():
    """
    Synchronise checkbox state across all connected clients.

    Request body:
      { "ticket_id": "IR12345", "checked": true }
      OR
      { "select_all": true, "checked": true }

    Broadcasts a 'checkbox-sync' event to all SSE clients.
    """
    data = request.get_json(silent=True) or {}

    if 'select_all' in data:
        checked = bool(data.get('checked', False))
        # Update all checkbox states
        with _sync_lock:
            for tid in list(_checkbox_state.keys()):
                _checkbox_state[tid] = checked
            # Also set any tickets from validation cache that aren't in _checkbox_state yet
            with _validation_lock:
                for t in _validation_tickets:
                    _checkbox_state[t['id']] = checked
        _broadcast_validation_event('checkbox-sync', {
            'select_all': True,
            'checked': checked
        }, _buffer=False)
        return jsonify({'status': 'ok'})

    ticket_id = data.get('ticket_id', '').strip()
    if not ticket_id:
        return jsonify({'error': 'Missing ticket_id'}), 400

    checked = bool(data.get('checked', False))
    with _sync_lock:
        _checkbox_state[ticket_id] = checked

    _broadcast_validation_event('checkbox-sync', {
        'ticket_id': ticket_id,
        'checked': checked
    }, _buffer=False)

    return jsonify({'status': 'ok'})


@app.route('/api/sync-assignment-selection', methods=['POST'])
def api_sync_assignment_selection():
    """
    Synchronise support group / priority selection across all connected clients.

    Request body:
      {
        "ticket_id": "IR12345",
        "field": "support_group_radio" | "manual_support_group" | "priority_radio",
        "value": "<selected value or empty string to clear>"
      }

    Broadcasts an 'assignment-selection-sync' event to all SSE clients.
    """
    data = request.get_json(silent=True) or {}
    ticket_id = data.get('ticket_id', '').strip()
    field = data.get('field', '').strip()
    value = data.get('value', '')

    if not ticket_id or not field:
        return jsonify({'error': 'Missing ticket_id or field'}), 400

    if field not in ('support_group_radio', 'manual_support_group', 'priority_radio'):
        return jsonify({'error': f'Invalid field: {field}'}), 400

    with _sync_lock:
        if ticket_id not in _assignment_selections:
            _assignment_selections[ticket_id] = {}
        _assignment_selections[ticket_id][field] = value

    _broadcast_validation_event('assignment-selection-sync', {
        'ticket_id': ticket_id,
        'field': field,
        'value': value
    }, _buffer=False)

    return jsonify({'status': 'ok'})


@app.route('/api/sync-poll-timer', methods=['POST'])
def api_sync_poll_timer():
    """
    Broadcast the next poll epoch timestamp so all clients show the same countdown.

    Request body: { "next_poll_at": <epoch_ms> }
    Broadcasts a 'poll-timer-sync' event to all SSE clients.
    """
    global _next_poll_epoch_ms
    data = request.get_json(silent=True) or {}
    next_poll_at = data.get('next_poll_at', 0)

    with _sync_lock:
        _next_poll_epoch_ms = int(next_poll_at)

    _broadcast_validation_event('poll-timer-sync', {
        'next_poll_at': _next_poll_epoch_ms
    }, _buffer=False)

    return jsonify({'status': 'ok'})


@app.route('/api/sync-implement', methods=['POST'])
def api_sync_implement():
    """
    Broadcast implement-assignment lifecycle events to all connected clients.

    Request body:
      { "action": "started", "session_id": "<uuid>", "ticket_ids": [...] }
      OR
      { "action": "complete", "results": { ... } }

    Broadcasts 'implement-started' or 'implement-complete' events.
    """
    global _implement_in_progress
    data = request.get_json(silent=True) or {}
    action = data.get('action', '').strip()

    if action == 'started':
        with _sync_lock:
            _implement_in_progress = True
        _broadcast_validation_event('implement-started', {
            'session_id': data.get('session_id', ''),
            'ticket_ids': data.get('ticket_ids', [])
        }, _buffer=False)
        return jsonify({'status': 'ok'})

    elif action == 'complete':
        with _sync_lock:
            _implement_in_progress = False
        _broadcast_validation_event('implement-complete', {
            'results': data.get('results', {})
        }, _buffer=False)
        return jsonify({'status': 'ok'})

    return jsonify({'error': f'Invalid action: {action}'}), 400


@app.route('/api/sync-state', methods=['GET'])
def api_sync_state():
    """
    Return the full cross-client synchronisation state.
    Used by late-joining clients to restore checkbox, assignment, and timer state.

    Response:
    {
        "checkboxes": { "IR12345": true, ... },
        "assignments": { "IR12345": { "support_group_radio": "...", ... }, ... },
        "next_poll_at": <epoch_ms>,
        "implement_in_progress": false
    }
    """
    with _sync_lock:
        return jsonify({
            'checkboxes': dict(_checkbox_state),
            'assignments': {k: dict(v) for k, v in _assignment_selections.items()},
            'next_poll_at': _next_poll_epoch_ms,
            'implement_in_progress': _implement_in_progress
        })


# ── End cross-client state synchronisation endpoints ──────────────────────────


@app.route('/api/support-group-names', methods=['GET'])
def api_support_group_names():
    """Return a sorted list of all support group names for the manual selector dropdown."""
    try:
        keywords_path = os.path.join(os.path.dirname(__file__), 'services', 'support_group_keywords.json')
        with open(keywords_path, 'r', encoding='utf-8') as f:
            groups = json.load(f)
        names = sorted([g['name'] for g in groups if 'name' in g])
        return jsonify(names)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _warm_up_warehouse():
    """
    Start the Databricks SQL warehouse in the background at app startup.
    This ensures the warehouse is running before the first user request arrives,
    avoiding cold-start delays on methods like similarity_search.
    """
    output = Output()
    try:
        output.add_line("Warehouse warm-up: initiating SQL warehouse start...")
        db = Databricks()
        success = db.start_warehouse(wait_for_running=True, timeout=300)
        if success:
            output.add_line("Warehouse warm-up: SQL warehouse is RUNNING and ready")
        else:
            output.add_line("Warehouse warm-up: warehouse did not reach RUNNING state within timeout")
    except Exception as e:
        output.add_line(f"Warehouse warm-up: unexpected error: {str(e)}")


if __name__ == '__main__':
    import threading
    # When Flask runs in debug mode it uses a reloader that spawns a child process.
    # WERKZEUG_RUN_MAIN is set to 'true' only in the child (the actual serving process),
    # so we start the warm-up thread there to avoid firing it twice.
    # When debug=False (production), the condition is also satisfied.
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        threading.Thread(target=_warm_up_warehouse, daemon=True).start()
    app.run(host='0.0.0.0', debug=True, threaded=True)
    # get_ticket_advice("IR10256351")
