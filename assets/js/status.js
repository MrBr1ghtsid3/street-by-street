// Powers status.html. Fetches data/tutrakan-streets.geojson and every
// audited street's JSON for the summary/resolutions sections, and the
// public, unauthenticated GitHub Issues API for the open-cases section.
// No backend, no token: every request here is either a static repo file
// served alongside this page, or a plain read-only call to
// api.github.com that works the same for any visitor.

// Kept in sync with assets/js/map.js's REPO_ISSUES_URL by hand — this repo
// has no build step/module system, so page-local constants are duplicated
// rather than imported (same tradeoff already noted in
// tools/observation-form.html).
const REPO_OWNER = "MrBr1ghtsid3";
const REPO_NAME = "street-by-street";
const GITHUB_ISSUES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&labels=case`;

const TRACKS_LINE_RE = /Tracks:\s*streets\/([a-z0-9-]+)\s+observation\s*#(\d+)/i;

// Real Cases are opened via .github/ISSUE_TEMPLATE/case.yml, which renders
// as "### Linked street (if applicable)" / "### Linked observation ID (if
// applicable)" headings followed by the submitted value (or the literal
// "_No response_" placeholder if left blank) - not a literal "Tracks:"
// line. Mirrors scripts/link_case_to_observation.py's extract_field, kept
// in sync by hand (see the module-doc comment above on duplication).
const STREET_FIELD_HEADING = "### Linked street (if applicable)";
const NO_RESPONSE = "_No response_";

function extractIssueFormField(body, heading) {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== heading) {
      continue;
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const value = lines[j].trim();
      if (value) {
        return value === NO_RESPONSE ? null : value;
      }
    }
    return null;
  }
  return null;
}

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

// ---- Summary + resolutions (from repo data) --------------------------

async function loadStreetData() {
  const geojson = await fetchJSON("data/tutrakan-streets.geojson");

  const streetNamesById = {};
  geojson.features.forEach((feature) => {
    streetNamesById[feature.properties.id] = feature.properties.name;
  });

  const auditedFeatures = geojson.features.filter(
    (feature) => feature.properties.audited === true
  );

  let totalObservations = 0;
  let openIssues = 0;
  let resolvedIssues = 0;
  let totalCostEur = 0;
  let totalPersonHours = 0;
  const resolutions = [];

  await Promise.all(
    auditedFeatures.map(async (feature) => {
      const streetId = feature.properties.id;
      const record = await fetchJSON(`data/streets/${streetId}.json`);
      const observations = record.observations || [];

      totalObservations += observations.length;

      observations.forEach((obs) => {
        if (obs.type === "issue") {
          if (obs.status === "resolved") {
            resolvedIssues += 1;
          } else {
            openIssues += 1;
          }
        }

        if (obs.resolution) {
          if (typeof obs.resolution.cost_eur === "number") {
            totalCostEur += obs.resolution.cost_eur;
          }
          if (typeof obs.resolution.person_hours === "number") {
            totalPersonHours += obs.resolution.person_hours;
          }
          resolutions.push({ streetName: feature.properties.name, obs });
        }
      });
    })
  );

  resolutions.sort((a, b) =>
    (b.obs.resolution.date || "").localeCompare(a.obs.resolution.date || "")
  );

  return {
    streetNamesById,
    streetsAudited: auditedFeatures.length,
    totalObservations,
    openIssues,
    resolvedIssues,
    totalCostEur,
    totalPersonHours,
    resolutions,
  };
}

function renderSummary(data) {
  const container = document.getElementById("summary-stats");
  const stats = [
    { value: data.totalObservations, label: "Observations logged" },
    { value: data.openIssues, label: "Open issues" },
    { value: data.resolvedIssues, label: "Resolved issues" },
    { value: data.streetsAudited, label: "Streets audited" },
    { value: `€${data.totalCostEur.toFixed(2)}`, label: "Intervention cost" },
    { value: data.totalPersonHours, label: "Person-hours" },
  ];

  container.innerHTML = stats
    .map(
      (stat) => `
        <div class="status-stat-card">
          <p class="status-stat-card__value">${escapeHtml(stat.value)}</p>
          <p class="status-stat-card__label">${escapeHtml(stat.label)}</p>
        </div>
      `
    )
    .join("");
}

function showSummaryError(message) {
  document.getElementById("summary-stats").innerHTML =
    `<p class="status-error">${escapeHtml(message)}</p>`;
}

function renderResolutions(resolutions) {
  const container = document.getElementById("resolutions-list");

  if (!resolutions.length) {
    container.innerHTML =
      '<p class="status-empty">No interventions have been recorded yet ' +
      "— every observation logged so far is still open or " +
      "unactioned. This section will fill in as streets get walked and " +
      "issues actually get resolved.</p>";
    return;
  }

  container.innerHTML = resolutions
    .map(({ streetName, obs }) => {
      const resolution = obs.resolution;
      const stats = [];
      if (typeof resolution.person_hours === "number") {
        stats.push(`${resolution.person_hours} person-hrs`);
      }
      if (typeof resolution.cost_eur === "number") {
        stats.push(`€${resolution.cost_eur.toFixed(2)}`);
      }

      return `
        <div class="status-resolution-card">
          <div class="status-resolution-card__header">
            <div>
              <p class="status-resolution-card__street">${escapeHtml(streetName)}</p>
              <p class="status-resolution-card__title">${escapeHtml(obs.title)}</p>
            </div>
            <span class="status-badge status-badge--${resolution.outcome}">${escapeHtml(
              (resolution.outcome || "").replace(/_/g, " ")
            )}</span>
          </div>
          <p class="status-resolution-card__date">${escapeHtml(resolution.date)}</p>
          <p class="status-resolution-card__summary">${escapeHtml(resolution.summary)}</p>
          ${stats.length ? `<p class="status-resolution-card__stats">${escapeHtml(stats.join(" · "))}</p>` : ""}
        </div>
      `;
    })
    .join("");
}

function showResolutionsError(message) {
  document.getElementById("resolutions-list").innerHTML =
    `<p class="status-error">${escapeHtml(message)}</p>`;
}

// ---- Open cases (from the public GitHub API) --------------------------

function extractTrackedStreet(body, streetNamesById) {
  const text = body || "";

  // Try the narrative "Tracks: streets/{id} observation #{id}" convention
  // first (docs/case-tracking.md's linking convention for a hand-written
  // Case description), then fall back to the Issue Form's own field
  // headings, which is what a Case opened via case.yml actually contains.
  const tracksMatch = TRACKS_LINE_RE.exec(text);
  const streetId = tracksMatch
    ? tracksMatch[1]
    : extractIssueFormField(text, STREET_FIELD_HEADING);

  if (!streetId) {
    return null;
  }
  return { streetId, streetName: streetNamesById[streetId] || streetId };
}

// Returns an array of cases, an empty array if there are genuinely none
// open, or null if the API call itself failed (including the unauthenticated
// rate limit, which GitHub reports as a 403/429 - both surface as
// `!response.ok` here, same as any other failure).
async function loadOpenCases(streetNamesById) {
  try {
    const response = await fetch(GITHUB_ISSUES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const issues = await response.json();
    if (!Array.isArray(issues)) {
      throw new Error("unexpected response shape");
    }

    return issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      openedDate: (issue.created_at || "").slice(0, 10),
      trackedStreet: extractTrackedStreet(issue.body, streetNamesById),
    }));
  } catch (err) {
    console.error("Could not load open cases from the GitHub API:", err);
    return null;
  }
}

function renderCases(cases) {
  const container = document.getElementById("cases-list");

  if (cases === null) {
    container.innerHTML =
      '<p class="status-error">Live case data unavailable right now ' +
      "— the public GitHub API may be rate-limited or unreachable. " +
      "Try again in a few minutes, or view Cases directly on " +
      `<a href="https://github.com/${REPO_OWNER}/${REPO_NAME}/issues?q=is%3Aissue+is%3Aopen+label%3Acase" target="_blank" rel="noopener noreferrer">GitHub</a>.</p>`;
    return;
  }

  if (!cases.length) {
    container.innerHTML = '<p class="status-empty">No open cases right now.</p>';
    return;
  }

  container.innerHTML = cases
    .map(
      (c) => `
        <div class="status-case-card">
          <div class="status-case-card__header">
            <a class="status-case-card__title" href="${c.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title)}</a>
            <span class="status-case-card__number">#${c.number}</span>
          </div>
          <p class="status-case-card__meta">
            Opened ${escapeHtml(c.openedDate)}${
              c.trackedStreet
                ? ` · ${escapeHtml(c.trackedStreet.streetName)}`
                : ""
            }
          </p>
        </div>
      `
    )
    .join("");
}

// ---- Init --------------------------------------------------------------

async function init() {
  let streetNamesById = {};

  try {
    const data = await loadStreetData();
    streetNamesById = data.streetNamesById;
    renderSummary(data);
    renderResolutions(data.resolutions);
  } catch (err) {
    const message = `Could not load street data. (${err.message})`;
    showSummaryError(message);
    showResolutionsError(message);
  }

  const cases = await loadOpenCases(streetNamesById);
  renderCases(cases);
}

init();
