#!/usr/bin/env python3
"""Check that docs/data-taxonomy.md's Categories table agrees with
data/taxonomy.json's "categories" list.

data/taxonomy.json is the machine-readable source of truth read by
scripts/new_observation.py, tools/serve.py, assets/js/map.js, and
tools/observation-form.html. docs/data-taxonomy.md is its hand-written,
human-readable companion (see ADR 008). Nothing enforced the two stayed
in agreement other than a person remembering to update both - this
script is that enforcement, run in CI via
.github/workflows/check-taxonomy.yml.

Only the *names* of the categories are compared (the first column of the
"| Category | Covers |" table, e.g. `accessibility`). The "Covers" column
is deliberately not validated against anything - it's hand-written prose
describing each category's scope, not data with a canonical source, and
checking it would mean re-deriving free text from a script, not
confirming a fact.

The "Status values" section (issue/asset/street status) is deliberately
NOT checked here, unlike categories. Unlike the Categories table, that
section is three separate bullet lists (issue statuses, asset statuses,
and street statuses, the last of which isn't in taxonomy.json at all)
distinguished only by preceding bold prose headers ("**Observation status
— issues:**" etc.), not by a distinct, unambiguous markup structure like
a table. Reliably telling those three lists apart requires matching that
exact prose, which a future wording tweak could break with no actual
data change - a false failure this script is trying to avoid, not cause.
If docs/data-taxonomy.md's status-values section is ever restructured
into something as unambiguous as the Categories table (e.g. one table
per status list), this check should be extended to cover it.

Usage: python scripts/check_taxonomy_sync.py
Exit code: 0 if in sync, 1 if not (or if the table/file can't be parsed).
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TAXONOMY_PATH = REPO_ROOT / "data" / "taxonomy.json"
DATA_TAXONOMY_DOC_PATH = REPO_ROOT / "docs" / "data-taxonomy.md"

CATEGORIES_HEADING_RE = re.compile(r"^##\s+Categories\s*$")
NEXT_HEADING_RE = re.compile(r"^##\s+")
# A markdown table row whose first cell is a backtick-quoted name, e.g.
# "| `accessibility` | Walkability; ... |". Deliberately only captures the
# first cell - the second ("Covers") is never inspected.
TABLE_ROW_RE = re.compile(r"^\|\s*`([a-z0-9_]+)`\s*\|")


def extract_categories_section(markdown_text):
    """Return the lines of the "## Categories" section (heading exclusive,
    up to but excluding the next "## " heading or end of file)."""
    lines = markdown_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if CATEGORIES_HEADING_RE.match(line):
            start = i + 1
            break
    if start is None:
        raise ValueError('no "## Categories" heading found')

    end = len(lines)
    for i in range(start, len(lines)):
        if NEXT_HEADING_RE.match(lines[i]):
            end = i
            break

    return lines[start:end]


def extract_documented_categories(markdown_text):
    section_lines = extract_categories_section(markdown_text)
    categories = []
    for line in section_lines:
        match = TABLE_ROW_RE.match(line.strip())
        if match:
            categories.append(match.group(1))

    if not categories:
        raise ValueError('found "## Categories" but no `category` table rows under it')

    return categories


def main():
    taxonomy = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    json_categories = set(taxonomy["categories"])

    markdown_text = DATA_TAXONOMY_DOC_PATH.read_text(encoding="utf-8")
    try:
        doc_categories_list = extract_documented_categories(markdown_text)
    except ValueError as e:
        print(f"ERROR: could not parse {DATA_TAXONOMY_DOC_PATH.relative_to(REPO_ROOT)}: {e}")
        return 1
    doc_categories = set(doc_categories_list)

    # Duplicate rows in the doc table would silently hide a real mismatch
    # if only compared as sets - catch that separately, even though it's
    # not a doc/json disagreement per se.
    if len(doc_categories_list) != len(doc_categories):
        seen = set()
        duplicates = sorted({c for c in doc_categories_list if c in seen or seen.add(c)})
        print(
            f"ERROR: {DATA_TAXONOMY_DOC_PATH.relative_to(REPO_ROOT)}'s Categories table "
            f"lists the same category more than once: {', '.join(duplicates)}"
        )
        return 1

    only_in_json = sorted(json_categories - doc_categories)
    only_in_doc = sorted(doc_categories - json_categories)

    if not only_in_json and not only_in_doc:
        print(
            f"OK: {len(json_categories)} categories match between "
            f"{TAXONOMY_PATH.relative_to(REPO_ROOT)} and "
            f"{DATA_TAXONOMY_DOC_PATH.relative_to(REPO_ROOT)}."
        )
        return 0

    print("ERROR: category taxonomy is out of sync.")
    if only_in_json:
        print(
            f"  In {TAXONOMY_PATH.relative_to(REPO_ROOT)} but not documented in "
            f"{DATA_TAXONOMY_DOC_PATH.relative_to(REPO_ROOT)}: {', '.join(only_in_json)}"
        )
    if only_in_doc:
        print(
            f"  Documented in {DATA_TAXONOMY_DOC_PATH.relative_to(REPO_ROOT)} but not in "
            f"{TAXONOMY_PATH.relative_to(REPO_ROOT)}: {', '.join(only_in_doc)}"
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
