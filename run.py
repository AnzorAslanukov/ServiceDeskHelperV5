from flask import Flask, render_template, send_from_directory, request, jsonify
import json
import numpy as np
import sys
import os
from sklearn.metrics.pairwise import cosine_similarity
from services.athena import Athena
from services.databricks import Databricks
from services.embedding_model import EmbeddingModel
from services.text_generation_model import TextGenerationModel
from services.prompts import PROMPTS

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

    # Load embeddings from jsonl file
    embeddings_file = 'ir_embeddings.jsonl'
    ids_and_embeddings = []

    try:
        with open(embeddings_file, 'r') as f:
            for line_num, line in enumerate(f):
                obj = json.loads(line.strip())
                ticket_id = obj['id']
                ticket_embedding = np.array(obj['ticket_embedding'])
                ids_and_embeddings.append((ticket_id, ticket_embedding))

        output.add_line(f"Loaded {len(ids_and_embeddings)} ticket embeddings from {embeddings_file}")

    except FileNotFoundError:
        output.add_line(f"Error: {embeddings_file} not found")
        return []
    except Exception as e:
        output.add_line(f"Error loading embeddings: {str(e)}")
        return []

    if not ids_and_embeddings:
        output.add_line("No embeddings loaded")
        return []

    # Prepare search embedding
    search_emb = np.array(search_embedding).reshape(1, -1)

    # Prepare all ticket embeddings
    ticket_embs = np.array([emb for _, emb in ids_and_embeddings])

    # Compute cosine similarities
    output.add_line("Computing cosine similarities...")
    similarities = cosine_similarity(search_emb, ticket_embs)[0]

    # Get top max_results indices sorted by similarity descending
    top_indices = np.argsort(similarities)[-max_results:][::-1]

    top_ticket_ids = [ids_and_embeddings[i][0] for i in top_indices]
    top_similarities = [similarities[i] for i in top_indices]

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
    return tickets

def ticket_vector_search(ticket_number, max_results=5):
    """
    Perform vector search based on a ticket number:
    1. Get ticket details from Athena using ticket_number
    2. Combine title and description for embedding
    3. Perform vector similarity search against pre-stored embeddings
    4. Return similar ticket details from Databricks
    """
    from services.output import Output
    output = Output()

    output.add_line(f"Starting ticket-based vector search for ticket: {ticket_number}")

    # Step 1: Get ticket details from Athena
    athena = Athena()
    ticket_result = athena.get_ticket_data(ticket_number=ticket_number, view=True)

    if not ticket_result or 'result' not in ticket_result or not ticket_result['result']:
        output.add_line(f"Could not retrieve ticket {ticket_number} from Athena")
        return []

    ticket_data = ticket_result['result'][0]  # Get the first result
    ticket_title = ticket_data.get('title', '')
    ticket_description = ticket_data.get('description', '')

    # Step 2: Combine title and description for embedding
    search_text = f"{ticket_title} {ticket_description}".strip()
    if not search_text:
        output.add_line(f"No searchable text in ticket {ticket_number}")
        return []

    output.add_line(f"Search text from ticket {ticket_number}: '{search_text[:100]}{'...' if len(search_text) > 100 else ''}'")

    # Step 3: Generate embedding for the ticket content
    emb_model = EmbeddingModel()
    search_embedding = emb_model.get_embedding(search_text)

    if not search_embedding:
        output.add_line("Embedding generation failed")
        return []

    output.add_line(f"Generated embedding with {len(search_embedding)} dimensions")

    # Step 4: Load embeddings from jsonl file and perform similarity search
    embeddings_file = 'ir_embeddings.jsonl'
    ids_and_embeddings = []

    try:
        with open(embeddings_file, 'r') as f:
            for line_num, line in enumerate(f):
                obj = json.loads(line.strip())
                ticket_id = obj['id']
                ticket_embedding = np.array(obj['ticket_embedding'])
                ids_and_embeddings.append((ticket_id, ticket_embedding))

        output.add_line(f"Loaded {len(ids_and_embeddings)} ticket embeddings from {embeddings_file}")

    except FileNotFoundError:
        output.add_line(f"Error: {embeddings_file} not found")
        return []
    except Exception as e:
        output.add_line(f"Error loading embeddings: {str(e)}")
        return []

    if not ids_and_embeddings:
        output.add_line("No embeddings loaded")
        return []

    # Prepare search embedding
    search_emb = np.array(search_embedding).reshape(1, -1)

    # Prepare all ticket embeddings
    ticket_embs = np.array([emb for _, emb in ids_and_embeddings])

    # Compute cosine similarities
    output.add_line("Computing cosine similarities...")
    similarities = cosine_similarity(search_emb, ticket_embs)[0]

    # Get top max_results indices sorted by similarity descending
    top_indices = np.argsort(similarities)[-max_results:][::-1]

    top_ticket_ids = [ids_and_embeddings[i][0] for i in top_indices]
    top_similarities = [similarities[i] for i in top_indices]

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
    from services.output import Output
    import json

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

    # Get similar tickets
    similar_tickets = ticket_vector_search(ticket_number, max_results=5)

    if DEBUG:
        output.add_line(f"similar_tickets:\n{similar_tickets}")

    # Extract fields for original
    def extract_fields(ticket):
        return {
            "title": ticket.get("title", ""),
            "description": ticket.get("description", ""),
            "priority": ticket.get("priority", "") or ticket.get("priorityValue", ""),
            "locationValue": ticket.get("locationValue", ""),
            "floorValue": ticket.get("floorValue", ""),
            "affectedUser_Department": ticket.get("affectedUser_Department", ""),
            "affectedUser_Title": ticket.get("affectedUser_Title", "")
        }

    structured_data = {
        "original_ticket": extract_fields(original_data),
        "similar_tickets": similar_tickets
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
        output.add_line(f"Recommended Support Group: {assignment_result.get('recommended_support_group', 'N/A')}")
        output.add_line(f"Recommended Priority Level: {assignment_result.get('recommended_priority_level', 'N/A')}")
        output.add_line("Detailed Explanation:")
        output.add_line(assignment_result.get('detailed_explanation', 'N/A'))

        # Return the structured data for frontend display
        return {
            'original_data': original_data,
            'similar_tickets': similar_tickets,
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
    app.run(host='0.0.0.0', debug=True)
