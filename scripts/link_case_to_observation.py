#!/usr/bin/env python3
"""Link a Case (GitHub Issue) to the observation it references.

Triggered by .github/workflows/link-case-to-observation.yml whenever a
`case`-labelled Issue is opened or edited. Parses the Issue Form body for
the "Linked observation ID" field, matched by its exact heading text as
rendered from .github/ISSUE_TEMPLATE/case.yml, and if present and valid,
sets that observation's `tracking_issue` field to this Issue's number in
data/observations.json - a single flat, globally-numbered store (ADR
011). There is no street to resolve any more: `Tracks: observation #{n}`
is the whole convention (see docs/case-tracking.md).

Most Cases aren't observation-linked (e.g. "Process / non-street-specific"),
which means the field will be missing or "_No response_" - that is the
expected, common case, not an error, so this exits cleanly (code 0)
without writing anything whenever the link can't be made.

Reads ISSUE_BODY and ISSUE_NUMBER from the environment (set by the
workflow). Never raises on a malformed or missing body.

Usage (as invoked by the workflow):
    ISSUE_BODY=... ISSUE_NUMBER=... python scripts/link_case_to_observation.py
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OBSERVATIONS_PATH = REPO_ROOT / "data" / "observations.json"

OBSERVATION_HEADING = "### Linked observation ID (if applicable)"
NO_RESPONSE = "_No response_"


def extract_field(body, heading):
    """Return the first non-empty line after `heading`, or None.

    Mirrors how GitHub renders an Issue Form field: the field's label as
    a "### " heading, followed by the submitted value (or the literal
    "_No response_" placeholder if the field was left blank).
    """
    lines = body.splitlines()
    for i, line in enumerate(lines):
        if line.strip() != heading:
            continue
        for following in lines[i + 1:]:
            value = following.strip()
            if value:
                return None if value == NO_RESPONSE else value
        return None
    return None


def main():
    issue_body = os.environ.get("ISSUE_BODY") or ""
    issue_number_raw = os.environ.get("ISSUE_NUMBER") or ""

    observation_ref = extract_field(issue_body, OBSERVATION_HEADING)

    if not observation_ref:
        print("Case is not observation-linked (missing observation-ref) - nothing to do.")
        return 0

    try:
        issue_number = int(issue_number_raw)
    except ValueError:
        print(f"WARNING: ISSUE_NUMBER ('{issue_number_raw}') is not an integer; aborting.")
        return 0

    try:
        observation_id = int(observation_ref)
    except ValueError:
        print(f"WARNING: observation-ref ('{observation_ref}') is not an integer; aborting.")
        return 0

    if not OBSERVATIONS_PATH.exists():
        print(f"WARNING: {OBSERVATIONS_PATH} not found; nothing to do.")
        return 0

    store = json.loads(OBSERVATIONS_PATH.read_text(encoding="utf-8"))
    observations = store.get("observations", [])
    target = next((obs for obs in observations if obs.get("id") == observation_id), None)

    if target is None:
        print(f"WARNING: no observation with id {observation_id}; nothing to do.")
        return 0

    target["tracking_issue"] = issue_number
    OBSERVATIONS_PATH.write_text(
        json.dumps(store, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Linked Case #{issue_number} to observation #{observation_id}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
