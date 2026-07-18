#!/usr/bin/env python3
"""Ingest newly-added field photos: extract GPS, strip EXIF, queue Case comments.

Triggered by .github/workflows/photo-pipeline.yml whenever new files land
under assets/images/streets/**. Takes a list of photo paths (one per
line, via --from-file) and, for each one named
`{street-id}__obs-{observationId}__{description}.jpg`:

  1. Locates the matching observation in data/streets/{street-id}.json.
  2. Extracts GPS from EXIF (if present) and writes it to the
     observation's `coordinates` field - but only if that field is
     currently null. An observation that already has coordinates keeps
     them; the manual coordinate-picker workflow always wins over EXIF.
  3. Re-saves the JPEG without EXIF, so the copy actually served by the
     site carries no GPS/device metadata - the coordinate, if any, is
     published deliberately as data, not incidentally as an image
     artifact. Only files that had EXIF are re-saved.
  4. Queues a Case comment (data/../pending_comments.json) for any photo
     whose observation has a `tracking_issue`, for a later workflow step
     to post via `gh`.

Never creates or deletes an observation or a street file - a filename
that doesn't resolve to an existing street/observation is logged and
skipped, not invented.

Usage:
    python scripts/photo_pipeline.py --from-file new_photos.txt
"""

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
STREETS_DIR = REPO_ROOT / "data" / "streets"
PENDING_COMMENTS_PATH = REPO_ROOT / "pending_comments.json"

OBS_FIELD_RE = re.compile(r"^obs-(\d+)$")
GPS_IFD_TAG = 0x8825
GPS_LAT_REF, GPS_LAT, GPS_LON_REF, GPS_LON = 1, 2, 3, 4


def parse_filename(photo_path):
    """Return (street_id, observation_id) or None if the name doesn't match.

    Expected shape: {street-id}__obs-{observationId}__{description}.ext
    Split on "__" with no cap on the description field, so a description
    that itself contains "__" doesn't break parsing.
    """
    stem = Path(photo_path).stem
    parts = stem.split("__")
    if len(parts) < 3:
        return None

    street_id, obs_field = parts[0], parts[1]
    match = OBS_FIELD_RE.match(obs_field)
    if not street_id or not match:
        return None

    return street_id, int(match.group(1))


def dms_to_decimal(dms, ref):
    degrees, minutes, seconds = (float(component) for component in dms)
    decimal = degrees + minutes / 60 + seconds / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return round(decimal, 6)


def extract_gps(photo_path):
    """Return (lat, lng) from EXIF GPS tags, or None if absent/incomplete."""
    with Image.open(photo_path) as img:
        exif = img.getexif()
        gps_ifd = exif.get_ifd(GPS_IFD_TAG) if exif else {}

    lat_dms = gps_ifd.get(GPS_LAT)
    lat_ref = gps_ifd.get(GPS_LAT_REF)
    lon_dms = gps_ifd.get(GPS_LON)
    lon_ref = gps_ifd.get(GPS_LON_REF)
    if not (lat_dms and lat_ref and lon_dms and lon_ref):
        return None

    return dms_to_decimal(lat_dms, lat_ref), dms_to_decimal(lon_dms, lon_ref)


def has_exif(photo_path):
    with Image.open(photo_path) as img:
        return bool(img.info.get("exif")) or bool(img.getexif())


def strip_exif(photo_path):
    """Re-save the JPEG without its EXIF block. No-op if it has none."""
    if not has_exif(photo_path):
        return False
    with Image.open(photo_path) as img:
        img.save(photo_path, "JPEG", quality=95)
    return True


def load_street(street_id):
    street_file = STREETS_DIR / f"{street_id}.json"
    if not street_file.exists():
        return None, None
    record = json.loads(street_file.read_text(encoding="utf-8"))
    return street_file, record


def find_observation(record, observation_id):
    return next(
        (obs for obs in record.get("observations", []) if obs.get("id") == observation_id),
        None,
    )


def process_photo(photo_path, counts, pending_comments):
    name = Path(photo_path).name
    parsed = parse_filename(photo_path)
    if parsed is None:
        print(f"BAD_FILENAME: {name}")
        counts["bad_filename"] += 1
        return

    street_id, observation_id = parsed
    street_file, record = load_street(street_id)
    if record is None:
        print(f"ERROR: no street file for '{street_id}' ({name})")
        counts["not_found"] += 1
        return

    observation = find_observation(record, observation_id)
    if observation is None:
        print(f"OBSERVATION_NOT_FOUND: {street_id} obs {observation_id} ({name})")
        counts["not_found"] += 1
        return

    counts["processed"] += 1

    gps = extract_gps(photo_path)
    coords_written = False

    if gps is None:
        print(f"NO_GPS: {name}")
        counts["no_gps"] += 1
    elif observation.get("coordinates") is not None:
        print(f"ALREADY_SET: {street_id} obs {observation_id} already has coordinates ({name})")
        counts["already_set"] += 1
    else:
        lat, lng = gps
        observation["coordinates"] = {"lat": lat, "lng": lng}
        street_file.write_text(
            json.dumps(record, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        coords_written = True
        counts["coords_written"] += 1
        print(f"COORDS_WRITTEN: {street_id} obs {observation_id} -> {lat}, {lng}")

    if strip_exif(photo_path):
        print(f"EXIF_STRIPPED: {name}")

    tracking_issue = observation.get("tracking_issue")
    if not tracking_issue:
        print(f"NO_CASE: {street_id} obs {observation_id} has no linked Case ({name})")
        return

    entry = {
        "issue": tracking_issue,
        "photo_path": str(Path(photo_path).as_posix()),
        "observation_id": observation_id,
        "street_id": street_id,
        "coords_written": coords_written,
    }
    if gps is not None:
        entry["lat"], entry["lng"] = gps
    pending_comments.append(entry)
    counts["comments_queued"] += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-file",
        required=True,
        help="Path to a file listing newly-added photo paths, one per line.",
    )
    args = parser.parse_args()

    list_file = Path(args.from_file)
    photo_paths = [
        line.strip()
        for line in list_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    counts = {
        "processed": 0,
        "coords_written": 0,
        "no_gps": 0,
        "already_set": 0,
        "bad_filename": 0,
        "not_found": 0,
        "comments_queued": 0,
    }
    pending_comments = []

    for photo_path in photo_paths:
        process_photo(photo_path, counts, pending_comments)

    PENDING_COMMENTS_PATH.write_text(
        json.dumps(pending_comments, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(
        "Summary: "
        f"processed={counts['processed']} "
        f"coords_written={counts['coords_written']} "
        f"no_gps={counts['no_gps']} "
        f"already_set={counts['already_set']} "
        f"bad_filename={counts['bad_filename']} "
        f"not_found={counts['not_found']} "
        f"comments_queued={counts['comments_queued']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
