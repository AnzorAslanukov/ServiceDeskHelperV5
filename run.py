from flask import Flask, render_template, send_from_directory, request, jsonify
import json
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from services.athena import Athena
from services.databricks import Databricks
from services.embedding_model import EmbeddingModel

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

    # Define column names based on the expected order from Databricks
    col_names = [
        'TicketType', 'Location', 'Floor', 'Room', 'CreatedDate', 'ResolvedDate', 'Priority', 'Id', 'Title',
        'Description', 'SupportGroup', 'Source', 'Status', 'Impact', 'Urgency', 'AssignedToUserName',
        'AffectedUserName', 'LastModifiedDate', 'Escalated', 'First_Call_Resolution', 'Classification/Area',
        'ResolutionCategory', 'ResolutionNotes', 'CommandCenter', 'ConfirmedResolution', 'Increments',
        'FeedbackValue', 'Feedback_Notes', 'Tags', 'Specialty', 'Next_Steps', 'User_Assign_Change', 'Support_Group_Change'
    ]

    tickets = []
    for row in result['data']:
        ticket_dict = dict(zip(col_names, row))

        # Map to expected ticket format (same as exact_description_search)
        ticket = {
            'id': ticket_dict.get('Id'),
            'title': ticket_dict.get('Title'),
            'description': ticket_dict.get('Description'),
            'statusValue': ticket_dict.get('Status'),
            'priorityValue': ticket_dict.get('Priority'),
            'assignedTo_DisplayName': ticket_dict.get('AssignedToUserName', ''),
            'affectedUser_DisplayName': ticket_dict.get('AffectedUserName', ''),
            'createdDate': ticket_dict.get('CreatedDate'),
            'completedDate': ticket_dict.get('ResolvedDate'),
            'locationValue': ticket_dict.get('Location'),
            'sourceValue': ticket_dict.get('Source'),
            'supportGroupValue': ticket_dict.get('SupportGroup'),
            'resolutionNotes': ticket_dict.get('ResolutionNotes')
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

    # Define column names based on the expected order from Databricks
    col_names = [
        'TicketType', 'Location', 'Floor', 'Room', 'CreatedDate', 'ResolvedDate', 'Priority', 'Id', 'Title',
        'Description', 'SupportGroup', 'Source', 'Status', 'Impact', 'Urgency', 'AssignedToUserName',
        'AffectedUserName', 'LastModifiedDate', 'Escalated', 'First_Call_Resolution', 'Classification/Area',
        'ResolutionCategory', 'ResolutionNotes', 'CommandCenter', 'ConfirmedResolution', 'Increments',
        'FeedbackValue', 'Feedback_Notes', 'Tags', 'Specialty', 'Next_Steps', 'User_Assign_Change', 'Support_Group_Change'
    ]

    tickets = []
    for row in result['data']:
        ticket_dict = dict(zip(col_names, row))

        # Map to expected ticket format
        ticket = {
            'id': ticket_dict.get('Id'),
            'title': ticket_dict.get('Title'),
            'description': ticket_dict.get('Description'),
            'statusValue': ticket_dict.get('Status'),
            'priorityValue': ticket_dict.get('Priority'),
            'assignedTo_DisplayName': ticket_dict.get('AssignedToUserName', ''),
            'affectedUser_DisplayName': ticket_dict.get('AffectedUserName', ''),
            'createdDate': ticket_dict.get('CreatedDate'),
            'completedDate': ticket_dict.get('ResolvedDate'),
            'locationValue': ticket_dict.get('Location'),
            'sourceValue': ticket_dict.get('Source'),
            'supportGroupValue': ticket_dict.get('SupportGroup'),
            'resolutionNotes': ticket_dict.get('ResolutionNotes')
        }
        tickets.append(ticket)

    return tickets

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
                return jsonify(result)
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
    else:
        return jsonify({'error': 'Missing search parameter (contactMethod, description, or semanticDescription)'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)
