#!/usr/bin/env python3
"""Onboard a new street: create its data/streets/{id}.json record and flip
`audited: true` on its data/tutrakan-streets.geojson feature, together.

Onboarding a street has always meant two hand edits that have to agree
with each other, with nothing checking them: create the street's JSON
record, and set `audited: true` on the matching geojson feature.
assets/js/map.js filters features to `audited === true` before it ever
fetches data/streets/{id}.json to render observation markers - so if the
flag is set with no record behind it, the fetch 404s into console.error
and no POI appears; if the record exists but the flag was never set, the
fetch never even happens. Either way, the failure is silent to a site
visitor. There has been exactly one street onboarded so far (Ana Ventura),
by hand, and no tooling existed to do it any other way.

This script performs both edits as a single operation, or neither:
data/streets/{id}.json is written first (harmless on its own - an
unaudited street with a record nobody points to yet), and the geojson
update happens only after that succeeds, with the just-written street
file deleted again if the geojson write then fails for any reason. That
ordering exists specifically to avoid ever landing in the dangerous half
of the two possible partial states - `audited: true` with no record
behind it - which is the exact silent failure this script exists to
close off.

The new record's `attributes` block gets every key that
data/streets/ana-ventura.json's `attributes` block has, all set to null -
read from that file at runtime, not hardcoded here, so the two can't
drift out of agreement the way scripts/refresh_osm.py's OSM-owned field
set and its generated note once did (see ADR 010). `name`, `name_bg`, and
`name_historical` come from the geojson feature's own properties, not
retyped by hand.

Never touches data/streets/ana-ventura.json (read-only, as the attribute-
key template) or any other existing street file. Never runs Overpass,
never touches git - this only writes working-tree files; branching,
committing, and opening a PR for the result is a separate, manual step,
the same as any other change in this repo.

Usage:
    python3 scripts/new_street.py --street geo-milev
    python3 scripts/new_street.py --street geo-milev --status normal
    python3 scripts/new_street.py --dry-run --street geo-milev
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from refresh_osm import OSM_OWNED_STREET_ATTRS

REPO_ROOT = Path(__file__).resolve().parent.parent
GEOJSON_PATH = REPO_ROOT / "data" / "tutrakan-streets.geojson"
STREETS_DIR = REPO_ROOT / "data" / "streets"
ATTRIBUTE_TEMPLATE_PATH = STREETS_DIR / "ana-ventura.json"

# audited=true paired with status="not_started" is the same shape of
# self-contradiction this script exists to prevent elsewhere (a status
# implying "no audit has happened" on a street this script just audited) -
# see docs/data-taxonomy.md's "Street status" for what each value means.
VALID_STATUSES = ("active", "normal")


class ValidationError(Exception):
    """A precondition the caller can fix. No file has been written yet
    when this is raised."""


def _format_field_list(fields):
    fields = list(fields)
    if len(fields) == 1:
        return fields[0]
    return ", ".join(fields[:-1]) + f", and {fields[-1]}"


def build_attributes_note():
    # Names the OSM-owned fields by reading OSM_OWNED_STREET_ATTRS rather
    # than typing them out a second time, same anti-drift reasoning as
    # ADR 010's build_attributes_note in refresh_osm.py (a different
    # function - this one describes "nothing has happened yet", that one
    # describes "here's what a refresh just wrote").
    osm_fields = _format_field_list(OSM_OWNED_STREET_ATTRS)
    return (
        f"Not yet refreshed from OpenStreetMap: {osm_fields} will be filled "
        "in by the next quarterly run of scripts/refresh_osm.py (see "
        "ADR 004). Every other attribute is null because this street has "
        "not been surveyed on foot yet either."
    )


def onboard_street(street_id, status, dry_run=False):
    """Validate, then (unless dry_run) write data/streets/{street_id}.json
    and set audited=true/status on the matching geojson feature.

    Returns a dict describing what was (or would be) done. Raises
    ValidationError for anything the caller can fix before either file is
    touched.
    """
    if status not in VALID_STATUSES:
        raise ValidationError(
            f"--status must be one of {VALID_STATUSES}, got {status!r}. "
            "'not_started' isn't valid here - this script always sets "
            "audited=true, and a street can't be both audited and not yet "
            "started."
        )

    street_file = STREETS_DIR / f"{street_id}.json"
    if street_file.exists():
        raise ValidationError(
            f"data/streets/{street_id}.json already exists - refusing to "
            "overwrite an existing street record."
        )

    geojson = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    feature = next(
        (f for f in geojson["features"] if f.get("properties", {}).get("id") == street_id),
        None,
    )
    if feature is None:
        raise ValidationError(
            f"'{street_id}' is not a street id in "
            f"{GEOJSON_PATH.relative_to(REPO_ROOT)}. Check the exact slug "
            "there - it's generated from the street's OSM name, not "
            "necessarily what you'd guess."
        )

    props = feature["properties"]
    today = date.today().isoformat()

    template_attributes = json.loads(
        ATTRIBUTE_TEMPLATE_PATH.read_text(encoding="utf-8")
    )["attributes"]
    attributes = {key: None for key in template_attributes}

    street_record = {
        "meta": {
            "id": street_id,
            "name": props["name"],
            "name_bg": props["name_bg"],
            "name_historical": props.get("name_historical"),
            "status": status,
            "last_updated": today,
            "steward": {"name": "TBD", "contact": "TBD"},
        },
        "attributes": attributes,
        "attributes_note": build_attributes_note(),
        "trivia": {"text": None, "sources": []},
        "observations": [],
    }

    geojson_changes = {"audited": True, "status": status}

    if dry_run:
        return {
            "dry_run": True,
            "street_file": street_file,
            "street_record": street_record,
            "geojson_path": GEOJSON_PATH,
            "geojson_changes": geojson_changes,
        }

    street_file.write_text(
        json.dumps(street_record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    try:
        props["audited"] = True
        props["status"] = status
        GEOJSON_PATH.write_text(
            json.dumps(geojson, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    except Exception:
        # Both edits or neither: undo the street file we just wrote rather
        # than leave a record sitting there unpaired with the flag flip.
        street_file.unlink(missing_ok=True)
        raise

    return {
        "dry_run": False,
        "street_file": street_file,
        "geojson_path": GEOJSON_PATH,
    }


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--street", required=True,
        help="Street id (the geojson feature's slug, e.g. geo-milev).",
    )
    parser.add_argument(
        "--status", default="active", choices=VALID_STATUSES,
        help="Status to set on both the new record's meta and the geojson feature. Default: active.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be created/changed; write nothing.",
    )
    args = parser.parse_args()

    try:
        result = onboard_street(args.street, args.status, dry_run=args.dry_run)
    except ValidationError as e:
        print(f"ERROR: {e}")
        return 1

    street_file_rel = result["street_file"].relative_to(REPO_ROOT)
    geojson_rel = result["geojson_path"].relative_to(REPO_ROOT)

    if result["dry_run"]:
        print("DRY RUN — nothing was written.\n")
        print(f"Would create {street_file_rel}:")
        print(json.dumps(result["street_record"], indent=2, ensure_ascii=False))
        print(f"\nWould set on '{args.street}' in {geojson_rel}:")
        print(json.dumps(result["geojson_changes"], indent=2, ensure_ascii=False))
    else:
        print(f"Created {street_file_rel}")
        print(f"Set audited=true, status={args.status!r} on '{args.street}' in {geojson_rel}")
        print(
            "\nNothing has been committed. Review the diff, then branch, "
            "commit, and open a PR the same as any other change."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
