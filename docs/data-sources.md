# Data Sources

This catalogues the official sources SBS draws on for town-level context,
the constraint they all share, and the citation rule that keeps observed
data and official data from being confused with each other.

## The granularity constraint

Every source below publishes at **municipality (община) or settlement
level at best.** None of them publish at street level, and as far as this
project has found, no official Bulgarian source does. This is not a gap in
research — it's a structural property of how Bulgarian civic statistics
are collected and released. Any figure pulled from these sources belongs
in a street record's `official_context` block as town-level background,
never as a stand-in for a street-level fact.

## Sources

### data.egov.bg

Bulgaria's national open data portal, built on CKAN. Hosts datasets from
national and local government bodies, free to reuse for both commercial
and non-commercial purposes. The most likely source for anything not
covered by NSI directly — worth searching whenever a new official figure
is needed, but coverage and update frequency vary a lot by dataset.

### nsi.bg (National Statistical Institute)

The authoritative source for population, housing, and demographic figures
at municipality and town level, including the 2021 census. The
municipality population figure used in this project (11,726, 2023
estimate) comes from NSI. NSI is the first place to check for any
demographic or housing figure. (⚠ Discrepancy to resolve: `index.html`'s
stats table currently shows 7,258 for the municipality, dated 2025 —
reconcile to a single sourced, dated figure before relying on either.)

### Silistra oblast census release

Tutrakan municipality sits within Silistra oblast (region). Where NSI's
national releases don't break a figure down to municipality level, the
oblast-level census release sometimes does, and is worth checking as a
secondary source.

### Tutrakan municipality site

The municipality's own website is the source for anything municipality-
specific that isn't covered by national statistics: local administrative
data, council decisions, municipal services. Quality and availability vary
and it should be treated as a primary source to be checked directly, not
assumed to be mirrored elsewhere.

### GRAO (address-level registered residents)

GRAO holds address-level data on registered residents, which would be the
closest thing to a street-level official figure available in Bulgaria.
Access is restricted (it's not an open dataset) and obtaining it would
likely require a formal request process. This is listed as an aspirational
source only — nothing in this project currently uses GRAO data, and it
should not be assumed accessible without separately confirming the access
process.

## Licence position

`data.egov.bg` datasets are explicitly licensed for free reuse, commercial
and non-commercial. NSI publications are generally citable as public
statistics; check the specific release for any stated terms. Always check
the licence or terms of use on the specific dataset or page being cited —
this section describes the general position, not a blanket clearance for
every source above.

## Citation rule

Every official figure that appears anywhere in this project — in a street
record's `official_context` block, in documentation, or on the map — must
carry both a **source** and a **date**. A figure without both is not
usable: official statistics change over time, and without a date attached,
a reader can't tell whether it's still current. The `official_context`
schema (see [architecture.md](architecture.md)) enforces this with
mandatory `source` and `source_date` fields on every entry.
