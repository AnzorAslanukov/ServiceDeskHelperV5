from flask import Flask, render_template, send_from_directory, request, jsonify
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
    similar ticket vectors in Databricks, then retrieving full details from Athena.
    """
    emb_model = EmbeddingModel()
    search_embedding = emb_model.get_embedding(description)

    if not search_embedding:
        return []

    # Convert embedding to SQL array format (float values)
    embedding_str = ','.join([str(float(x)) for x in search_embedding])
    sql_array = f"ARRAY[{embedding_str}]"

    # Vector similarity query using cosine distance
    query = f"""
        SELECT id, array_distance(embedding, {sql_array}) as distance
        FROM scratchpad.aslanuka.ir_embeddings
        ORDER BY distance ASC
        LIMIT {max_results}
    """

    db = Databricks()
    result = db.execute_sql_query(query)

    if not result or result.get('status') != 'success' or not result.get('data'):
        return []

    # Extract top ticket IDs from similarity search
    ticket_ids = [row[0] for row in result['data']]

    # Retrieve full ticket details from Athena
    athena = Athena()
    tickets = []

    for ticket_id in ticket_ids:
        try:
            # Get detailed view of each ticket
            detail_result = athena.get_ticket_data(ticket_number=ticket_id, view=True)

            if detail_result and 'result' in detail_result and detail_result['result']:
                # Assuming Athena returns similar structure to conditions search
                ticket = detail_result['result'][0]  # First result
                tickets.append(ticket)
            else:
                # Fallback if details not available
                tickets.append({
                    'id': ticket_id,
                    'title': f'Ticket {ticket_id} (details unavailable)',
                    'description': 'Could not retrieve ticket details.'
                })
        except Exception as e:
            # Continue with partial results
            tickets.append({
                'id': ticket_id,
                'title': f'Ticket {ticket_id} (error loading details)',
                'description': f'Error retrieving ticket: {str(e)}'
            })

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
            'supportGroupValue': ticket_dict.get('SupportGroup')
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
    else:
        return jsonify({'error': 'Missing search parameter (contactMethod or description)'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)
