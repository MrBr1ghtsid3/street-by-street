#!/usr/bin/env python3
"""Re-query Overpass for Tutrakan highways and refresh data/tutrakan-streets.geojson.

Existing audit fields (status, audited, observations_count, issues_open,
last_updated) are preserved for streets already in the file; only geometry
and OSM-derived attributes are replaced. Streets missing from the new
Overpass result are kept (never deleted) and flagged with
osm_status: "not_found" instead.

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
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GEOJSON_PATH = REPO_ROOT / "data" / "tutrakan-streets.geojson"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
BBOX_SOUTH, BBOX_WEST, BBOX_NORTH, BBOX_EAST = 44.026, 26.592, 44.058, 26.648
OVERPASS_QUERY = (
    "[out:json][timeout:90];\n"
    'way["highway"]({south},{west},{north},{east});\n'
    "out geom tags;"
).format(south=BBOX_SOUTH, west=BBOX_WEST, north=BBOX_NORTH, east=BBOX_EAST)

SOURCE_LABEL = "OpenStreetMap contributors, via Overpass API"

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


def build_feature(slug, street, existing_properties=None):
    existing_properties = existing_properties or {}
    segments = street["segments"]
    length_m = round(sum(line_length_m(segment) for segment in segments), 1)
    today = date.today().isoformat()

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
        "source_pulled": today,
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


def main():
    try:
        elements = fetch_overpass_elements()
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        print(f"ERROR: Overpass query failed: {err}", file=sys.stderr)
        return 1

    if not elements:
        print("ERROR: Overpass query returned no elements", file=sys.stderr)
        return 1

    overpass_streets = group_streets(elements)

    existing = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    existing_features = {f["properties"]["id"]: f for f in existing["features"]}

    updated_features = []
    seen_slugs = set()

    for slug, feature in existing_features.items():
        seen_slugs.add(slug)
        if slug in overpass_streets:
            updated_features.append(
                build_feature(slug, overpass_streets[slug], feature["properties"])
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
            updated_features.append(build_feature(slug, street))

    existing["features"] = updated_features
    GEOJSON_PATH.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(updated_features)} features to {GEOJSON_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
