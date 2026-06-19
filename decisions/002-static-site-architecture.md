# ADR 002: Static-Site Architecture

## Status: Accepted

## Context

SBS needs a publicly viewable map and per-street reports. At pilot scale —
one steward, one audited street, six observations — almost any
architecture would technically work, but the choice made now sets the
shape of everything built on top of it.

## Decision

Phase 1 is a **static site with no backend**: Leaflet for the map,
GeoJSON and per-street JSON files for data, hosted on GitHub Pages. There
is no database, no API, and no server-side code. Git history is the audit
trail — every change to a street's data is a commit, with the usual commit
metadata (author, timestamp, message) serving as the provenance record a
database would otherwise need a dedicated audit-log table for.

## Rationale

- **€0 hosting cost.** GitHub Pages is free for a public (or, while
  private, eventually-public) repository of this size, which matches the
  budget constraint recorded in [the charter](../docs/charter.md).
- **Version-controlled by construction.** Because the data lives in
  tracked JSON/GeoJSON files, every edit is already versioned, attributable,
  and revertible without any extra tooling — Git does the job a
  database audit trail would otherwise need to be built for.
- **In-wheelhouse.** Static files, Git, and a CDN-hosted JS library are
  comfortable, low-risk territory for a DevOps-background solo maintainer,
  with no new operational surface (no database to back up, patch, or pay
  for) to take on.
- **Defers the database until it's actually needed.** A database earns
  its complexity when there are concurrent writers — multiple people or
  the public submitting data at once. At one steward and one street, that
  problem doesn't exist yet, so building for it now would be solving a
  problem the project doesn't have.

## Phased path

- **Phase 1 (current):** static site, no backend, as described above.
- **Phase 2 (future, triggered by need):** introduce a database —
  Supabase with PostGIS is the leading candidate, given its free tier and
  native geospatial support — once residents need to submit observations
  directly rather than through the steward. That's the point at which
  concurrent writes, validation, and moderation become real requirements
  that flat files can't satisfy safely.

## Deployment notes

- GitHub Pages source must be explicitly saved as "GitHub Actions" in
  Settings → Pages — the dropdown selection does not persist automatically
  on first save. Verify by reloading the Settings page before triggering
  the first workflow run.

## Alternatives Considered

- **Mapbox** — a capable, well-documented mapping platform, but it's a
  paid product beyond a fairly small free tier, and that tier's limits are
  a planning risk for a project with a €0 budget and no revenue. Leaflet
  with free tile providers avoids that risk entirely for Phase 1.
- **MapLibre** — an open-source fork of Mapbox GL JS, free of Mapbox's
  licensing. Not chosen for Phase 1 because Leaflet's simplicity is a
  better fit for a small static dataset with no custom vector basemap
  needs. **Documented here as the planned alternative if a future phase
  wants custom vector basemap styling** (e.g. a bespoke greyscale style
  rather than a hosted tile provider's) — that's a real capability gap in
  Leaflet that MapLibre would close, so it's the natural next step rather
  than a rejected option.
