# ADR 009: Project Name

## Status: Accepted

## Context

The project was briefly renamed "Project Plainsight" in PR #25, and
reverted back to "street-by-street" on 2026-07-24 in the PR that added
this ADR. Commit history, PR titles, and code comments from that window
still say "Plainsight" — none of that history was rewritten — so anyone
reading it later needs a pointer explaining the name they're seeing
doesn't match the current one.

## Decision

The project's name is "street-by-street." There is no other name,
umbrella term, or rebrand in progress. Every "Plainsight" reference
introduced in PR #25 (page titles, headings, prose across `README.md`,
`docs/`, `decisions/`, code comments, tool banners, and the generated
`assets/images/bulgaria-locator.svg` label) was reverted back to
"street-by-street" in the same change that added this note.

## Consequences

- Commit messages and PR titles from between PR #25 and this ADR still
  say "Plainsight" — that history is left as-is, not rewritten, per this
  repository's usual practice of not editing the historical record. This
  ADR is the pointer for anyone who runs into that name later and needs
  to know it isn't current.
- No further action needed elsewhere: the repository name, live site
  URL, and every `sbs_`/`street-by-street` identifier already in use
  (localStorage keys, User-Agent strings, etc.) were never changed by
  PR #25 and stay as they are.
