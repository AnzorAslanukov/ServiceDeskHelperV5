"""
Centralized configuration constants for the Service Desk Helper backend.

All tuning knobs, feature flags, and shared constants live here so they
are easy to find, audit, and change.
"""

# ── Global debug flag ─────────────────────────────────────────────────────────
DEBUG = False

# ── Presence ──────────────────────────────────────────────────────────────────
SESSION_EXPIRY_SECONDS = 60  # remove sessions silent for this long

# 30 visually distinct colors for presence circles.
# Colors are assigned server-side to guarantee no two active sessions share a color.
PRESENCE_COLORS = [
    '#0d6efd', '#198754', '#fd7e14', '#6f42c1', '#0dcaf0',
    '#dc3545', '#6610f2', '#d63384', '#20c997', '#ffc107',
    '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#16a34a',
    '#2563eb', '#9333ea', '#e11d48', '#0891b2', '#65a30d',
    '#c2410c', '#4f46e5', '#be185d', '#0f766e', '#b45309',
    '#7e22ce', '#15803d', '#1d4ed8', '#9f1239', '#a16207',
]

# ── Validation ticket cache ───────────────────────────────────────────────────
VALIDATION_CACHE_TTL = 300  # seconds before a re-fetch is allowed

# ── Recommendation engine ─────────────────────────────────────────────────────
RECOMMENDATION_MAX_WORKERS = 3  # concurrent LLM recommendation threads

# ── Consensus ─────────────────────────────────────────────────────────────────
CONSENSUS_TICKET_THRESHOLD = 5  # consensus required when > this many tickets selected

# ── Validation fetch ──────────────────────────────────────────────────────────
VALIDATION_FETCH_MAX_WORKERS = 8   # concurrent Athena connections for ticket fetch
VALIDATION_FETCH_TOTAL_TIMEOUT = 300  # seconds before the entire fetch is abandoned