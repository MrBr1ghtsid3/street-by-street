// Powers status.html. Fetches data/tutrakan-streets.geojson and
// data/observations.json (a single flat, globally-numbered store - see
// ADR 011) for the summary/resolutions sections, and the public,
// unauthenticated GitHub Issues API for the open-cases section. No
// backend, no token: every request here is either a static repo file
// served alongside this page, or a plain read-only call to
// api.github.com that works the same for any visitor.

// Kept in sync with assets/js/map.js's REPO_ISSUES_URL by hand — this repo
// has no build step/module system, so page-local constants are duplicated
// rather than imported (same tradeoff already noted in
// tools/observation-form.html).
const REPO_OWNER = "MrBr1ghtsid3";
const REPO_NAME = "street-by-street";
const GITHUB_ISSUES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&labels=case`;

// A Case's linking convention dropped the street entirely (ADR 011):
// "Tracks: observation #{n}", not "Tracks: streets/{id} observation #{n}".
const TRACKS_LINE_RE = /Tracks:\s*observation\s*#(\d+)/i;

// Real Cases are opened via .github/ISSUE_TEMPLATE/case.yml, which renders
// as "### Linked observation ID (if applicable)" followed by the
// submitted value (or the literal "_No response_" placeholder if left
// blank) - not a literal "Tracks:" line. Mirrors
// scripts/link_case_to_observation.py's extract_field, kept in sync by
// hand (see the module-doc comment above on duplication).
const OBSERVATION_FIELD_HEADING = "### Linked observation ID (if applicable)";
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

// An observation's street relationship lives only in nearby_streets[]
// (ADR 011) - the closest street, flagged primary: true. No street yet
// (no coordinates, or compute_street_proximity.py hasn't run) is a real,
// expected state, not an error.
function primaryStreetName(obs, streetNamesById) {
  const primary = (obs.nearby_streets || []).find((entry) => entry.primary);
  if (!primary) {
    return "Unmapped";
  }
  return streetNamesById[primary.street_id] || primary.street_id;
}

// ---- Summary + resolutions (from repo data) --------------------------

async function loadStreetData() {
  const [geojson, observationsData] = await Promise.all([
    fetchJSON("data/tutrakan-streets.geojson"),
    fetchJSON("data/observations.json"),
  ]);

  const streetNamesById = {};
  geojson.features.forEach((feature) => {
    streetNamesById[feature.properties.id] = feature.properties.name;
  });

  const streetsAudited = geojson.features.filter(
    (feature) => feature.properties.audited === true
  ).length;

  const observations = observationsData.observations || [];
  const observationsById = {};

  let openIssues = 0;
  let resolvedIssues = 0;
  let totalCostEur = 0;
  let totalPersonHours = 0;
  const resolutions = [];

  observations.forEach((obs) => {
    observationsById[obs.id] = obs;

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
      resolutions.push({ streetName: primaryStreetName(obs, streetNamesById), obs });
    }
  });

  resolutions.sort((a, b) =>
    (b.obs.resolution.date || "").localeCompare(a.obs.resolution.date || "")
  );

  return {
    streetNamesById,
    observationsById,
    streetsAudited,
    totalObservations: observations.length,
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

function extractTrackedObservation(body, observationsById, streetNamesById) {
  const text = body || "";

  // Try the narrative "Tracks: observation #{id}" convention first (a
  // hand-written Case description), then fall back to the Issue Form's
  // own field heading, which is what a Case opened via case.yml actually
  // contains.
  const tracksMatch = TRACKS_LINE_RE.exec(text);
  const idText = tracksMatch
    ? tracksMatch[1]
    : extractIssueFormField(text, OBSERVATION_FIELD_HEADING);

  if (!idText) {
    return null;
  }
  const obs = observationsById[Number(idText)];
  if (!obs) {
    return null;
  }
  return { id: obs.id, streetName: primaryStreetName(obs, streetNamesById) };
}

// Returns an array of cases, an empty array if there are genuinely none
// open, or null if the API call itself failed (including the unauthenticated
// rate limit, which GitHub reports as a 403/429 - both surface as
// `!response.ok` here, same as any other failure).
async function loadOpenCases(observationsById, streetNamesById) {
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
      trackedObservation: extractTrackedObservation(issue.body, observationsById, streetNamesById),
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
              c.trackedObservation
                ? ` · ${escapeHtml(c.trackedObservation.streetName)}`
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
  let observationsById = {};
  let streetNamesById = {};

  try {
    const data = await loadStreetData();
    streetNamesById = data.streetNamesById;
    observationsById = data.observationsById;
    renderSummary(data);
    renderResolutions(data.resolutions);
  } catch (err) {
    const message = `Could not load repository data. (${err.message})`;
    showSummaryError(message);
    showResolutionsError(message);
  }

  const cases = await loadOpenCases(observationsById, streetNamesById);
  renderCases(cases);
}

init();
