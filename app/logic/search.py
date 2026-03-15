"""
Search logic — semantic, exact-match, and ticket-based vector search.

All functions are pure business logic with no Flask dependency.
They return lists of frontend-formatted ticket dicts.
"""

from services.databricks import Databricks
from services.embedding_model import EmbeddingModel
from services.athena import Athena
from services.output import Output
from app.config import DEBUG
from app.logic.ticket_format import format_ticket_from_databricks


def _fetch_tickets_from_databricks(ticket_ids: list[str]) -> list[dict]:
    """
    Given a list of ticket IDs, retrieve full details from the Databricks
    ``athena_tickets`` table and return them in the standard frontend format.
    """
    if not ticket_ids:
        return []

    ids_string = ','.join(f"'{tid}'" for tid in ticket_ids)
    query = (
        f"SELECT * FROM prepared.ticketing.athena_tickets "
        f"WHERE Id IN ({ids_string})"
    )

    db = Databricks()
    result = db.execute_sql_query(query)

    if not result or result.get('status') != 'success' or not result.get('data'):
        return []

    return [format_ticket_from_databricks(row) for row in result['data']]


def semantic_search(description: str, max_results: int = 5) -> list[dict]:
    """
    Embed *description* and find the most similar tickets via Databricks
    vector search, then retrieve full ticket details.
    """
    output = Output()
    output.add_line(f"Starting semantic search for: '{description}'")

    emb_model = EmbeddingModel()
    search_embedding = emb_model.get_embedding(description)

    if not search_embedding:
        output.add_line("Embedding generation failed, returned empty")
        return []

    output.add_line(f"Generated embedding with {len(search_embedding)} dimensions")

    db = Databricks()
    table_name = "scratchpad.aslanuka.ir_embeddings"
    output.add_line("Performing similarity search on Databricks ir_embeddings table...")
    embedding_results = db.similarity_search(table_name, description, limit=max_results)

    if not embedding_results:
        output.add_line("No similar tickets found")
        return []

    top_ticket_ids = [r['id'] for r in embedding_results]
    top_similarities = [float(r['similarity']) for r in embedding_results]

    output.add_line(f"Top {len(top_ticket_ids)} similar tickets: {top_ticket_ids}")
    output.add_line(f"Similarities: {[f'{s:.4f}' for s in top_similarities]}")

    tickets = _fetch_tickets_from_databricks(top_ticket_ids)
    output.add_line(f"Retrieved {len(tickets)} ticket details from Databricks")

    if tickets and DEBUG:
        _log_ticket_details(output, tickets)

    return tickets


def exact_description_search(description: str, max_results: int = 5) -> list[dict]:
    """
    Perform an exact (SQL LIKE) description search on the Databricks
    ``athena_tickets`` table.
    """
    query = (
        f"SELECT * FROM prepared.ticketing.athena_tickets "
        f"WHERE Description LIKE '%{description}%' LIMIT {max_results}"
    )

    db = Databricks()
    result = db.execute_sql_query(query)

    if not result or result.get('status') != 'success' or not result.get('data'):
        return []

    return [format_ticket_from_databricks(row) for row in result['data']]


def ticket_vector_search(
    ticket_number: str | None = None,
    ticket_data: dict | None = None,
    max_results: int = 5,
) -> list[dict]:
    """
    Perform vector search based on a ticket's content.

    If *ticket_data* is provided it is used directly (avoids a redundant
    Athena call).  Otherwise *ticket_number* is fetched from Athena first.
    """
    output = Output()
    output.add_line(f"Starting ticket-based vector search for ticket: {ticket_number}")

    # Resolve ticket data
    if ticket_data is not None:
        if DEBUG:
            output.add_line("Using provided ticket_data (avoiding redundant Athena call)")
    elif ticket_number is not None:
        athena = Athena()
        ticket_result = athena.get_ticket_data(ticket_number=ticket_number, view=True)
        if not ticket_result or 'result' not in ticket_result or not ticket_result['result']:
            output.add_line(f"Could not retrieve ticket {ticket_number} from Athena")
            return []
        ticket_data = ticket_result['result'][0]
    else:
        output.add_line("Either ticket_number or ticket_data must be provided")
        return []

    # Build search text
    search_text = f"{ticket_data.get('title', '')} {ticket_data.get('description', '')}".strip()
    if not search_text:
        output.add_line(f"No searchable text in ticket {ticket_data.get('id', 'unknown')}")
        return []

    output.add_line(
        f"Search text from ticket {ticket_data.get('id', 'unknown')}: "
        f"'{search_text[:100]}{'...' if len(search_text) > 100 else ''}'"
    )

    # Generate embedding
    emb_model = EmbeddingModel()
    search_embedding = emb_model.get_embedding(search_text)
    if not search_embedding:
        output.add_line("Embedding generation failed")
        return []

    output.add_line(f"Generated embedding with {len(search_embedding)} dimensions")

    # Similarity search
    db_sim = Databricks()
    table_name = "scratchpad.aslanuka.ir_embeddings"
    output.add_line("Performing similarity search on Databricks ir_embeddings table...")
    embedding_results = db_sim.similarity_search(table_name, search_text, limit=max_results)

    if not embedding_results:
        output.add_line("No similar tickets found")
        return []

    top_ticket_ids = [r['id'] for r in embedding_results]
    top_similarities = [float(r['similarity']) for r in embedding_results]

    output.add_line(f"Top {len(top_ticket_ids)} similar tickets: {top_ticket_ids}")
    output.add_line(f"Similarities: {[f'{s:.4f}' for s in top_similarities]}")

    tickets = _fetch_tickets_from_databricks(top_ticket_ids)
    output.add_line(f"Retrieved {len(tickets)} ticket details from Databricks")
    return tickets


# ── Logging helper ────────────────────────────────────────────────────────────

def _log_ticket_details(output: Output, tickets: list[dict]) -> None:
    """Write a human-readable summary of *tickets* to the debug output."""
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