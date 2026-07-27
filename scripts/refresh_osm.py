#!/usr/bin/env python3
"""Re-query Overpass for Tutrakan highways and bus stops; refresh
data/tutrakan-streets.geojson and the OSM-derived attributes inside
data/streets/*.json.

Existing audit fields (status, audited, observations_count, issues_open,
last_updated) are preserved for streets already in the file; only geometry
and OSM-derived attributes are replaced. Streets missing from the new
Overpass result are kept (never deleted) and flagged with
osm_status: "not_found" instead.

For every street that already has a data/streets/{id}.json record AND
fresh OSM data this run, this also writes that record's `attributes`
block and `attributes_note` for exactly the fields named in
OSM_OWNED_STREET_ATTRS - the same fields previously only hand-copied
between this file and the geojson, with nothing verifying they agreed
(see ADR 004), and the same fields the generated note names, with
nothing verifying THAT agreed either until ADR 010. Every other
field - meta, trivia, observations, steward, official_context, and
every other attribute (including road_character, a human ground
observation this script never writes) - is left untouched.

bus_stops counts OSM bus stop nodes (highway=bus_stop or
public_transport=platform, Bulgarian OSM tagging uses both
inconsistently) assigned to their nearest street within
compute_street_proximity.SECONDARY_THRESHOLD_M (50m). If the Overpass
query returns zero bus stop nodes anywhere in the bbox, that means OSM
has no bus stop data for Tutrakan at all - not that no street has a bus
stop - so bus_stops is left null everywhere that run rather than writing
a false 0. A literal 0 is only ever written for a street once bus stop
data is known to exist somewhere in the bbox but none of it falls near
that particular street.

Usage: python scripts/refresh_osm.py
Exit code: 0 on success, 1 if the Overpass query fails or returns nothing.
"""

import json
import math
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

from compute_street_proximity import (
    SECONDARY_THRESHOLD_M,
    distance_to_street,
    equirectangular_xy,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
GEOJSON_PATH = REPO_ROOT / "data" / "tutrakan-streets.geojson"
STREETS_DIR = REPO_ROOT / "data" / "streets"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
BBOX_SOUTH, BBOX_WEST, BBOX_NORTH, BBOX_EAST = 44.026, 26.592, 44.058, 26.648
OVERPASS_QUERY = (
    "[out:json][timeout:90];\n"
    "(\n"
    '  way["highway"]({south},{west},{north},{east});\n'
    '  node["highway"="bus_stop"]({south},{west},{north},{east});\n'
    '  node["public_transport"="platform"]({south},{west},{north},{east});\n'
    ");\n"
    "out geom tags;"
).format(south=BBOX_SOUTH, west=BBOX_WEST, north=BBOX_NORTH, east=BBOX_EAST)

SOURCE_LABEL = "OpenStreetMap contributors, via Overpass API"

# The only attribute keys this script may write into data/streets/*.json's
# `attributes` block. Every other key there (dwellings, parking_spaces,
# lighting_count, road_character, and any future human-observed field) is
# ground-observed and must never be touched here - see ADR 010. Adding a
# new OSM-derived field means adding it to this tuple, nowhere else;
# update_street_json() and its generated attributes_note both read from it
# rather than naming fields separately, precisely so the two can't drift
# apart the way they did before this ADR.
OSM_OWNED_STREET_ATTRS = ("length_m", "surface_type", "road_class", "bus_stops")

# Official Bulgarian Cyrillic-to-Latin transliteration, used as a fallback
# when a way has no name:en tag.
CYRILLIC_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n",
    "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht", "ъ": "a",
    "ь": "y", "ю": "yu", "я": "ya",
}


def transliterate(text):
    out = []
    for ch in text:
        mapped = CYRILLIC_TO_LATIN.get(ch.lower())
        if mapped is None:
            out.append(ch)
        else:
            out.append(mapped.capitalize() if ch.isupper() else mapped)
    return "".join(out)


def clean_name_en(name_en):
    return re.sub(r"\s+(str\.?|street|st\.?)$", "", name_en.strip(), flags=re.IGNORECASE)


def slugify(name):
    cleaned = re.sub(r"[.\"']", "", name).strip().lower()
    cleaned = re.sub(r"\s+", "-", cleaned)
    return re.sub(r"-+", "-", cleaned).strip("-")


def haversine_m(lon1, lat1, lon2, lat2):
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def line_length_m(coords):
    return sum(
        haversine_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
        for i in range(len(coords) - 1)
    )


def extract_bus_stops(elements):
    """Return a deduplicated list of {"id", "lat", "lon"} for bus stop nodes.

    Matches either highway=bus_stop or public_transport=platform - OSM
    tagging for bus stops in Bulgaria uses both conventions inconsistently,
    sometimes on the same node. Deduplicated by node id defensively, even
    though Overpass's own set union (see OVERPASS_QUERY) already collapses
    a node appearing in both query branches into one result.
    """
    seen = {}
    for element in elements:
        if element.get("type") != "node":
            continue
        tags = element.get("tags", {})
        if tags.get("highway") != "bus_stop" and tags.get("public_transport") != "platform":
            continue
        node_id = element.get("id")
        if node_id is None or node_id in seen:
            continue
        seen[node_id] = {"id": node_id, "lat": element["lat"], "lon": element["lon"]}
    return list(seen.values())


def assign_stop_to_street(lat, lon, streets):
    """Return the id of the street nearest (lat, lon), or None if every
    street is farther than SECONDARY_THRESHOLD_M away.

    Reuses compute_street_proximity's projection/distance primitives
    (equirectangular_xy, distance_to_street - which itself wraps
    point_segment_distance) rather than reimplementing the geometry maths.
    `streets` is a list of {"id", "lines"} - see group_streets' "segments"
    key, which is already in the same [[lon, lat], ...] per-line shape
    compute_street_proximity.load_streets() produces from the geojson.
    """
    ref_lat_rad = math.radians(lat)
    point_x, point_y = equirectangular_xy(lon, lat, ref_lat_rad)

    best_id, best_dist = None, math.inf
    for street in streets:
        if not street["lines"]:
            continue
        dist = distance_to_street(point_x, point_y, street, ref_lat_rad)
        if dist < best_dist:
            best_dist, best_id = dist, street["id"]

    if best_id is not None and best_dist <= SECONDARY_THRESHOLD_M:
        return best_id
    return None


def fetch_overpass_elements():
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")
    request = urllib.request.Request(
        OVERPASS_URL,
        data=body,
        method="POST",
        # Overpass rejects the default Python-urllib user agent with 406.
        headers={"User-Agent": "street-by-street-refresh-script/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)["elements"]


def group_streets(elements):
    """Group Overpass way elements into one entry per street slug.

    OSM frequently splits a single named street into several way segments;
    they're merged here by slug, summing length across all of them.
    """
    streets = {}
    for element in elements:
        if element.get("type") != "way":
            continue
        tags = element.get("tags", {})
        geometry = element.get("geometry")
        name_bg = tags.get("name")
        if not name_bg or not geometry:
            continue

        name_en = tags.get("name:en")
        name = clean_name_en(name_en) if name_en else transliterate(name_bg)
        slug = slugify(name)
        coords = [[point["lon"], point["lat"]] for point in geometry]

        entry = streets.setdefault(
            slug,
            {
                "name": name,
                "name_bg": name_bg,
                "surface_type": None,
                "road_class": None,
                "segments": [],
            },
        )
        entry["segments"].append(coords)
        entry["surface_type"] = entry["surface_type"] or tags.get("surface")
        entry["road_class"] = entry["road_class"] or tags.get("highway")

    return streets


def build_feature(slug, street, existing_properties=None, today=None):
    existing_properties = existing_properties or {}
    today = today or date.today().isoformat()
    segments = street["segments"]
    length_m = round(sum(line_length_m(segment) for segment in segments), 1)

    properties = {
        "id": slug,
        "name": street["name"],
        "name_bg": street["name_bg"],
        "name_historical": existing_properties.get("name_historical"),
        "status": existing_properties.get("status", "not_started"),
        "audited": existing_properties.get("audited", False),
        "length_m": length_m,
        "observations_count": existing_properties.get("observations_count", 0),
        "issues_open": existing_properties.get("issues_open", 0),
        "last_updated": existing_properties.get("last_updated", today),
        "surface_type": street["surface_type"],
        "road_class": street["road_class"],
        "source": SOURCE_LABEL,
    }

    # Preserve OSM topology: a street split across several disjoint ways
    # stays a MultiLineString (one array per segment) rather than being
    # flattened into a single LineString, which would draw phantom
    # connector lines across the gaps between parts.
    geometry = (
        {"type": "LineString", "coordinates": segments[0]}
        if len(segments) == 1
        else {"type": "MultiLineString", "coordinates": segments}
    )

    return {
        "type": "Feature",
        "properties": properties,
        "geometry": geometry,
    }


def _format_field_list(fields):
    fields = list(fields)
    if len(fields) == 1:
        return fields[0]
    return ", ".join(fields[:-1]) + f", and {fields[-1]}"


def build_attributes_note(pull_date):
    """Generate attributes_note from OSM_OWNED_STREET_ATTRS, so the note's
    claim about which fields are OSM-derived cannot drift out of agreement
    with the fields update_street_json() actually writes - that mismatch
    (the note naming three fields while four were written) is exactly the
    defect ADR 010 records.
    """
    fields_text = _format_field_list(OSM_OWNED_STREET_ATTRS)
    return (
        f"{fields_text} are derived from OpenStreetMap geometry/tags via "
        f"the Overpass API (pulled {pull_date}), not a ground survey. A "
        "null value in one of those fields means OSM held no data for it "
        "on that date, not that it is awaiting a street walk. A null "
        "value in any other attribute means it has not been surveyed on "
        "foot yet."
    )


def update_street_json(slug, computed_attrs, pull_date):
    """Update data/streets/{slug}.json's OSM-owned attributes in place.

    Writes exactly the keys named in OSM_OWNED_STREET_ATTRS (currently
    length_m, surface_type, road_class, bus_stops) plus attributes_note,
    which is generated from that same constant - see build_attributes_note
    and ADR 010. Every other field - meta, trivia, observations, steward,
    official_context, and every other attribute (dwellings, parking_spaces,
    lighting_count, road_character, ...) - is left exactly as it was.

    Raises ValueError if `computed_attrs` is missing a key
    OSM_OWNED_STREET_ATTRS expects; a present key whose value is None is
    fine and is written as a JSON null (that's the "OSM has no data for
    this field" case, not a bug).

    Returns False without writing anything if no street JSON record
    exists for this slug yet (most streets don't - see docs/methodology.md
    for onboarding a new one).
    """
    street_file = STREETS_DIR / f"{slug}.json"
    if not street_file.exists():
        return False

    missing = [key for key in OSM_OWNED_STREET_ATTRS if key not in computed_attrs]
    if missing:
        raise ValueError(
            f"update_street_json({slug!r}): computed_attrs is missing "
            f"{missing} - expected a value (possibly None) for every key "
            f"in OSM_OWNED_STREET_ATTRS {OSM_OWNED_STREET_ATTRS}"
        )

    record = json.loads(street_file.read_text(encoding="utf-8"))
    attributes = record.setdefault("attributes", {})
    for key in OSM_OWNED_STREET_ATTRS:
        attributes[key] = computed_attrs[key]

    record["attributes_note"] = build_attributes_note(pull_date)

    street_file.write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return True


def main():
    # Computed once and reused everywhere a "today" is needed this run
    # (the geojson's single source_pulled, every build_feature() call's
    # last_updated fallback, and every street JSON's attributes_note pull
    # date) so one run can't straddle midnight into two different dates.
    today = date.today().isoformat()

    try:
        elements = fetch_overpass_elements()
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        print(f"ERROR: Overpass query failed: {err}", file=sys.stderr)
        return 1

    if not elements:
        print("ERROR: Overpass query returned no elements", file=sys.stderr)
        return 1

    overpass_streets = group_streets(elements)
    if not overpass_streets:
        print("ERROR: Overpass query returned no street ways", file=sys.stderr)
        return 1

    # Bus stops, assigned to their nearest street using this run's freshest
    # geometry (overpass_streets' own segments), not a possibly-stale
    # on-disk geojson.
    bus_stops = extract_bus_stops(elements)
    proximity_streets = [
        {"id": slug, "lines": street["segments"]} for slug, street in overpass_streets.items()
    ]

    bus_stop_counts = None  # None sentinel: "OSM has no bus stop data this run"
    unassigned_stops = 0
    if bus_stops:
        bus_stop_counts = defaultdict(int)
        for stop in bus_stops:
            street_id = assign_stop_to_street(stop["lat"], stop["lon"], proximity_streets)
            if street_id is None:
                unassigned_stops += 1
            else:
                bus_stop_counts[street_id] += 1
    else:
        print(
            "WARNING: Overpass returned zero bus stop nodes in the Tutrakan bbox. "
            "Treating this as OSM having no bus stop data for the area, NOT as the "
            "town having zero bus stops - leaving bus_stops null on every street "
            "this run rather than writing a false 0.",
            file=sys.stderr,
        )

    existing = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    existing_features = {f["properties"]["id"]: f for f in existing["features"]}

    updated_features = []
    seen_slugs = set()

    for slug, feature in existing_features.items():
        seen_slugs.add(slug)
        if slug in overpass_streets:
            updated_features.append(
                build_feature(slug, overpass_streets[slug], feature["properties"], today)
            )
        else:
            feature["properties"]["osm_status"] = "not_found"
            updated_features.append(feature)
            print(
                f"WARNING: '{slug}' not found in latest Overpass result; "
                "flagged osm_status=not_found, kept unchanged"
            )

    for slug, street in overpass_streets.items():
        if slug not in seen_slugs:
            updated_features.append(build_feature(slug, street, today=today))

    existing["features"] = updated_features
    # A single source_pulled on the FeatureCollection, not one per feature:
    # previously every feature repeated it, so a quarterly refresh where
    # nothing about the street network actually changed still produced a
    # 256-line diff (one date change x2 lines x128 features), burying any
    # real edit inside pure date churn on a PR that exists specifically so
    # a human can review what changed (ADR 004). One line here now carries
    # that fact for the whole file.
    existing["source_pulled"] = today
    GEOJSON_PATH.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(updated_features)} features to {GEOJSON_PATH.relative_to(REPO_ROOT)}")

    # Close the hand-sync gap: write the same OSM-derived fields into
    # data/streets/{id}.json for every street queried fresh this run - see
    # ADR 004. Streets flagged osm_status=not_found above aren't touched
    # here either, since there's no fresh geometry/tags to sync from.
    computed_by_slug = {
        feature["properties"]["id"]: feature["properties"]
        for feature in updated_features
        if feature["properties"]["id"] in overpass_streets
    }

    updated_street_files = 0
    for slug in overpass_streets:
        props = computed_by_slug[slug]
        bus_stops_value = None if bus_stop_counts is None else bus_stop_counts.get(slug, 0)
        computed_attrs = {
            "length_m": props["length_m"],
            "surface_type": props["surface_type"],
            "road_class": props["road_class"],
            "bus_stops": bus_stops_value,
        }
        if update_street_json(slug, computed_attrs, today):
            updated_street_files += 1

    print(f"Bus stop nodes found in bbox: {len(bus_stops)}")
    if bus_stop_counts is not None:
        total_assigned = sum(bus_stop_counts.values())
        print(f"  Assigned to a street (within {SECONDARY_THRESHOLD_M:.0f}m): {total_assigned}")
        print(f"  Unassigned (more than {SECONDARY_THRESHOLD_M:.0f}m from every street): {unassigned_stops}")
    print(f"Updated OSM-derived attributes in {updated_street_files} data/streets/*.json record(s).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
