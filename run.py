from flask import Flask, render_template, send_from_directory, request, jsonify
from services.athena import Athena

app = Flask(__name__, template_folder='app/templates', static_folder='app/static')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(app.static_folder, 'images/upenn_logo_simplified.ico')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/search-tickets', methods=['POST'])
def search_tickets():
    data = request.get_json()
    if not data or 'contactMethod' not in data:
        return jsonify({'error': 'Missing contactMethod'}), 400
    
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

if __name__ == '__main__':
    app.run(debug=True)
