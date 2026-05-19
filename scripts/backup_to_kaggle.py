"""
Push latest candles.db backup to a private Kaggle dataset via kaggle CLI.
Creates the dataset on first run, adds a new version on subsequent runs.

Prerequisites: run `kaggle auth login` once to set up OAuth credentials.

Usage:
  scripts/venv/Scripts/python.exe scripts/backup_to_kaggle.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
BACKUPS_DIR = PROJECT_ROOT / "backend" / "data" / "backups"
DB_PATH = PROJECT_ROOT / "backend" / "data" / "candles.db"
KAGGLE_EXE = str(Path(sys.executable).parent / "kaggle")
DATASET_SLUG = "tradingterm-candles"


def kaggle(*args: str) -> tuple[int, str]:
    result = subprocess.run([KAGGLE_EXE, *args], capture_output=True, text=True)
    output = (result.stdout + result.stderr).strip()
    return result.returncode, output


def get_username() -> str:
    creds = Path.home() / ".kaggle" / "credentials.json"
    if creds.exists():
        data = json.loads(creds.read_text())
        return data.get("username") or data.get("user_name", "")
    sys.exit("ERROR: Not authenticated. Run: kaggle auth login")


def latest_backup() -> Path:
    if BACKUPS_DIR.exists():
        candidates = sorted(BACKUPS_DIR.glob("candles-*.db"), reverse=True)
        if candidates:
            return candidates[0]
    return DB_PATH


def push():
    username = get_username()
    source = latest_backup()

    if not source.exists():
        sys.exit(f"ERROR: DB file not found: {source}")

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
            print(f"[kaggle] Pushed new version: {version_notes}")
        elif "404" in out or "403" in out or "not found" in out.lower() or "forbidden" in out.lower():
            print("[kaggle] Dataset not found — creating...")
            code2, out2 = kaggle("datasets", "create", "-p", str(staging_path))
            if code2 == 0:
                print(f"[kaggle] Created dataset: {dataset_id}")
            else:
                sys.exit(f"ERROR creating dataset: {out2}")
        else:
            sys.exit(f"ERROR: {out}")


if __name__ == "__main__":
    push()
