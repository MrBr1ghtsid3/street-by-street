# ADR 004: Data Update Strategy

## Status: Accepted

## Context

SBS's street base layer is static GeoJSON ([ADR 002](002-static-site-architecture.md)),
sourced from OpenStreetMap via the Overpass API. OSM geometry and tags
change over time — new ways get added, surface tags get corrected, street
names get fixed — and a one-time pull goes stale the same way any cached
copy of someone else's data does. Separately, the official Bulgarian
statistics quoted in the Tutrakan city panel (population, municipal
administration, etc.) are point-in-time figures from NSI and the
municipality, and nothing currently flags when those figures are old
enough to be misleading. Both problems need a refresh mechanism, but
neither should be allowed to push unreviewed changes straight to the live
site.

## Decision

Refresh OSM-derived street data on a **quarterly schedule via GitHub
Actions** (`.github/workflows/refresh-data.yml`), re-running the same
Overpass query used in the original build-out and opening a **pull
request for human review** rather than committing directly to `main`.
Official statistics are **not** auto-updated — a companion script flags
them as stale, but updating the value itself is a manual edit, since it
requires judgement about which new source to trust, not just a refetch.
Observations and trivia remain entirely manually maintained; nothing
about this ADR changes how they're authored.

### Data tiers

1. **OSM-derived** (street geometry, length, surface type, road class) —
   refreshed automatically every quarter by `scripts/refresh_osm.py`,
   landing as a PR for review, never a direct commit.
2. **Official statistics** (population, administration, distances) —
   `scripts/check_data_freshness.py` flags entries whose `source_date` is
   more than a year old; the value itself is updated manually once a
   human has located and verified a current source. The same script also
   flags a whole street record as stale if its `meta.last_updated` is
   more than 180 days old — this is a reporting signal only (it writes to
   `data/freshness-report.json`, never to the street record itself), so
   it doesn't contradict tier 3's "no automation" below.
3. **Observations** (issues and assets) — manual JSON edit and commit,
   per street, as the audit happens. The data itself has no automation;
   this is the part of the data that only a person walking the street can
   produce. (Its staleness can be *flagged*, per tier 2 above — only the
   value is never auto-written.)
4. **Trivia / unofficial context** — manual research only, marked
   `verified: false` until sourced, per the existing data model
   ([ADR 003](003-data-model.md)).

### Why a PR instead of a direct commit

A scheduled job pushing straight to `main` would mean unreviewed,
unattended changes reaching the live site on a cron timer. Routing the
refresh through `peter-evans/create-pull-request` keeps a person in the
loop — checking the diff is plausible, confirming no audited street was
dropped, and reviewing any `osm_status: not_found` warnings — before
anything ships, while still automating the tedious part (re-querying and
re-diffing 100+ streets by hand).

## Consequences

- No data change reaches production without at least one human review
  step — the quarterly refresh PR, like any other PR, has to be merged
  deliberately.
- Streets that disappear from the Overpass result are never silently
  deleted; they're flagged (`osm_status: "not_found"`) and left in place
  for a human to investigate, since a missing way is more likely a
  tagging change than a street ceasing to exist.
- The refresh branch (`data/osm-refresh-<run>`) is deleted automatically
  once its PR is merged or closed, so the branch list doesn't accumulate
  one stale branch per quarter.
- The deploy pipeline ([ADR 002](002-static-site-architecture.md))
  doesn't need to know about any of this — merging the refresh PR is a
  normal push to `main`, which the existing deploy workflow already
  redeploys on.
- Official statistics can go visibly stale (flagged but unfixed) between
  refresh cycles if nobody acts on the freshness report — accepted
  because forcing an automatic update would mean trusting a script to
  pick the right replacement source unsupervised, which is a worse
  failure mode than a visible staleness flag.
- The freshness check (`scripts/check_data_freshness.py`) only scans
  `official_context` blocks inside `data/streets/*.json`. The city-level
  statistics currently shown on the live site are hardcoded in
  `index.html` (see [architecture.md](../docs/architecture.md)), which the
  script does not read — so those figures can go out of date without being
  flagged. Closing this gap (e.g. moving city stats into a scanned data
  file the freshness check covers) is deferred; for now those figures are
  maintained and verified by hand.

## Alternatives Considered

- **Direct commit to `main` from the scheduled job** — rejected because it
  removes the review step entirely; a bad Overpass response or a bug in
  the transform script would ship straight to the live map.
- **Manual-only refresh** (steward re-runs the script by hand
  occasionally) — rejected as the status quo failure mode: it depends on
  someone remembering to do it, which is exactly what a quarterly
  schedule exists to remove.
- **Auto-updating official statistics from a scraped source** — rejected
  for the same reason direct commits were: picking the right current
  source for a given statistic is a judgement call, not a mechanical
  refetch, so it stays manual with an automated staleness nudge instead.
