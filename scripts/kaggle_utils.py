"""
Shared helpers for the Kaggle backup/restore/status scripts.

Each script emits a single JSON line on stdout that the Node backend parses
via `runKaggleScript` in backend/src/routes/databaseRoutes.ts.
"""

import json
from pathlib import Path


def emit(payload: dict) -> None:
    """Print the final result line as JSON for the calling Node process."""
    print(json.dumps(payload))


def get_username() -> str:
    """Read the Kaggle account username from local credentials. Empty string if not authenticated."""
    creds = Path.home() / ".kaggle" / "credentials.json"
    if creds.exists():
        data = json.loads(creds.read_text())
        return data.get("username") or data.get("user_name", "")
    legacy = Path.home() / ".kaggle" / "kaggle.json"
    if legacy.exists():
        data = json.loads(legacy.read_text())
        return data.get("username", "")
    return ""
