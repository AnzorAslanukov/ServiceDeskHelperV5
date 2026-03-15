"""
Standardized ticket data formatting.

Provides a single function to normalize ticket data from any source
(Athena, Databricks) into the consistent frontend format.  This
eliminates the 5+ duplicate field-mapping blocks in the old run.py.
"""


def format_ticket_from_databricks(ticket_dict: dict) -> dict:
    """
    Map a Databricks athena_tickets row to the standard frontend ticket format.

    Args:
        ticket_dict: Raw row from ``prepared.ticketing.athena_tickets``.

    Returns:
        dict with keys expected by the frontend TicketRenderer.
    """
    return {
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
        'resolutionNotes': ticket_dict.get('resolution_notes'),
    }


def format_ticket_from_athena(ticket_dict: dict) -> dict:
    """
    Map an Athena API response ticket to the standard frontend ticket format.

    Args:
        ticket_dict: Single ticket dict returned by ``Athena.get_ticket_data()``.

    Returns:
        dict with keys expected by the frontend TicketRenderer.
    """
    return {
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
        'contactMethod': ticket_dict.get('contact_method'),
    }


def format_validation_ticket(ticket: dict, index: int) -> dict:
    """
    Return the standard validation-ticket dict used by all validation endpoints.

    Truncates the description to 32 characters for the accordion preview and
    includes the full description for expansion.

    Args:
        ticket: Raw ticket dict from Athena.
        index:  Positional index for ordering in the accordion.

    Returns:
        dict ready to be JSON-serialized and sent to the frontend.
    """
    truncated_desc = ticket.get('description', '')[:32]
    if len(ticket.get('description', '')) > 32:
        truncated_desc += '...'

    return {
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
        'index': index,
    }