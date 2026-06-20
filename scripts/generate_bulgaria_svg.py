#!/usr/bin/env python3
"""Generate assets/images/bulgaria-locator.svg from live OSM oblast boundaries.

Queries Overpass for Bulgaria's 28 admin_level=4 oblasti, assembles each
relation's "outer" way segments into closed ring(s), simplifies them for a
small locator-map footprint, and renders an SVG with Silistra oblast
highlighted and Tutrakan marked.

Usage: python scripts/generate_bulgaria_svg.py
Exit code: 0 on success, 1 if the Overpass query fails twice.
"""

import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "assets" / "images" / "bulgaria-locator.svg"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = (
    "[out:json][timeout:60];\n"
    '(relation["admin_level"="4"]["boundary"="administrative"](41.2,22.3,44.2,28.6););\n'
    "out geom;"
)
USER_AGENT = "street-by-street-project/1.0"
RETRY_DELAY_SECONDS = 10

# Bulgaria's bbox, per the task spec.
BBOX_MIN_LON, BBOX_MAX_LON = 22.3, 28.6
BBOX_MIN_LAT, BBOX_MAX_LAT = 41.2, 44.2

VIEWBOX_WIDTH, VIEWBOX_HEIGHT = 600, 400
PADDING = 20

TUTRAKAN_LAT, TUTRAKAN_LON = 44.0384, 26.6199

OBLAST_FILL = "#E5E7EB"
OBLAST_STROKE = "#9CA3AF"
OBLAST_STROKE_WIDTH = 0.8

SILISTRA_FILL = "#D1FAE5"
SILISTRA_STROKE = "#1D9E75"
SILISTRA_STROKE_WIDTH = 1.5

TUTRAKAN_FILL = "#1D9E75"
TUTRAKAN_LABEL_FILL = "#065F46"

# Simplification tolerance in projected SVG units (px in the 600x400
# viewBox). The full OSM boundaries carry tens of thousands of points
# combined; at locator-map scale that detail is invisible, so this keeps
# the file a sane size while preserving the overall shape.
SIMPLIFY_EPSILON = 1.2


def fetch_overpass_elements():
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")

    last_error = None
    for attempt in (1, 2):
        try:
            request = urllib.request.Request(
                OVERPASS_URL,
                data=body,
                method="POST",
                headers={"User-Agent": USER_AGENT},
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)["elements"]
        except (urllib.error.URLError, TimeoutError, ValueError) as err:
            last_error = err
            if attempt == 1:
                print(
                    f"WARNING: Overpass query failed ({err}); retrying in "
                    f"{RETRY_DELAY_SECONDS}s",
                    file=sys.stderr,
                )
                time.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError(f"Overpass query failed twice: {last_error}")


def is_bulgarian_oblast(tags):
    iso = tags.get("ISO3166-2", "")
    return iso.startswith("BG-")


def is_silistra(tags):
    name = tags.get("name", "")
    name_en = tags.get("name:en", "")
    return "Силистра" in name or "Silistra" in name_en or "Silistra" in name


def project(lat, lon):
    x_fraction = (lon - BBOX_MIN_LON) / (BBOX_MAX_LON - BBOX_MIN_LON)
    y_fraction = (BBOX_MAX_LAT - lat) / (BBOX_MAX_LAT - BBOX_MIN_LAT)
    x = PADDING + x_fraction * (VIEWBOX_WIDTH - 2 * PADDING)
    y = PADDING + y_fraction * (VIEWBOX_HEIGHT - 2 * PADDING)
    return x, y


def assemble_rings(segments):
    """Chain a relation's unordered "outer" way segments into closed rings.

    OSM multipolygon members are unordered way fragments that share
    endpoints with their neighbours; this greedily walks the pool of
    fragments, attaching (and reversing, where needed) whichever fragment
    connects to the current ring's open end, until no more connect.
    """
    remaining = [list(seg) for seg in segments if len(seg) >= 2]
    rings = []

    while remaining:
        ring = remaining.pop(0)
        progress = True
        while progress and ring[0] != ring[-1]:
            progress = False
            for i, seg in enumerate(remaining):
                if seg[0] == ring[-1]:
                    ring.extend(seg[1:])
                    remaining.pop(i)
                    progress = True
                    break
                if seg[-1] == ring[-1]:
                    ring.extend(reversed(seg[:-1]))
                    remaining.pop(i)
                    progress = True
                    break
                if seg[-1] == ring[0]:
                    ring[0:0] = seg[:-1]
                    remaining.pop(i)
                    progress = True
                    break
                if seg[0] == ring[0]:
                    ring[0:0] = list(reversed(seg))[:-1]
                    remaining.pop(i)
                    progress = True
                    break
        rings.append(ring)

    return rings


def perpendicular_distance(point, start, end):
    if start == end:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    x, y = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    denominator = math.hypot(y2 - y1, x2 - x1)
    return numerator / denominator


def simplify(points, epsilon):
    """Iterative Douglas-Peucker, to avoid recursion-depth issues on rings
    with thousands of points."""
    if len(points) < 3:
        return points

    keep = [True] * len(points)
    stack = [(0, len(points) - 1)]

    while stack:
        start_i, end_i = stack.pop()
        start, end = points[start_i], points[end_i]
        max_dist = 0.0
        max_index = -1
        for i in range(start_i + 1, end_i):
            if not keep[i]:
                continue
            dist = perpendicular_distance(points[i], start, end)
            if dist > max_dist:
                max_dist = dist
                max_index = i
        if max_dist > epsilon and max_index != -1:
            stack.append((start_i, max_index))
            stack.append((max_index, end_i))
        else:
            for i in range(start_i + 1, end_i):
                keep[i] = False

    return [point for point, kept in zip(points, keep) if kept]


def build_oblast_path(element):
    tags = element.get("tags", {})
    name = tags.get("name") or tags.get("name:en") or "unknown"

    outer_segments = [
        [(m["lat"], m["lon"]) for m in member.get("geometry", [])]
        for member in element.get("members", [])
        if member.get("type") == "way" and member.get("role") == "outer"
    ]
    outer_segments = [seg for seg in outer_segments if len(seg) >= 2]

    if not outer_segments:
        print(f"WARNING: skipping '{name}' — no usable outer geometry", file=sys.stderr)
        return None

    rings = assemble_rings(outer_segments)
    path_parts = []
    for ring in rings:
        if len(ring) < 3:
            continue
        projected = [project(lat, lon) for lat, lon in ring]
        simplified = simplify(projected, SIMPLIFY_EPSILON)
        if len(simplified) < 3:
            continue
        commands = [f"M{simplified[0][0]:.2f},{simplified[0][1]:.2f}"]
        commands += [f"L{x:.2f},{y:.2f}" for x, y in simplified[1:]]
        commands.append("Z")
        path_parts.append("".join(commands))

    if not path_parts:
        print(f"WARNING: skipping '{name}' — geometry collapsed after simplification", file=sys.stderr)
        return None

    return name, " ".join(path_parts)


def render_svg(oblast_paths, tutrakan_xy):
    tx, ty = tutrakan_xy

    path_elements = []
    silistra_rendered = False
    for name, d in oblast_paths:
        is_sil = is_silistra({"name": name})
        if is_sil:
            silistra_rendered = True
            fill, stroke, stroke_width = SILISTRA_FILL, SILISTRA_STROKE, SILISTRA_STROKE_WIDTH
        else:
            fill, stroke, stroke_width = OBLAST_FILL, OBLAST_STROKE, OBLAST_STROKE_WIDTH
        path_elements.append(
            f'    <path d="{d}" data-name="{escape_attr(name)}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width}" stroke-linejoin="round" />'
        )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWBOX_WIDTH} {VIEWBOX_HEIGHT}" role="img" aria-label="Map of Bulgaria showing 28 oblasti with Silistra oblast highlighted and Tutrakan marked">
  <title>Bulgaria &#8212; Silistra oblast and Tutrakan</title>
  <g>
{chr(10).join(path_elements)}
  </g>
  <circle cx="{tx:.2f}" cy="{ty:.2f}" r="5" fill="{TUTRAKAN_FILL}" stroke="white" stroke-width="1.5" />
  <text x="{tx + 8:.2f}" y="{ty + 3:.2f}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="9" fill="{TUTRAKAN_LABEL_FILL}">Тутракан</text>
  <g>
    <rect x="14" y="{VIEWBOX_HEIGHT - 60}" width="190" height="46" fill="white" fill-opacity="0.85" stroke="#9CA3AF" stroke-width="0.5" rx="4" />
    <rect x="24" y="{VIEWBOX_HEIGHT - 50}" width="14" height="10" fill="{SILISTRA_FILL}" stroke="{SILISTRA_STROKE}" stroke-width="1" />
    <text x="44" y="{VIEWBOX_HEIGHT - 42}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="9" fill="#374151">Силистра (SBS пилот)</text>
    <circle cx="31" cy="{VIEWBOX_HEIGHT - 26}" r="4" fill="{TUTRAKAN_FILL}" stroke="white" stroke-width="1" />
    <text x="44" y="{VIEWBOX_HEIGHT - 23}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="9" fill="#374151">Тутракан</text>
  </g>
</svg>
"""
    return svg, silistra_rendered


def escape_attr(value):
    return value.replace("&", "&amp;").replace('"', "&quot;")


def main():
    try:
        elements = fetch_overpass_elements()
    except RuntimeError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1

    oblast_elements = [
        el for el in elements
        if el.get("type") == "relation" and is_bulgarian_oblast(el.get("tags", {}))
    ]

    if not oblast_elements:
        print("ERROR: no Bulgarian oblast relations found in Overpass result", file=sys.stderr)
        return 1

    oblast_paths = []
    for element in oblast_elements:
        result = build_oblast_path(element)
        if result is not None:
            oblast_paths.append(result)

    if not oblast_paths:
        print("ERROR: every oblast boundary failed to parse; refusing to write an empty SVG", file=sys.stderr)
        return 1

    tutrakan_xy = project(TUTRAKAN_LAT, TUTRAKAN_LON)
    svg, silistra_rendered = render_svg(oblast_paths, tutrakan_xy)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(svg, encoding="utf-8")

    print(f"Rendered {len(oblast_paths)}/{len(oblast_elements)} oblasti to {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    print(f"Silistra highlighted: {silistra_rendered}")
    print(f"Tutrakan marker at SVG coordinates: ({tutrakan_xy[0]:.1f}, {tutrakan_xy[1]:.1f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
