"""
Inviolable button rules — single source of truth for the three workflow buttons.

This module defines the **complete, exhaustive** set of rules that determine
each button's state.  No other module — backend or frontend — is permitted to
compute button properties (disabled, label, style, tooltip).  Every state
transition in the application MUST flow through :func:`compute` to obtain the
authoritative button configuration.

The function is **pure**: given a context dict it returns a deterministic
snapshot.  It has no side-effects and does not import any mutable state
modules.

Inviolable conditions
=====================

GET VALIDATION TICKETS
  • Toggle button (on / off).  NEVER disabled — always clickable.
  • ON  → validation tickets load; 30-second polling countdown is visible.
  • OFF → polling stops; countdown disappears; existing tickets remain.

GET TICKET RECOMMENDATIONS
  • Toggle button (on / off).
  • Disabled ONLY when zero tickets are in the view.
  • ON  → recommendations generated for all tickets (including new arrivals).
  • OFF → recommendation processing stops; existing recommendations remain.

IMPLEMENT TICKET ASSIGNMENT
  • Action button (not a toggle) except in consensus mode.
  • Disabled when no checkboxes are checked OR implement is in-progress.
  • Modes (when clickable):
      – limited_assignment : ≤ THRESHOLD checked AND >1 user
      – consensus          : > THRESHOLD checked AND >1 user AND not all agreed
      – full_assignment    : consensus achieved, OR only 1 user present
  • In consensus mode the button becomes a toggle (agree / disagree).
  • Label formats:
      – unclickable        : "Implement ticket assignment"
      – limited_assignment : "Implement ticket assignment <checked>/<total>"
      – full_assignment    : "Implement ticket assignment <checked>/<total>"
      – consensus (off)    : "<agreed>/<required> agree"
      – consensus (on)     : "<agreed>/<required> agree"
      – loading            : "Assigning…"

CONSENSUS BANNER
  • Visible ONLY when >1 user AND mode is consensus or full_assignment
    with active consensus history.
  • NEVER visible with ≤1 user.
  • Shows a disagree button ONLY in full_assignment mode.
"""

from __future__ import annotations

from app.config import CONSENSUS_TICKET_THRESHOLD

# ---------------------------------------------------------------------------
# Public output type
# ---------------------------------------------------------------------------

def _button(*, disabled: bool, label: str, style: str,
            tooltip: str | None = None, **extra) -> dict:
    """Build a canonical button-state dict."""
    d = {'disabled': disabled, 'label': label, 'style': style}
    if tooltip is not None:
        d['tooltip'] = tooltip
    d.update(extra)
    return d


# ---------------------------------------------------------------------------
# The single entry-point — called by ui_state on every state mutation
# ---------------------------------------------------------------------------

def compute(ctx: dict) -> dict:
    """Return the authoritative UI state snapshot.

    Parameters
    ----------
    ctx : dict
        Application context with the following keys:

        validation_toggle_on : bool
        tickets_in_view      : int
        recommendations_toggle_on : bool
        checked_count        : int
        total_tickets        : int
        user_count           : int   (active presence sessions)
        consensus_active     : bool
        consensus_agreed     : int
        consensus_required   : int   (== user_count when consensus is active)
        consensus_unlocked   : bool  (all users agreed → full assignment)
        full_assignment_active : bool (consensus was achieved; stays until revoked)
        implement_in_progress : bool
        user_has_agreed      : bool  (per-session; only used for tooltip text)

    Returns
    -------
    dict
        {
          buttons: {
            get_validation_tickets: {disabled, label, style, tooltip},
            get_recommendations:    {disabled, label, style, tooltip},
            implement_assignment:   {disabled, label, style, tooltip, mode,
                                     consensus_agreed, consensus_required},
          },
          validation_toggle_on: bool,
          recommendations_toggle_on: bool,
          countdown_visible: bool,
          consensus_banner_visible: bool,
          consensus_banner_show_disagree: bool,
          recommendation_progress: { ... },
        }
    """

    gvt = _compute_get_validation_tickets(ctx)
    rec = _compute_get_recommendations(ctx)
    imp = _compute_implement_assignment(ctx)

    # ── Consensus banner ──────────────────────────────────────────────────
    # Visible ONLY when >1 user AND (consensus mode OR full_assignment with
    # consensus history).  NEVER visible with ≤1 user.
    user_count = ctx.get('user_count', 1)
    imp_mode = imp.get('mode', 'unclickable')
    consensus_active = ctx.get('consensus_active', False)
    full_assignment_active = ctx.get('full_assignment_active', False)

    banner_visible = (
        user_count > 1
        and (imp_mode == 'consensus'
             or (imp_mode == 'full_assignment' and (consensus_active or full_assignment_active)))
    )
    banner_disagree = (
        banner_visible
        and imp_mode == 'full_assignment'
    )

    return {
        'buttons': {
            'get_validation_tickets': gvt,
            'get_recommendations': rec,
            'implement_assignment': imp,
        },
        'validation_toggle_on': bool(ctx.get('validation_toggle_on', False)),
        'recommendations_toggle_on': bool(ctx.get('recommendations_toggle_on', False)),
        'countdown_visible': bool(ctx.get('validation_toggle_on', False)),
        'consensus_banner_visible': banner_visible,
        'consensus_banner_show_disagree': banner_disagree,
        'recommendation_progress': ctx.get('recommendation_progress', {
            'visible': False,
            'current': 0,
            'total': 0,
            'current_ticket_id': None,
            'complete_message': None,
        }),
    }


# ---------------------------------------------------------------------------
# Per-button rule implementations (private)
# ---------------------------------------------------------------------------

def _compute_get_validation_tickets(ctx: dict) -> dict:
    """RULE: always clickable toggle.  NEVER disabled."""
    on = ctx.get('validation_toggle_on', False)

    if on:
        return _button(
            disabled=False,
            label='Get validation tickets',
            style='toggle-on',
            tooltip='Click to stop loading validation tickets',
        )
    else:
        return _button(
            disabled=False,
            label='Get validation tickets',
            style='toggle-off',
            tooltip='Click to start loading validation tickets',
        )


def _compute_get_recommendations(ctx: dict) -> dict:
    """RULE: disabled ONLY when zero tickets in view.  Otherwise toggle."""
    tickets = ctx.get('tickets_in_view', 0)
    on = ctx.get('recommendations_toggle_on', False)

    if tickets == 0:
        return _button(
            disabled=True,
            label='Get ticket recommendations',
            style='disabled',
            tooltip=None,
        )

    if on:
        return _button(
            disabled=False,
            label='Get ticket recommendations',
            style='toggle-on',
            tooltip='Click to stop AI-generated recommendations',
        )
    else:
        return _button(
            disabled=False,
            label='Get ticket recommendations',
            style='toggle-off',
            tooltip='Click to enable AI-generated recommendations',
        )


def _compute_implement_assignment(ctx: dict) -> dict:
    """RULE: complex mode-based action / toggle button."""
    checked = ctx.get('checked_count', 0)
    total = ctx.get('total_tickets', 0)
    users = ctx.get('user_count', 1)
    in_progress = ctx.get('implement_in_progress', False)

    consensus_active = ctx.get('consensus_active', False)
    consensus_agreed = ctx.get('consensus_agreed', 0)
    consensus_required = ctx.get('consensus_required', users)
    consensus_unlocked = ctx.get('consensus_unlocked', False)
    full_assignment_active = ctx.get('full_assignment_active', False)
    user_has_agreed = ctx.get('user_has_agreed', False)

    # ── In-progress (assigning) ───────────────────────────────────────────
    if in_progress:
        return _button(
            disabled=True,
            label='Assigning\u2026',
            style='loading',
            mode='loading',
        )

    # ── Unclickable: no checkboxes checked ────────────────────────────────
    if checked == 0:
        return _button(
            disabled=True,
            label='Implement ticket assignment',
            style='secondary',
            mode='unclickable',
        )

    # ── Single user: always full assignment (no consensus needed) ─────────
    if users <= 1:
        return _button(
            disabled=False,
            label=f'Implement ticket assignment {checked}/{total}',
            style='success',
            tooltip='Click to assign selected tickets',
            mode='full_assignment',
        )

    # ── Multiple users, ≤ threshold: limited assignment ───────────────────
    if checked <= CONSENSUS_TICKET_THRESHOLD:
        return _button(
            disabled=False,
            label=f'Implement ticket assignment {checked}/{total}',
            style='success',
            tooltip='Click to assign selected tickets',
            mode='limited_assignment',
        )

    # ── Multiple users, > threshold ───────────────────────────────────────

    # Full assignment achieved (consensus was reached and not revoked)
    if full_assignment_active and consensus_unlocked:
        return _button(
            disabled=False,
            label=f'Implement ticket assignment {checked}/{total}',
            style='success',
            tooltip='Click to assign selected tickets (consensus achieved)',
            mode='full_assignment',
            consensus_agreed=consensus_agreed,
            consensus_required=consensus_required,
        )

    # Consensus mode (voting in progress) — button is a CLICKABLE toggle
    if user_has_agreed:
        return _button(
            disabled=False,
            label=f'{consensus_agreed}/{consensus_required} agree',
            style='consensus-on',
            tooltip='You voted to agree on bulk ticket assignment',
            mode='consensus',
            consensus_agreed=consensus_agreed,
            consensus_required=consensus_required,
        )
    else:
        return _button(
            disabled=False,
            label=f'{consensus_agreed}/{consensus_required} agree',
            style='consensus-off',
            tooltip='You have not yet agreed on bulk ticket assignment',
            mode='consensus',
            consensus_agreed=consensus_agreed,
            consensus_required=consensus_required,
        )
