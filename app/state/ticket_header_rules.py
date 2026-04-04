"""
Inviolable ticket-header rules — single source of truth for editor attribution.

This module defines the **complete, exhaustive** set of rules that determine
each ticket's header styling and editor attribution.  No other module —
backend or frontend — is permitted to compute header properties (style,
color, attribution labels).

The function is **pure**: given the original AI recommendations, the current
user selections, and the editor info, it returns a deterministic header-state
dict.  It has no side-effects and does not import any mutable state modules.

Inviolable conditions
=====================

HEADER STYLE
  • ``'default'``        — no user changes; all fields match the original AI
                           recommendations.
  • ``'editor-changed'`` — at least one AI radio (support group or priority)
                           was changed from the original, but no manual SG.
  • ``'editor-manual'``  — a manual support group was selected (overrides
                           radio-only changes).

ATTRIBUTION
  • An attribution entry exists for a field **only** when the current value
    differs from the original AI recommendation for that field.
  • When a field is reverted to its original value, its attribution is removed.
  • When all fields are reverted, the header returns to ``'default'``.

DOMINANT COLOR
  • Priority: ``manual_support_group`` > ``support_group_radio`` > ``priority_radio``.
  • Used for the header background tint.
"""

from __future__ import annotations


def compute(original: dict, current: dict, editors: dict) -> dict:
    """Return the authoritative header state for a single ticket.

    Parameters
    ----------
    original : dict
        The original AI recommendations::

            {
                'support_group': str,   # recommended_support_group
                'priority': str,        # recommended_priority_level
            }

    current : dict
        The current user selections (from sync_state)::

            {
                'support_group_radio': str | None,
                'manual_support_group': str | None,
                'priority_radio': str | None,
            }

    editors : dict
        Editor attribution map::

            {
                'support_group_radio': {'session_id': ..., 'label': ..., 'color': ...},
                'manual_support_group': {'session_id': ..., 'label': ..., 'color': ...},
                'priority_radio': {'session_id': ..., 'label': ..., 'color': ...},
            }

    Returns
    -------
    dict
        ::

            {
                'has_changes': bool,
                'header_style': 'default' | 'editor-changed' | 'editor-manual',
                'dominant_color': str | None,
                'dominant_color_light': str | None,
                'attribution': [
                    {
                        'field': str,
                        'field_label': str,
                        'session_id': str,
                        'label': str,
                        'color': str,
                    },
                    ...
                ],
            }
    """
    if not original:
        original = {}
    if not current:
        current = {}
    if not editors:
        editors = {}

    orig_sg = original.get('support_group', '')
    orig_priority = original.get('priority', '')

    cur_sg_radio = current.get('support_group_radio', '') or ''
    cur_manual_sg = current.get('manual_support_group', '') or ''
    cur_priority = current.get('priority_radio', '') or ''

    # ── Determine which fields have changed from the original ─────────────
    changed_fields: set[str] = set()

    # Support group radio: changed if a value is set AND differs from original
    if cur_sg_radio and cur_sg_radio != orig_sg:
        changed_fields.add('support_group_radio')

    # Manual support group: changed if any value is set (original is always empty)
    if cur_manual_sg:
        changed_fields.add('manual_support_group')

    # Priority radio: changed if a value is set AND differs from original
    if cur_priority and cur_priority != orig_priority:
        changed_fields.add('priority_radio')

    # ── Build attribution list (only for changed fields with editor info) ─
    field_labels = {
        'support_group_radio': 'support group',
        'manual_support_group': 'manual support group',
        'priority_radio': 'priority level',
    }

    attribution: list[dict] = []
    for field in ('manual_support_group', 'support_group_radio', 'priority_radio'):
        if field in changed_fields and field in editors:
            editor = editors[field]
            attribution.append({
                'field': field,
                'field_label': field_labels.get(field, field),
                'session_id': editor.get('session_id', ''),
                'label': editor.get('label', ''),
                'color': editor.get('color', ''),
            })

    has_changes = len(changed_fields) > 0

    # ── Determine header style ────────────────────────────────────────────
    if not has_changes:
        header_style = 'default'
    elif 'manual_support_group' in changed_fields:
        header_style = 'editor-manual'
    else:
        header_style = 'editor-changed'

    # ── Determine dominant color ──────────────────────────────────────────
    # Priority: manual_support_group > support_group_radio > priority_radio
    dominant_color = None
    for field in ('manual_support_group', 'support_group_radio', 'priority_radio'):
        if field in changed_fields and field in editors:
            dominant_color = editors[field].get('color')
            if dominant_color:
                break

    dominant_color_light = None
    if dominant_color:
        dominant_color_light = _hex_to_light_rgba(dominant_color, 0.15)

    return {
        'has_changes': has_changes,
        'header_style': header_style,
        'dominant_color': dominant_color,
        'dominant_color_light': dominant_color_light,
        'attribution': attribution,
    }


def _hex_to_light_rgba(hex_color: str, opacity: float = 0.15) -> str:
    """Convert a hex color to a light RGBA string for header backgrounds."""
    h = hex_color.lstrip('#')
    if len(h) == 3:
        r = int(h[0] * 2, 16)
        g = int(h[1] * 2, 16)
        b = int(h[2] * 2, 16)
    elif len(h) == 6:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
    else:
        return f'rgba(0, 0, 0, {opacity})'
    return f'rgba({r}, {g}, {b}, {opacity})'