"""
Centralized configuration for the services package.

All debug flags, test-run toggles, and feature switches for service
modules live here so they are easy to find, audit, and change.
"""

# ── Debug logging ─────────────────────────────────────────────────────────────
# When True, detailed operational logs are written to output.txt via the Output class.
DEBUG = False

# Keyword-match module has its own flag (historically kept off to reduce noise).
DEBUG_KEYWORD_MATCH = False

# ── Test-run toggles ─────────────────────────────────────────────────────────
# When True, the ``if __name__ == "__main__" and TEST_RUN:`` block at the
# bottom of each service file will execute when the file is run directly.
TEST_RUN_ATHENA = False
TEST_RUN_DATABRICKS = False
TEST_RUN_EMBEDDING_MODEL = False
TEST_RUN_TEXT_GENERATION_MODEL = False

# ── Process indicators ────────────────────────────────────────────────────────
# When True, prints progress / loading messages to the console (stdout).
PROCESS_INDICATORS = False