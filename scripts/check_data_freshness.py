#!/usr/bin/env python3
"""Flag stale street audits and official statistics.

Reads every JSON file in data/streets/, checks meta.last_updated against a
180-day staleness window, and checks each official_context entry's
source_date against a one-year window. Writes a summary to
data/freshness-report.json. This is a reporting script only — it always
exits 0, regardless of how much data is stale.

Usage: python scripts/check_data_freshness.py
"""

import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STREETS_DIR = REPO_ROOT / "data" / "streets"
REPORT_PATH = REPO_ROOT / "data" / "freshness-report.json"

STREET_STALE_AFTER_DAYS = 180


def extract_year(source_date):
    match = re.search(r"\d{4}", source_date or "")
    return int(match.group()) if match else None


def check_street(path, today):
    record = json.loads(path.read_text(encoding="utf-8"))
    street_id = record.get("meta", {}).get("id", path.stem)
    last_updated_raw = record.get("meta", {}).get("last_updated")

    stale = False
    if last_updated_raw:
        try:
            last_updated = date.fromisoformat(last_updated_raw)
            if today - last_updated > timedelta(days=STREET_STALE_AFTER_DAYS):
                print(f"STALE: {street_id} last updated {last_updated_raw}")
                stale = True
        except ValueError:
            print(f"STALE: {street_id} last updated {last_updated_raw} (unparseable date)")
            stale = True

    stale_metrics = []
    for entry in record.get("official_context", []):
        metric = entry.get("metric", "unknown metric")
        source_date = entry.get("source_date", "")
        year = extract_year(source_date)
        if year is None or year < today.year - 1:
            print(f"STALE_OFFICIAL: {metric} sourced {source_date}")
            stale_metrics.append(metric)

    return stale, stale_metrics


def main():
    today = date.today()
    stale_streets = []
    stale_official_metrics = []

    for path in sorted(STREETS_DIR.glob("*.json")):
        is_stale, stale_metrics = check_street(path, today)
        if is_stale:
            stale_streets.append(path.stem)
        stale_official_metrics.extend(stale_metrics)

    report = {
        "generated": today.isoformat(),
        "stale_streets": stale_streets,
        "stale_official_metrics": stale_official_metrics,
        "all_current": not stale_streets and not stale_official_metrics,
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {REPORT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
