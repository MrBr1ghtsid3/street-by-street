#!/usr/bin/env python3
"""Flag which street(s) each geotagged observation is near.

For every observation with non-null `coordinates` across all
`data/streets/*.json` records, compute the distance from that point to
every street's geometry in `data/tutrakan-streets.geojson` (audited and
unaudited streets alike, since an observation can be physically close to
a street that hasn't been walked yet). The closest street is written back
as `primary: true`; any other street within 50m is added as
`primary: false` - a "more than one street might be involved" signal, not
an assertion of responsibility.

Distances are computed on a local equirectangular projection centred on
each observation's latitude, which is accurate enough at this scale (a
single small town) without pulling in an external geo library.

This script is run locally and on demand, as part of the existing manual
data-entry workflow - after adding an observation's coordinates via
tools/coordinate-picker.html, before committing. It is NOT wired into CI
and does not run automatically; see docs/methodology.md.

Usage (from the repo root):
    python3 scripts/compute_street_proximity.py
"""

import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GEOJSON_PATH = REPO_ROOT / "data" / "tutrakan-streets.geojson"
STREETS_DIR = REPO_ROOT / "data" / "streets"

SECONDARY_THRESHOLD_M = 50.0
EARTH_RADIUS_M = 6371000.0


def load_streets(geojson_path):
    """Return [{"id", "name", "lines": [[[lon, lat], ...], ...]}, ...]."""
    data = json.loads(geojson_path.read_text(encoding="utf-8"))
    streets = []
    for feature in data["features"]:
        geometry = feature["geometry"]
        if geometry["type"] == "LineString":
            lines = [geometry["coordinates"]]
        elif geometry["type"] == "MultiLineString":
            lines = geometry["coordinates"]
        else:
            continue

        props = feature["properties"]
        streets.append(
            {
                "id": props["id"],
                "name": props.get("name", props["id"]),
                "lines": lines,
            }
        )
    return streets


def equirectangular_xy(lon, lat, ref_lat_rad):
    """Project lon/lat (degrees) to local planar metres around ref_lat_rad."""
    x = math.radians(lon) * math.cos(ref_lat_rad) * EARTH_RADIUS_M
    y = math.radians(lat) * EARTH_RADIUS_M
    return x, y


def point_segment_distance(px, py, ax, ay, bx, by):
    """Minimum distance from point (px, py) to segment (a, b), in metres."""
    abx = bx - ax
    aby = by - ay
    if abx == 0 and aby == 0:
        return math.hypot(px - ax, py - ay)

    t = ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)
    t = max(0.0, min(1.0, t))
    closest_x = ax + t * abx
    closest_y = ay + t * aby
    return math.hypot(px - closest_x, py - closest_y)


def distance_to_street(obs_x, obs_y, street, ref_lat_rad):
    """Minimum distance (metres) from a projected point to a street's full geometry."""
    min_dist = math.inf
    for line in street["lines"]:
        projected = [equirectangular_xy(lon, lat, ref_lat_rad) for lon, lat in line]
        for (ax, ay), (bx, by) in zip(projected, projected[1:]):
            dist = point_segment_distance(obs_x, obs_y, ax, ay, bx, by)
            if dist < min_dist:
                min_dist = dist
    return min_dist


def compute_nearby_streets(lat, lng, streets):
    ref_lat_rad = math.radians(lat)
    obs_x, obs_y = equirectangular_xy(lng, lat, ref_lat_rad)

    distances = []
    for street in streets:
        if not street["lines"]:
            continue
        dist = distance_to_street(obs_x, obs_y, street, ref_lat_rad)
        distances.append((street["id"], dist))

    if not distances:
        return []

    distances.sort(key=lambda item: item[1])
    nearby = [
        {
            "street_id": distances[0][0],
            "distance_m": round(distances[0][1], 1),
            "primary": True,
        }
    ]
    for street_id, dist in distances[1:]:
        if dist > SECONDARY_THRESHOLD_M:
            break
        nearby.append({"street_id": street_id, "distance_m": round(dist, 1), "primary": False})
    return nearby


def main():
    streets = load_streets(GEOJSON_PATH)
    if not streets:
        print("No street geometries found in tutrakan-streets.geojson; nothing to do.")
        return

    processed = 0
    flagged_secondary = 0

    for street_file in sorted(STREETS_DIR.glob("*.json")):
        record = json.loads(street_file.read_text(encoding="utf-8"))
        observations = record.get("observations", [])
        changed = False

        for obs in observations:
            coords = obs.get("coordinates")
            if not coords:
                continue

            nearby = compute_nearby_streets(coords["lat"], coords["lng"], streets)
            if not nearby:
                continue

            obs["nearby_streets"] = nearby
            changed = True
            processed += 1
            if len(nearby) > 1:
                flagged_secondary += 1

        if changed:
            street_file.write_text(
                json.dumps(record, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

    print(f"Observations processed (had coordinates): {processed}")
    print(f"Observations flagged with a secondary nearby street (within {SECONDARY_THRESHOLD_M:.0f}m): {flagged_secondary}")


if __name__ == "__main__":
    main()
