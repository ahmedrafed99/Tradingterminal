"""
Push latest candles.db backup to a private Kaggle dataset via kaggle CLI.
Creates the dataset on first run, adds a new version on subsequent runs.

Prerequisites: run `kaggle auth login` once to set up OAuth credentials.

Usage:
  scripts/venv/Scripts/python.exe scripts/backup_to_kaggle.py
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from kaggle_utils import emit, get_username

PROJECT_ROOT = Path(__file__).parent.parent
BACKUPS_DIR = PROJECT_ROOT / "backend" / "data" / "backups"
DB_PATH = PROJECT_ROOT / "backend" / "data" / "candles.db"
KAGGLE_EXE = str(Path(sys.executable).parent / "kaggle")
DATASET_SLUG = "tradingterm-candles"


def kaggle(*args: str) -> tuple[int, str]:
    result = subprocess.run([KAGGLE_EXE, *args], capture_output=True, text=True)
    output = (result.stdout + result.stderr).strip()
    return result.returncode, output


def latest_backup() -> Path:
    if BACKUPS_DIR.exists():
        candidates = sorted(BACKUPS_DIR.glob("candles-*.db"), reverse=True)
        if candidates:
            return candidates[0]
    return DB_PATH


def push():
    username = get_username()
    if not username:
        emit({"ok": False, "error": "Kaggle not authenticated. Run: kaggle auth login"})
        sys.exit(1)
    source = latest_backup()

    if not source.exists():
        emit({"ok": False, "error": f"DB file not found: {source}"})
        sys.exit(1)

    dataset_id = f"{username}/{DATASET_SLUG}"
    version_notes = f"auto-backup {source.stem}"

    with tempfile.TemporaryDirectory() as staging:
        staging_path = Path(staging)
        shutil.copy2(source, staging_path / "candles.db")

        metadata = {
            "title": "TradingTerminal Candles Backup",
            "id": dataset_id,
            "licenses": [{"name": "CC0-1.0"}],
            "isPrivate": True,
        }
        (staging_path / "dataset-metadata.json").write_text(json.dumps(metadata, indent=2))

        code, out = kaggle("datasets", "version", "-p", str(staging_path), "-m", version_notes)

        if code == 0:
            emit({"ok": True, "action": "version", "notes": version_notes, "datasetId": dataset_id})
        elif "404" in out or "403" in out or "not found" in out.lower() or "forbidden" in out.lower():
            code2, out2 = kaggle("datasets", "create", "-p", str(staging_path))
            if code2 == 0:
                emit({"ok": True, "action": "create", "datasetId": dataset_id})
            else:
                emit({"ok": False, "error": f"Failed creating dataset: {out2}"})
                sys.exit(1)
        else:
            emit({"ok": False, "error": out})
            sys.exit(1)


if __name__ == "__main__":
    push()
