from flask import Flask, render_template, send_from_directory, request, jsonify
import json
import sys
import os
import concurrent.futures
from services.athena import Athena
from services.databricks import Databricks
from services.embedding_model import EmbeddingModel
from services.text_generation_model import TextGenerationModel
from services.prompts import PROMPTS
from services.field_mapping import FieldMapper

# Add current directory to path for imports when running as script
sys.path.insert(0, os.path.dirname(__file__))

from services.output import Output

DEBUG = True  # Global debug setting for print statements

app = Flask(__name__, template_folder='app/templates', static_folder='app/static')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(app.static_folder, 'images/upenn_logo_simplified.ico')

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
        available_support_groups (list): List of all valid support group names

    Returns:
        str: Best matching location-specific EUS group, or original location_string if no match
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
        group_upper = str(group).upper()
        if not any(exclude in group_upper for exclude in ['NETWORK', 'CPD', 'RFID']):
            filtered_groups.append(group)

    # Score each filtered group by location keyword matches
    scored_groups = []
    for group in filtered_groups:
        score = 0
        group_upper = str(group).upper()

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
            scored_groups.append((group, score))

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

    # Get all available support groups for this ticket type
    available_support_groups = FieldMapper.get_all_labels(ticket_type=ticket_type.lower())

    if DEBUG:
        output.add_line(f"Available support groups ({len(available_support_groups)} total): {available_support_groups[:10]}{'...' if len(available_support_groups) > 10 else ''}")

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
        "available_support_groups": available_support_groups
    }

    # Convert to JSON string
    json_data = json.dumps(structured_data, indent=2)

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
        output.add_line(f"Recommended Priority Level: {assignment_result.get('recommended_priority_level', 'N/A')}")
        output.add_line("Detailed Explanation:")
        output.add_line(assignment_result.get('detailed_explanation', 'N/A'))

        # Return the structured data for frontend display
        return {
            'original_data': original_data,
            'similar_tickets': similar_tickets,
            'onenote_documentation': onenote_docs,
            'recommended_support_group': assignment_result.get('recommended_support_group'),
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

if __name__ == '__main__':
    # app.run(host='0.0.0.0', debug=True)
    get_ticket_advice("IR10226122")
