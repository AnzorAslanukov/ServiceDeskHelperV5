"""
Support group loading and EUS-to-location mapping logic.
"""

import json
import os
import re

from services.output import Output
from app.config import DEBUG


def load_support_groups_from_json(ticket_type: str = "ir") -> list[dict]:
    """
    Load support groups from ``support_group_description.json`` filtered by
    *ticket_type* (``"ir"`` or ``"sr"``).

    Returns:
        List of dicts with ``name``, ``fullname``, and ``description`` for
        each group that has a non-null description and matches the ticket type.
    """
    output = Output()
    json_path = os.path.join(
        os.path.dirname(__file__), '..', '..', 'services', 'support_group_description.json'
    )

    if DEBUG:
        output.add_line(f"Loading support groups from: {json_path}")
        output.add_line(f"Filtering for ticket_type: {ticket_type}")

    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            support_groups = json.load(f)

        filtered_groups = [
            {
                'name': g.get('name', ''),
                'fullname': g.get('fullname', ''),
                'description': g.get('description', ''),
            }
            for g in support_groups
            if (
                g.get('ticket_type') == ticket_type.lower()
                and g.get('description') is not None
                and g.get('name') != "--Please Select a Support Group--"
            )
        ]

        if DEBUG:
            output.add_line(
                f"Loaded {len(filtered_groups)} support groups "
                f"for ticket_type '{ticket_type}'"
            )

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


def map_eus_to_location_group(
    location_string: str,
    available_support_groups: list[dict],
) -> str:
    """
    Map a generic ``'EUS'`` recommendation to a location-specific EUS group
    based on the ticket's location string.

    Args:
        location_string: e.g. ``"RITTENHOUSE - MAIN BLDG (1800 LOMBARD)"``
        available_support_groups: List of dicts with a ``'name'`` key.

    Returns:
        Best matching location-specific EUS group name, or ``'EUS'`` if no
        match is found.
    """
    if not location_string or not available_support_groups:
        return "EUS"

    # ── Extract location keywords ─────────────────────────────────────────
    location_parts: list[str] = []
    separators = [
        ' - ', ' (', '(', ' MAIN ', ' CENTER', ' HOSPITAL',
        ' MEDICAL', ' BUILDING', ' BLDG',
    ]
    for sep in separators:
        if sep in str(location_string).upper():
            parts = str(location_string).upper().split(sep, 1)
            if parts[0] and len(parts[0]) > 2:
                location_parts.append(parts[0].strip())
            break

    if not location_parts:
        upper_loc = str(location_string).upper()
        known_locations = [
            'RITTENHOUSE', 'CHERRY HILL', 'WIDENER', 'PMUC',
            'PAHC', 'PRESTON', 'HUP', 'PAH', 'MARKET',
        ]
        for candidate in known_locations:
            if candidate in upper_loc:
                location_parts = [candidate]
                break

    if not location_parts:
        words = str(location_string).upper().split()
        for word in words[:3]:
            cleaned = word.replace('(', '').replace(')', '').replace(',', '')
            if len(cleaned) >= 4 and cleaned.isalnum():
                location_parts = [cleaned]
                break

    if not location_parts:
        return "EUS"

    # ── Filter out irrelevant groups ──────────────────────────────────────
    excluded = {'NETWORK', 'CPD', 'RFID'}
    filtered_groups = [
        g for g in available_support_groups
        if not any(ex in str(g.get('name', '')).upper() for ex in excluded)
    ]

    # ── Score each group ──────────────────────────────────────────────────
    scored: list[tuple[str, int]] = []
    for group in filtered_groups:
        group_name = group.get('name', '')
        group_upper = str(group_name).upper()
        score = 0

        for loc_part in location_parts:
            if loc_part in group_upper:
                score += 3
            if re.search(r'\b' + re.escape(loc_part) + r'\b', group_upper):
                score += 2
            for word in group_upper.split():
                if word.startswith(loc_part) or loc_part.startswith(word):
                    score += 1

        # Common abbreviation mappings
        abbreviation_map = {
            'RITTENHOUSE': 'RITT',
            'CHERRY HILL': 'RSI',
            'WIDENER': 'WIDENER',
            'MARKET': 'PMUC',
            'PRESTON': 'PRES',
        }
        for loc_part in location_parts:
            abbrev = abbreviation_map.get(loc_part)
            if abbrev and abbrev in group_upper:
                score += 3
            if loc_part.startswith('PAH') and 'PAH' in group_upper:
                score += 3
            if loc_part.startswith('HUP') and 'HUP' in group_upper:
                score += 3

        if score > 0:
            scored.append((group_name, score))

    if scored:
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[0][0]

    return "EUS"