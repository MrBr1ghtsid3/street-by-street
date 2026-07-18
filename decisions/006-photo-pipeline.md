# ADR 006: Photo Pipeline

## Status: Accepted

## Context

Field photos are already part of the workflow — the audit walk procedure
(`docs/methodology.md`) has stewards shooting with Mapillary, and the
observation popup on the map has reserved a UI slot for a photo since
before any image pipeline existed (`docs/ethics.md`). Two things are true
at once:

- A geotagged photo already carries, in its own EXIF, exactly the GPS
  coordinate the coordinate-picker tool otherwise requires a person to
  click out by hand — that's a source of coordinate data sitting unused.
- A linked Case (`tracking_issue`) benefits from a photographic record of
  what was actually found, alongside its text description.

Two platforms were compared as the ingestion point. A photo attached
directly to a GitHub Issue has its EXIF stripped by GitHub on upload
(verified) — the GPS data simply isn't there to extract. A photo
committed to this repository keeps its EXIF intact through git. That
makes the repo, not the Issue, the only place GPS extraction is possible
at all — so `assets/images/streets/{street-id}/`, already the home for
observation photos, is the natural ingestion point.

## Decision

Field photos are named `{street-id}__obs-{observationId}__{description}.jpg`
and committed under `assets/images/streets/{street-id}/`. On merge to
`main`, `.github/workflows/photo-pipeline.yml` identifies the newly added
files and runs `scripts/photo_pipeline.py`, which for each photo:

- Extracts GPS from EXIF and writes it to the matching observation's
  `coordinates` field — **only** if that field is currently null. A
  manually-set coordinate (from the coordinate-picker tool) always wins;
  the pipeline never overwrites it.
- **Never creates or deletes an observation or a street file.** A
  filename that doesn't resolve to an existing street and observation id
  is logged and skipped.
- Strips EXIF from the copy of the image the site actually serves, so
  the published file carries no GPS/device metadata of its own — the
  coordinate, where one is published, is published deliberately as
  reviewed JSON data, not incidentally as a leftover image artifact.
- Comments the photo onto the observation's linked Case, if one exists
  (`tracking_issue`), giving the Case a visual record alongside its text.
- Queues all of the above as a **second, separate data PR** (coordinate
  writes + stripped photo re-saves) for human review before merge — the
  photo PR and the data PR it produces are always two distinct review
  points, never one.

This is treated as an **interim measure**. The intended eventual shape is
an intake service (a form, backed by a small function, opening the same
kind of PR) that doesn't require a contributor to know the filename
convention or use git directly. Building that is out of scope here; this
ADR covers the git-commit-triggered version that works today with zero
new infrastructure.

## Alternatives Considered

- **Extract GPS from a GitHub Issue photo attachment instead of a repo
  file** — not viable: GitHub strips EXIF (including GPS) from uploaded
  issue images, confirmed by inspection. There's nothing to extract once
  a photo has gone through an Issue upload.
- **Publish photos with EXIF intact** — rejected outright. GPS/device
  metadata in a served image is exactly the kind of "collect what the
  record needs, not everything it's possible to collect" case
  `docs/ethics.md` argues against — the coordinate the project wants
  public is the one that's been through the same review as the rest of
  the JSON record, not whatever a phone happened to embed.
- **Auto-populate coordinates even when one is already set (EXIF as the
  higher-trust source)** — rejected. The coordinate picker is a
  deliberate, reviewed human action; EXIF GPS accuracy varies by device
  and can be off by tens of metres. Manual data wins, unconditionally.
- **One combined PR for both the photo and the resulting data change** —
  rejected because it collapses two different review questions ("is this
  photo appropriate to publish" vs. "is this extracted coordinate/Case
  comment correct") into one, and because the pipeline can only run once
  the photo already exists on `main` to diff against.

## Consequences

- Publishing a field photo is a **two-PR flow**: the photo PR (human-
  authored, reviewed like any other change) merges first; the pipeline's
  data PR (coordinates + stripped photos) follows automatically and gets
  reviewed second. A steward adding a photo should expect a follow-up PR
  to appear, not treat the first merge as the end of the process.
- Case comments post **immediately** on the pipeline run, ahead of the
  data PR being reviewed or merged — they are not gated on that review.
  This is intentional: the comment is just "here's a photo for this
  Case," not a claim that survives being wrong, whereas the coordinate
  write is a change to the published record and does warrant the extra
  gate.
- The **original, EXIF-intact photo persists in git history** on the
  merged photo-PR commit, even after the pipeline re-saves a stripped
  copy — git doesn't rewrite history to remove it. This is accepted for
  now: these are the project's own photos of public streets whose
  coordinates are, by the project's own choice, published data anyway
  (see `docs/ethics.md`'s structural-fact/individually-identifying-detail
  line). It would matter more, and would need a harder answer, before
  accepting photos from outside the steward's own hand.
- **Public display of the photo on the map itself remains out of
  scope.** The pipeline strips EXIF and leaves the file sitting in
  `assets/images/streets/`, but `index.html`, `assets/js/map.js`, and
  `assets/css/style.css` are untouched by this change — the map's photo
  slot stays a placeholder until the automated face/animal-feature
  blurring pipeline `docs/ethics.md` calls for actually exists.
