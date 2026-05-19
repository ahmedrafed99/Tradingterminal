"""
Download candles.db from the Kaggle dataset and place it at the given path.
Uses the Python kaggle API directly (the `kaggle datasets download` CLI hits
a different endpoint that 403s under OAuth — the Python API does not).

Output (stdout):
  {"ok": true,  "path": "...", "sizeBytes": 12345}
  {"ok": false, "error": "..."}

Usage:
  scripts/venv/Scripts/python.exe scripts/restore_from_kaggle.py <dest_path>
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

from kaggle_utils import emit, get_username

DATASET_SLUG = "tradingterm-candles"


def main() -> None:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "Missing destination path argument"})
        return

    dest = Path(sys.argv[1]).resolve()
    username = get_username()
    if not username:
        emit({"ok": False, "error": "Kaggle not authenticated. Run: kaggle auth login"})
        return

    dataset_id = f"{username}/{DATASET_SLUG}"

    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
    except Exception as e:
        emit({"ok": False, "error": f"kaggle package not installed: {e}"})
        return

    try:
        api = KaggleApi()
        api.authenticate()
    except Exception as e:
        emit({"ok": False, "error": f"Kaggle auth failed: {e}"})
        return

    with tempfile.TemporaryDirectory() as staging:
        staging_path = Path(staging)
        try:
            api.dataset_download_files(dataset_id, path=str(staging_path), unzip=True, quiet=True)
        except Exception as e:
            emit({"ok": False, "error": f"Download failed: {e}"})
            return

        # After unzip we expect candles.db. Fall back to any .db if name differs.
        downloaded = staging_path / "candles.db"
        if not downloaded.exists():
            db_files = list(staging_path.glob("*.db"))
            if not db_files:
                files_present = [p.name for p in staging_path.iterdir()]
                emit({"ok": False, "error": f"candles.db not found in archive. Got: {files_present}"})
                return
            downloaded = db_files[0]

        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp_target = dest.with_suffix(dest.suffix + ".kaggle-tmp")
        shutil.copy2(downloaded, tmp_target)
        os.replace(tmp_target, dest)  # atomic on same filesystem

        emit({"ok": True, "path": str(dest), "sizeBytes": dest.stat().st_size})


if __name__ == "__main__":
    main()