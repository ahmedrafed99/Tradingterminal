"""
Print JSON describing the latest version of the Kaggle candles dataset.

Output (stdout):
  {"ok": true,  "datasetId": "...", "lastUpdated": "ISO-8601",
   "sizeBytes": 420581376, "downloadSizeBytes": 109080467}
  {"ok": false, "error": "..."}

`sizeBytes` is the uncompressed file size (what Kaggle displays on the dataset
page). `downloadSizeBytes` is the compressed/zipped size returned by the
dataset listing endpoint.

Usage:
  scripts/venv/Scripts/python.exe scripts/kaggle_status.py
"""

from kaggle_utils import emit, get_username


DATASET_SLUG = "tradingterm-candles"


def main() -> None:
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

    # 1. Get dataset metadata (lastUpdated + compressed size)
    try:
        results = api.dataset_list(search=DATASET_SLUG, user=username)
    except Exception as e:
        emit({"ok": False, "error": f"dataset_list failed: {e}"})
        return

    match = next((d for d in results if str(d.ref).lower() == dataset_id.lower()), None)
    if match is None:
        emit({"ok": False, "error": f"Dataset not found on Kaggle: {dataset_id}"})
        return

    last_updated = match.last_updated
    last_updated_iso = (
        last_updated.isoformat() if hasattr(last_updated, "isoformat") else str(last_updated)
    )
    download_size_bytes = int(getattr(match, "total_bytes", 0) or 0)

    # 2. Get per-file sizes (the real, uncompressed size — matches what's shown on kaggle.com)
    uncompressed_size_bytes = 0
    try:
        files_resp = api.dataset_list_files(dataset_id)
        for f in (files_resp.files or []):
            uncompressed_size_bytes += int(getattr(f, "total_bytes", 0) or 0)
    except Exception:
        # Fall back to the compressed size if file listing isn't accessible
        uncompressed_size_bytes = download_size_bytes

    emit({
        "ok": True,
        "datasetId": dataset_id,
        "lastUpdated": last_updated_iso,
        "sizeBytes": uncompressed_size_bytes or download_size_bytes,
        "downloadSizeBytes": download_size_bytes,
    })


if __name__ == "__main__":
    main()
