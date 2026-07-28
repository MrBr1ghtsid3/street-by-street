// Powers register.html. Fetches data/observations.json (the flat,
// globally-numbered store - see ADR 011), data/tutrakan-streets.geojson
// (to resolve nearby_streets[] street ids to display names), and
// data/taxonomy.json (categories, statuses, category icons - the same
// single source of truth assets/js/map.js reads) - all static repo
// files, no build step, no framework. Unlike status.js, this page never
// calls the GitHub API: it has to render fully, and print cleanly, with
// no network access beyond the files it ships with.

// Kept in sync with assets/js/map.js and assets/js/status.js by hand -
// this repo has no build step/module system, so page-local constants are
// duplicated rather than imported.
const REPO_OWNER = "MrBr1ghtsid3";
const REPO_NAME = "street-by-street";
const REPO_ISSUES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${path}`);
  }
  return response.json();
}

// "animal_welfare" -> "Animal welfare". Used for category/type/status text
// cells, which (unlike .status-badge) have no CSS text-transform doing
// this for free.
function formatLabel(value) {
  const spaced = String(value).replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Same underscore-stripping as map.js's statusLabel() - deliberately NOT
// capitalised here, because this string feeds a .status-badge, and that
// component's CSS already applies text-transform: uppercase. Capitalising
// here too would just be redundant.
function badgeStatusLabel(status) {
  return status.replace(/_/g, " ");
}

// ---- Data loading and lookup tables -------------------------------------

let allObservations = [];
let streetsById = {};
let CATEGORY_ICON = {};
let FALLBACK_ICON = "ti-dots";

// An observation's street relationship lives only in nearby_streets[]
// (ADR 011) - the entry flagged primary: true, if any. No primary entry is
// a real, expected state (a photo can become a pin before
// scripts/compute_street_proximity.py has run for it, or before it's
// close enough to any street) - not an error to guard against.
function primaryStreet(obs) {
  const primary = (obs.nearby_streets || []).find((entry) => entry.primary);
  if (!primary) {
    return null;
  }
  return streetsById[primary.street_id] || null;
}

function streetDisplayText(obs) {
  const street = primaryStreet(obs);
  if (!street) {
    return "Unassigned";
  }
  return `${street.name_bg} / ${street.name}`;
}

// ---- Sorting --------------------------------------------------------------

// One accessor per sortable column. Each returns a primitive (number,
// string) or null/undefined for "no value" - compareForSort() below
// handles missing values the same way regardless of which column or
// which direction, so behaviour stays predictable across all nine
// columns, per the "sorting works on every column" requirement.
const SORT_ACCESSORS = {
  id: (obs) => obs.id,
  street: (obs) => (primaryStreet(obs) ? primaryStreet(obs).name : null),
  condition: (obs) => obs.title.toLowerCase(),
  category: (obs) => formatLabel(obs.category),
  type: (obs) => formatLabel(obs.type),
  status: (obs) => formatLabel(obs.status),
  reported: (obs) => obs.reported_date,
  photo: (obs) => obs.photo,
  case: (obs) => obs.tracking_issue,
};

let currentSort = { key: "reported", direction: "desc" };

function isMissing(value) {
  return value === null || value === undefined || value === "";
}

// Missing values always sort to the bottom, in either direction - a
// simpler, more predictable rule than trying to reverse "nothing" along
// with everything else.
function compareForSort(key, a, b) {
  const accessor = SORT_ACCESSORS[key];
  const va = accessor(a);
  const vb = accessor(b);
  const aMissing = isMissing(va);
  const bMissing = isMissing(vb);

  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  const cmp =
    typeof va === "number" && typeof vb === "number"
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });

  return currentSort.direction === "asc" ? cmp : -cmp;
}

function sortObservations(observations) {
  return [...observations].sort((a, b) => compareForSort(currentSort.key, a, b));
}

// ---- Filtering --------------------------------------------------------------

let currentFilters = { category: "", status: "", street: "" };

function matchesFilters(obs) {
  if (currentFilters.category && obs.category !== currentFilters.category) {
    return false;
  }
  if (currentFilters.status && obs.status !== currentFilters.status) {
    return false;
  }
  if (currentFilters.street) {
    const street = primaryStreet(obs);
    if (currentFilters.street === "unassigned") {
      if (street) return false;
    } else if (!street || street.id !== currentFilters.street) {
      return false;
    }
  }
  return true;
}

function filteredAndSorted() {
  return sortObservations(allObservations.filter(matchesFilters));
}

// ---- Table rendering --------------------------------------------------------

function renderPhotoCell(obs) {
  if (!obs.photo) {
    return "";
  }
  // Two representations of the same cell, toggled by @media print in
  // style.css: a thumbnail on screen, a plain text path on paper (a
  // printed page can't follow a link, and the point of this column in a
  // print/folder context is knowing which file to go find, not seeing a
  // small image of it again).
  return `
    <a class="register-table__photo-link" href="${escapeHtml(obs.photo)}" target="_blank" rel="noopener noreferrer">
      <img class="register-table__photo-thumb" src="${escapeHtml(obs.photo)}" alt="${escapeHtml(obs.title)}" loading="lazy" />
    </a>
    <span class="register-table__photo-path">${escapeHtml(obs.photo)}</span>
  `;
}

function renderCaseCell(obs) {
  if (!obs.tracking_issue) {
    return '<span class="register-table__dash">&mdash;</span>';
  }
  return `<a href="${REPO_ISSUES_URL}/${obs.tracking_issue}" target="_blank" rel="noopener noreferrer">#${obs.tracking_issue}</a>`;
}

function renderReportedCell(obs) {
  const resolvedLine = obs.resolved_date
    ? `<span class="register-table__resolved-date">resolved ${escapeHtml(obs.resolved_date)}</span>`
    : "";
  return `${escapeHtml(obs.reported_date)}${resolvedLine}`;
}

function renderRow(obs) {
  const icon = CATEGORY_ICON[obs.category] || FALLBACK_ICON;
  const street = primaryStreet(obs);
  const streetCellClass = street
    ? "register-table__cell register-table__cell--street"
    : "register-table__cell register-table__cell--street register-table__cell--unassigned";

  return `
    <tr>
      <td class="register-table__cell register-table__cell--id">${obs.id}</td>
      <td class="${streetCellClass}">${escapeHtml(streetDisplayText(obs))}</td>
      <td class="register-table__cell register-table__cell--condition">${escapeHtml(obs.title)}</td>
      <td class="register-table__cell register-table__cell--category"><i class="ti ${icon}" aria-hidden="true"></i> ${escapeHtml(formatLabel(obs.category))}</td>
      <td class="register-table__cell register-table__cell--type">${escapeHtml(formatLabel(obs.type))}</td>
      <td class="register-table__cell register-table__cell--status"><span class="status-badge status-badge--${obs.status}">${escapeHtml(badgeStatusLabel(obs.status))}</span></td>
      <td class="register-table__cell register-table__cell--reported">${renderReportedCell(obs)}</td>
      <td class="register-table__cell register-table__cell--photo">${renderPhotoCell(obs)}</td>
      <td class="register-table__cell register-table__cell--case">${renderCaseCell(obs)}</td>
    </tr>
  `;
}

function renderTable() {
  const rows = filteredAndSorted();
  const body = document.getElementById("register-table-body");

  if (!rows.length) {
    body.innerHTML =
      '<tr><td class="register-table__empty" colspan="9">No observations match the current filters.</td></tr>';
  } else {
    body.innerHTML = rows.map(renderRow).join("");
  }

  document.getElementById("register-count").textContent =
    `Showing ${rows.length} of ${allObservations.length} observations`;

  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll(".register-table__header").forEach((th) => {
    th.classList.remove("register-table__header--asc", "register-table__header--desc");
    if (th.dataset.sortKey === currentSort.key) {
      th.classList.add(
        currentSort.direction === "asc"
          ? "register-table__header--asc"
          : "register-table__header--desc"
      );
    }
  });
}

// ---- Filter controls --------------------------------------------------------

function populateFilterOptions(taxonomy) {
  const categorySelect = document.getElementById("filter-category");
  taxonomy.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = formatLabel(category);
    categorySelect.appendChild(option);
  });

  const statusSelect = document.getElementById("filter-status");
  const statuses = [...taxonomy.issue_statuses, ...taxonomy.asset_statuses];
  statuses.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = formatLabel(status);
    statusSelect.appendChild(option);
  });

  // Streets are scoped to ones actually referenced as an observation's
  // primary nearby street, not every street in the 128-feature geojson -
  // a dropdown listing 126 streets with zero observations wouldn't help
  // anyone filter this table. "Unassigned" is added as its own option
  // for the same real, expected no-primary-street state the table cell
  // renders.
  const streetSelect = document.getElementById("filter-street");
  const presentStreetIds = new Set();
  let hasUnassigned = false;
  allObservations.forEach((obs) => {
    const street = primaryStreet(obs);
    if (street) {
      presentStreetIds.add(street.id);
    } else {
      hasUnassigned = true;
    }
  });

  [...presentStreetIds]
    .map((id) => streetsById[id])
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((street) => {
      const option = document.createElement("option");
      option.value = street.id;
      option.textContent = `${street.name_bg} / ${street.name}`;
      streetSelect.appendChild(option);
    });

  if (hasUnassigned) {
    const option = document.createElement("option");
    option.value = "unassigned";
    option.textContent = "Unassigned";
    streetSelect.appendChild(option);
  }
}

function wireFilterControls() {
  document.getElementById("filter-category").addEventListener("change", (e) => {
    currentFilters.category = e.target.value;
    renderTable();
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    currentFilters.status = e.target.value;
    renderTable();
  });
  document.getElementById("filter-street").addEventListener("change", (e) => {
    currentFilters.street = e.target.value;
    renderTable();
  });
}

function wireSortHeaders() {
  document.querySelectorAll(".register-table__header").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
      } else {
        currentSort = { key, direction: "asc" };
      }
      renderTable();
    });
  });
}

// ---- CSV export --------------------------------------------------------------

const CSV_HEADER = ["#", "Street", "Condition", "Category", "Type", "Status", "Reported", "Photo", "Case"];

function csvField(value) {
  const str = value == null ? "" : String(value);
  if (/["\n,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(obs) {
  const reported = obs.resolved_date
    ? `${obs.reported_date} (resolved ${obs.resolved_date})`
    : obs.reported_date;

  return [
    obs.id,
    streetDisplayText(obs),
    obs.title,
    formatLabel(obs.category),
    formatLabel(obs.type),
    formatLabel(obs.status),
    reported,
    obs.photo || "",
    obs.tracking_issue || "",
  ]
    .map(csvField)
    .join(",");
}

function buildCsv(rows) {
  const lines = [CSV_HEADER.map(csvField).join(","), ...rows.map(csvRow)];
  return lines.join("\r\n");
}

function todayLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function exportCsv() {
  const rows = filteredAndSorted();
  const csv = buildCsv(rows);
  // A leading UTF-8 BOM so spreadsheet apps (Excel in particular) detect
  // the encoding correctly and render the Cyrillic street names instead
  // of mangling them.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `street-by-street-register-${todayLocalDate()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---- Init --------------------------------------------------------------------

async function init() {
  try {
    const [geojson, observationsData, taxonomy] = await Promise.all([
      fetchJSON("data/tutrakan-streets.geojson"),
      fetchJSON("data/observations.json"),
      fetchJSON("data/taxonomy.json"),
    ]);

    geojson.features.forEach((feature) => {
      streetsById[feature.properties.id] = feature.properties;
    });
    allObservations = observationsData.observations || [];
    CATEGORY_ICON = taxonomy.category_icon;
    FALLBACK_ICON = taxonomy.fallback_icon;

    populateFilterOptions(taxonomy);
    wireFilterControls();
    wireSortHeaders();
    renderTable();
  } catch (err) {
    const body = document.getElementById("register-table-body");
    body.innerHTML = `<tr><td class="register-table__error" colspan="9">Could not load the register. (${escapeHtml(err.message)})</td></tr>`;
    console.error("Could not load the register:", err);
  }

  document.getElementById("export-csv").addEventListener("click", exportCsv);
}

init();
