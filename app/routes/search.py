"""
Search routes — /api/search-tickets and /api/support-group-names.
"""

import json
import os

from flask import Blueprint, request, jsonify

from services.athena import Athena
from app.logic.search import semantic_search, exact_description_search, ticket_vector_search
from app.logic.ticket_format import format_ticket_from_athena

search_bp = Blueprint('search', __name__)


@search_bp.route('/api/search-tickets', methods=['POST'])
def search_tickets():
    data = request.get_json()

    if 'contactMethod' in data:
        return _search_by_phone(data)
    elif 'description' in data:
        return _search_by_description(data)
    elif 'semanticDescription' in data:
        return _search_by_semantic(data)
    elif 'ticketId' in data:
        return _search_by_ticket(data)
    else:
        return jsonify({
            'error': 'Missing search parameter '
                     '(contactMethod, description, semanticDescription, or ticketId)'
        }), 400


@search_bp.route('/api/support-group-names', methods=['GET'])
def support_group_names():
    """Return a sorted list of all support group names for the manual selector."""
    try:
        keywords_path = os.path.join(
            os.path.dirname(__file__), '..', '..', 'services', 'support_group_keywords.json'
        )
        with open(keywords_path, 'r', encoding='utf-8') as f:
            groups = json.load(f)
        names = sorted([g['name'] for g in groups if 'name' in g])
        return jsonify(names)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Private helpers ───────────────────────────────────────────────────────────

def _search_by_phone(data: dict):
    search_value = data['contactMethod']
    try:
        athena = Athena()
        result = athena.get_ticket_data(conditions={
            'contactMethod': search_value,
            'contactMethodContains': False,
        })

        if not result:
            return jsonify({'error': 'No results found'}), 404

        tickets = [format_ticket_from_athena(t) for t in result['result']]

        return jsonify({
            'currentPage': result.get('currentPage', 1),
            'resultCount': len(tickets),
            'pageSize': result.get('pageSize', 1000),
            'hasMoreResults': result.get('hasMoreResults', False),
            'result': tickets,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _search_by_description(data: dict):
    search_value = data['description']
    try:
        tickets = exact_description_search(search_value, max_results=5)
        return jsonify({
            'currentPage': 1,
            'resultCount': len(tickets),
            'pageSize': 5,
            'hasMoreResults': False,
            'result': tickets,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _search_by_semantic(data: dict):
    search_value = data['semanticDescription']
    try:
        tickets = semantic_search(search_value, max_results=5)
        return jsonify({
            'currentPage': 1,
            'resultCount': len(tickets),
            'pageSize': 5,
            'hasMoreResults': False,
            'result': tickets,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _search_by_ticket(data: dict):
    search_value = data['ticketId']
    try:
        tickets = ticket_vector_search(search_value, max_results=5)
        return jsonify({
            'currentPage': 1,
            'resultCount': len(tickets),
            'pageSize': 5,
            'hasMoreResults': False,
            'result': tickets,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500