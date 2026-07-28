// Loads data/*.geojson, data/observations.json, data/streets/*.json, and
// data/taxonomy.json via fetch(), which browsers block under file://.
// Serve this directory over HTTP (see README) to test locally.

const TUTRAKAN_CENTER = [44.0386, 26.6195];

const map = L.map("map").setView(TUTRAKAN_CENTER, 14);

// CartoDB Positron — free greyscale basemap, attribution required.
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }
).addTo(map);

// fill/fillColor/className are explicit on every entry - Leaflet's own
// Polyline default is already fill:false, but spelling it out here means
// it can't be silently re-enabled by a future style merge, and className
// gives style.css something to target if Leaflet's own fill rendering
// ever needs overriding directly.
const STREET_STATUS_STYLES = {
  // opacity 0, not filtered out of the map - keeps the street clickable
  // (and tooltip-able) with no visible grey trace. The stroke is still
  // "painted" just transparent, so it stays hit-testable.
  not_started: { color: "#9CA3AF", weight: 6, opacity: 0, lineCap: "round", lineJoin: "round", fill: false, fillColor: "transparent", className: "street-line" },
  active: { color: "#F59E0B", weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round", fill: false, fillColor: "transparent", className: "street-line" },
  normal: { color: "#1D9E75", weight: 14, opacity: 0.9, lineCap: "round", lineJoin: "round", fill: false, fillColor: "transparent", className: "street-line" },
};

const legend = L.control({ position: "bottomleft" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "map-legend");
  div.innerHTML = `
    <div class="map-legend__section">
      <h4>Streets</h4>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--active"></span>Active (in progress)</div>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--normal"></span>Normal</div>
    </div>
    <div class="map-legend__section">
      <h4>Observations</h4>
      <div class="map-legend__item"><span class="map-legend__dot map-legend__dot--issue"></span>Issue</div>
      <div class="map-legend__item"><span class="map-legend__dot map-legend__dot--asset"></span>Asset</div>
    </div>
  `;
  return div;
};
legend.addTo(map);

// Holds every observation's marker, all at once, regardless of which
// street's panel is currently open - or of whether its street has been
// onboarded at all. A pin exists as soon as an observation has
// coordinates; see ADR 011 for why that's no longer gated on a street's
// audited status. Populated once at startup and never cleared on street
// switch - marker visibility is independent of panel selection.
const observationMarkersLayer = L.layerGroup().addTo(map);

// obs.id -> Leaflet marker. data/observations.json is a single flat,
// globally-numbered store (ADR 011), so obs.id alone is enough to key
// this - no more composite "streetId::obsId" key. Lets a click on a
// side-panel card find and open the matching map marker's popup.
const markersByKey = {};

// The full contents of data/observations.json, loaded once by init() below
// before anything that renders an observation can run. The street detail
// panel filters this by nearby_streets[].primary rather than reading an
// embedded per-street list - see observationsForStreet().
let allObservations = [];

const OBSERVATION_MARKER_COLOR = {
  issue: "#D85A30",
  asset: "#1D9E75",
};

// Category -> Tabler icon, and the neutral fallback for an unmapped
// category. Populated from data/taxonomy.json by init() below, before
// anything that renders an observation can run - see the fetch there.
// data/taxonomy.json is the single source of truth shared with
// scripts/new_observation.py, tools/serve.py's /taxonomy endpoint, and
// tools/observation-form.html.
let CATEGORY_ICON = {};
let FALLBACK_ICON = null;

const REPO_ISSUES_URL = "https://github.com/MrBr1ghtsid3/street-by-street/issues";

// Street audit status -> display label, for the badge shown in the side
// panel. Distinct from statusLabel() below, which formats observation
// status (open/in_progress/resolved/active/inactive), not street status.
const STATUS_LABEL = {
  not_started: "Not yet audited",
  active: "Audit in progress",
  normal: "Documented",
};

// A live-filtering street search, overlaid on the map as its own Leaflet
// control (top-right - the default zoom control takes top-left, the
// legend takes bottom-left). Matches against both the English and
// Cyrillic name, so a visitor typing either script finds the street.
// `onSelect(streetId)` mirrors clicking the street directly, plus flies
// the map to it - a search result usually isn't already in view, unlike
// a street someone just clicked on the visible map.
function createStreetSearchControl(features, onSelect) {
  const control = L.control({ position: "topright" });

  control.onAdd = function () {
    const container = L.DomUtil.create("div", "street-search");
    // Leaflet drags/zooms the map on mouse and scroll events that reach
    // it - typing, clicking a result, or scrolling a long result list
    // would otherwise pan/zoom the map underneath this control.
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    container.innerHTML = `
      <div class="street-search__input-wrap">
        <i class="ti ti-search street-search__icon" aria-hidden="true"></i>
        <input
          type="text"
          class="street-search__input"
          placeholder="Find a street&hellip;"
          autocomplete="off"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
          aria-label="Search streets"
        />
        <button type="button" class="street-search__clear" aria-label="Clear search" hidden>&times;</button>
      </div>
      <ul class="street-search__results" role="listbox" hidden></ul>
    `;

    const input = container.querySelector(".street-search__input");
    const clearButton = container.querySelector(".street-search__clear");
    const resultsList = container.querySelector(".street-search__results");

    let matches = [];
    let highlightedIndex = -1;

    function closeResults() {
      resultsList.hidden = true;
      resultsList.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      matches = [];
      highlightedIndex = -1;
    }

    function selectMatch(feature) {
      const props = feature.properties;
      input.value = props.name;
      clearButton.hidden = false;
      closeResults();
      onSelect(props.id);
    }

    function renderResults() {
      if (!matches.length) {
        resultsList.hidden = true;
        input.setAttribute("aria-expanded", "false");
        return;
      }
      resultsList.hidden = false;
      input.setAttribute("aria-expanded", "true");
      resultsList.innerHTML = matches
        .map((feature, index) => {
          const props = feature.properties;
          // Only worth a note when it's not the steady-state "normal" -
          // same distinction STATUS_LABEL already exists for.
          const statusNote =
            props.status !== "normal"
              ? ` <span class="street-search__result-status">${STATUS_LABEL[props.status] || ""}</span>`
              : "";
          return `
            <li
              id="street-search-option-${index}"
              class="street-search__result${index === highlightedIndex ? " street-search__result--active" : ""}"
              role="option"
              aria-selected="${index === highlightedIndex}"
              data-index="${index}"
            >
              ${props.name_bg} / ${props.name}${statusNote}
            </li>
          `;
        })
        .join("");
      if (highlightedIndex >= 0) {
        input.setAttribute("aria-activedescendant", `street-search-option-${highlightedIndex}`);
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function runSearch(query) {
      const q = query.trim().toLowerCase();
      if (!q) {
        closeResults();
        return;
      }
      matches = features
        .filter((feature) => {
          const props = feature.properties;
          return (
            props.name.toLowerCase().includes(q) ||
            (props.name_bg && props.name_bg.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => {
          const an = a.properties.name.toLowerCase();
          const bn = b.properties.name.toLowerCase();
          const aStarts = an.startsWith(q) ? 0 : 1;
          const bStarts = bn.startsWith(q) ? 0 : 1;
          return aStarts - bStarts || an.localeCompare(bn);
        })
        .slice(0, 8);
      highlightedIndex = matches.length ? 0 : -1;
      renderResults();
    }

    input.addEventListener("input", () => {
      clearButton.hidden = !input.value;
      runSearch(input.value);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (matches.length) {
          highlightedIndex = (highlightedIndex + 1) % matches.length;
          renderResults();
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (matches.length) {
          highlightedIndex = (highlightedIndex - 1 + matches.length) % matches.length;
          renderResults();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (highlightedIndex >= 0 && matches[highlightedIndex]) {
          selectMatch(matches[highlightedIndex]);
        }
      } else if (event.key === "Escape") {
        if (matches.length) {
          closeResults();
        } else {
          input.value = "";
          clearButton.hidden = true;
        }
      }
    });

    resultsList.addEventListener("click", (event) => {
      const item = event.target.closest(".street-search__result");
      if (!item) return;
      const feature = matches[Number(item.dataset.index)];
      if (feature) selectMatch(feature);
    });

    resultsList.addEventListener("mousemove", (event) => {
      const item = event.target.closest(".street-search__result");
      if (!item) return;
      const index = Number(item.dataset.index);
      if (index !== highlightedIndex) {
        highlightedIndex = index;
        renderResults();
      }
    });

    clearButton.addEventListener("click", () => {
      input.value = "";
      clearButton.hidden = true;
      closeResults();
      input.focus();
    });

    // Closes the dropdown on a genuine outside click. A click inside the
    // control never reaches here - disableClickPropagation above stops it
    // from bubbling this far - so this only ever fires for the "clicked
    // away" case, not as a race against the result-click handler above.
    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) {
        closeResults();
      }
    });

    return container;
  };

  return control;
}

function formatLength(metres) {
  if (metres == null) return "—";
  if (metres >= 1000) {
    return (metres / 1000).toFixed(2) + " km";
  }
  if (metres < 1) {
    return Math.round(metres * 100) + " cm";
  }
  return metres.toFixed(1) + " m";
}

const panel = document.getElementById("street-panel");

// The currently-selected street's own layer and status, so it can be
// restored to its base style when a different street is selected. There
// is no separate glow/highlight layer - selection is a restyle of the
// street's own line, not an additional element on top of it.
let selectedStreetLayer = null;
let selectedStreetStatus = null;

function styleForStreet(properties) {
  return (
    STREET_STATUS_STYLES[properties.status] ||
    STREET_STATUS_STYLES.not_started
  );
}

// Base colour by status - same source STREET_STATUS_STYLES already uses,
// exposed as its own function (status string in, colour out) so selection
// styling can call it with the same signature as the weight lookup below,
// without reaching into the full style object for one field.
function getStreetColour(status) {
  return (STREET_STATUS_STYLES[status] || STREET_STATUS_STYLES.not_started).color;
}

function selectStreetLayer(layer, status) {
  if (selectedStreetLayer && selectedStreetLayer !== layer) {
    const baseStyle = STREET_STATUS_STYLES[selectedStreetStatus] || STREET_STATUS_STYLES.not_started;
    selectedStreetLayer.setStyle({
      weight: baseStyle.weight,
      opacity: baseStyle.opacity,
      color: baseStyle.color,
      fill: false,
    });
  }

  const baseStyle = STREET_STATUS_STYLES[status] || STREET_STATUS_STYLES.not_started;
  layer.setStyle({
    weight: baseStyle.weight + 6,
    opacity: 0.55, // translucent - the street's own colour, not a solid bright one
    color: getStreetColour(status),
    fill: false,
  });

  selectedStreetLayer = layer;
  selectedStreetStatus = status;
}

function showPlaceholder(message) {
  panel.classList.add("street-panel--empty");
  panel.innerHTML = `<p class="street-panel__placeholder">${message}</p>`;
}

function showError(message) {
  panel.classList.remove("street-panel--empty");
  panel.innerHTML = `<p class="street-panel__error">${message}</p>`;
  console.error(message);
}

function categoryLabel(category) {
  return category.replace(/_/g, " ");
}

function statusLabel(status) {
  return status.replace(/_/g, " ");
}

function renderObservationCard(obs) {
  const icon = CATEGORY_ICON[obs.category] || FALLBACK_ICON;
  const hasCoords = !!obs.coordinates;
  return `
    <div
      class="observation-card observation-card--${obs.type}${hasCoords ? " observation-card--locatable" : ""}"
      data-obs-id="${obs.id}"
      data-has-coords="${hasCoords}"
    >
      <div class="observation-card__header">
        <span class="observation-card__title">${obs.title}</span>
        <span class="observation-card__category"><i class="ti ${icon}" aria-hidden="true"></i> ${categoryLabel(obs.category)}</span>
      </div>
      <p class="observation-card__description">${obs.description}</p>
      <div class="observation-card__meta">
        <span class="status-badge status-badge--${obs.status}">${statusLabel(obs.status)}</span>
        &middot; reported ${obs.reported_date}${obs.resolved_date ? ` &middot; resolved ${obs.resolved_date}` : ""}
        ${!hasCoords ? '<span class="observation-card__unmapped">Not yet mapped</span>' : ""}
      </div>
    </div>
  `;
}

function buildPinIcon(obs) {
  const color = OBSERVATION_MARKER_COLOR[obs.type] || OBSERVATION_MARKER_COLOR.issue;
  const icon = CATEGORY_ICON[obs.category] || FALLBACK_ICON;
  return L.divIcon({
    className: "observation-pin",
    html: `
      <span class="observation-pin__body" style="background:${color}">
        <span class="observation-pin__icon"><i class="ti ${icon}" aria-hidden="true"></i></span>
      </span>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

function renderObservationDate(obs) {
  return obs.reported_time
    ? `${obs.reported_date} ${obs.reported_time}`
    : obs.reported_date;
}

function renderPhotoPlaceholder() {
  return `
    <div class="observation-popup__photo">
      <i class="ti ti-camera" aria-hidden="true"></i>
      <p class="observation-popup__photo-caption">
        Photo pending. Published photos are checked by hand for
        identifiable faces, animals, and plates before being committed
        &mdash; see
        <a href="https://github.com/MrBr1ghtsid3/street-by-street/blob/main/docs/ethics.md" target="_blank" rel="noopener noreferrer">Ethics</a>.
      </p>
    </div>
  `;
}

function renderObservationPhoto(photoPath, altText) {
  return `
    <div class="observation-popup__photo observation-popup__photo--image">
      <img src="${photoPath}" alt="${altText}" loading="lazy" />
    </div>
  `;
}

function renderCaseLink(obs) {
  if (obs.tracking_issue) {
    return `<a class="observation-popup__case" href="${REPO_ISSUES_URL}/${obs.tracking_issue}" target="_blank" rel="noopener noreferrer">Case #${obs.tracking_issue}</a>`;
  }

  // No street-ref pre-fill any more: a Case links to an observation only
  // (Tracks: observation #{n}), not a street - see ADR 011 and
  // docs/case-tracking.md.
  const params = new URLSearchParams({
    template: "case.yml",
    "observation-ref": String(obs.id),
  });

  return `
    <span class="observation-popup__no-case">No case opened yet</span>
    <a class="observation-popup__open-case" href="${REPO_ISSUES_URL}/new?${params.toString()}" target="_blank" rel="noopener noreferrer">+ Open a Case</a>
  `;
}

function renderResolutionSection(obs) {
  const resolution = obs.resolution;
  if (!resolution) {
    return "";
  }

  const stats = [];
  if (typeof resolution.person_hours === "number") {
    stats.push(`${resolution.person_hours} person-hrs`);
  }
  if (typeof resolution.cost_eur === "number") {
    stats.push(`€${resolution.cost_eur.toFixed(2)}`);
  }
  if (resolution.people) {
    stats.push(resolution.people);
  }

  const equipmentLine =
    resolution.equipment && resolution.equipment.length
      ? `<p class="observation-popup__resolution-equipment">${resolution.equipment.join(", ")}</p>`
      : "";

  const photoBlock = resolution.after_photo
    ? renderObservationPhoto(
        `assets/images/observations/${resolution.after_photo}`,
        `After: ${obs.title}`
      )
    : "";

  const caseLink = resolution.case_ref
    ? `<a class="observation-popup__resolution-case" href="${REPO_ISSUES_URL}/${resolution.case_ref}" target="_blank" rel="noopener noreferrer">Full case &rarr;</a>`
    : "";

  return `
    <div class="observation-popup__resolution">
      <div class="observation-popup__resolution-header">
        <h4>Resolution</h4>
        <span class="status-badge status-badge--${resolution.outcome}">${statusLabel(resolution.outcome)}</span>
      </div>
      <p class="observation-popup__resolution-date">${resolution.date}</p>
      <p class="observation-popup__resolution-summary">${resolution.summary}</p>
      ${stats.length ? `<p class="observation-popup__resolution-stats">${stats.join(" &middot; ")}</p>` : ""}
      ${equipmentLine}
      ${photoBlock}
      ${caseLink}
    </div>
  `;
}

function renderObservationPopup(obs) {
  const icon = CATEGORY_ICON[obs.category] || FALLBACK_ICON;
  return `
    <div class="observation-popup">
      <div class="observation-popup__title">${obs.title}</div>
      <div class="observation-popup__meta">
        <span class="observation-popup__category observation-popup__category--${obs.type}"><i class="ti ${icon}" aria-hidden="true"></i> ${categoryLabel(obs.category)}</span>
        <span class="status-badge status-badge--${obs.status}">${statusLabel(obs.status)}</span>
      </div>
      ${obs.photo ? renderObservationPhoto(obs.photo, obs.title) : renderPhotoPlaceholder()}
      <p class="observation-popup__date">${renderObservationDate(obs)}</p>
      ${obs.description ? `<p class="observation-popup__description">${obs.description}</p>` : ""}
      <div class="observation-popup__case-row">${renderCaseLink(obs)}</div>
      ${renderResolutionSection(obs)}
    </div>
  `;
}

// Renders a pin for every observation that has coordinates, independent of
// any street's audited status - the whole point of the flat store (ADR
// 011) is that a photo can become a pin before a street exists to own it.
function addObservationMarkers(observations) {
  observations
    .filter((obs) => obs.coordinates)
    .forEach((obs) => {
      const marker = L.marker([obs.coordinates.lat, obs.coordinates.lng], {
        icon: buildPinIcon(obs),
      });
      marker.bindPopup(renderObservationPopup(obs), {
        maxWidth: 320,
        className: "observation-popup-wrapper",
      });
      observationMarkersLayer.addLayer(marker);
      markersByKey[`${obs.id}`] = marker;
    });
}

function wireObservationCardClicks(observations) {
  panel.querySelectorAll(".observation-card--locatable").forEach((card) => {
    card.addEventListener("click", () => {
      const obsId = Number(card.dataset.obsId);
      const obs = observations.find((o) => o.id === obsId);
      const marker = markersByKey[`${obsId}`];
      if (!obs || !obs.coordinates || !marker) {
        return;
      }
      map.flyTo([obs.coordinates.lat, obs.coordinates.lng], 17, {
        duration: 0.8,
      });
      marker.openPopup();
    });
  });
}

function renderOfficialContextRow(entry) {
  return `
    <tr>
      <td>${entry.metric}</td>
      <td>${entry.value}</td>
      <td class="source-label">${entry.source}, ${entry.source_date} (${entry.level})</td>
    </tr>
  `;
}

// Observations no longer live embedded in a street's own record (ADR 011)
// - a street "has" an observation only in the sense that the observation's
// own nearby_streets flags this street as primary=true. Secondary matches
// are deliberately excluded here: they're a "might also be involved"
// signal, not this street's own list.
function observationsForStreet(streetId) {
  return allObservations.filter((obs) =>
    (obs.nearby_streets || []).some(
      (entry) => entry.primary && entry.street_id === streetId
    )
  );
}

function renderStreetDetail(record) {
  panel.classList.remove("street-panel--empty");

  const attrs = record.attributes;
  const attributesHtml = Object.entries(attrs)
    .map(([key, value]) => {
      if (key === "length_m") {
        return `<dt>length</dt><dd>${formatLength(value)}</dd>`;
      }
      return `<dt>${key.replace(/_/g, " ")}</dt><dd>${value === null ? "—" : value}</dd>`;
    })
    .join("");

  const trivia = record.trivia;
  const triviaHtml = trivia && trivia.text
    ? `
      <section>
        <h3>Trivia</h3>
        <div class="trivia-block">
          ${trivia.text}
          ${!trivia.verified ? '<span class="trivia-block__unverified">Unverified</span>' : ""}
        </div>
      </section>
    `
    : "";

  const officialContext = record.official_context || [];
  const officialContextHtml = officialContext.length
    ? `
      <section>
        <h3>Official context</h3>
        <table class="official-context-table">
          <thead><tr><th>Metric</th><th>Value</th><th>Source</th></tr></thead>
          <tbody>${officialContext.map(renderOfficialContextRow).join("")}</tbody>
        </table>
      </section>
    `
    : "";

  const observations = observationsForStreet(record.meta.id);
  const observationsHtml = observations.length
    ? observations.map(renderObservationCard).join("")
    : '<p class="street-panel__placeholder">No observations logged yet.</p>';

  panel.innerHTML = `
    <div class="panel-header-row">
      <div class="panel-header-names">
        <h2>${record.meta.name}</h2>
        <p class="street-panel__name-bg">${record.meta.name_bg || ""}</p>
      </div>
      <span class="status-badge" data-status="${record.meta.status}">${STATUS_LABEL[record.meta.status] || record.meta.status}</span>
    </div>

    <section>
      <h3>Attributes</h3>
      <dl class="attributes-grid">${attributesHtml}</dl>
    </section>

    ${triviaHtml}
    ${officialContextHtml}

    <section>
      <h3>Observations (${observations.length})</h3>
      ${observationsHtml}
    </section>
  `;

  wireObservationCardClicks(observations);
}

function renderUnauditedStreetDetail(properties, sourcePulled) {
  panel.classList.remove("street-panel--empty");

  const attributeRows = [];
  if (properties.length_m != null) {
    attributeRows.push(`<dt>length</dt><dd>${formatLength(properties.length_m)}</dd>`);
  }
  if (properties.surface_type) {
    attributeRows.push(`<dt>surface type</dt><dd>${properties.surface_type}</dd>`);
  }
  if (properties.road_class) {
    attributeRows.push(`<dt>road class</dt><dd>${properties.road_class}</dd>`);
  }

  const attributesHtml = attributeRows.length
    ? `<dl class="attributes-grid">${attributeRows.join("")}</dl>`
    : '<p class="street-panel__placeholder">No OSM attributes available for this street.</p>';

  // sourcePulled comes from the FeatureCollection's single top-level
  // source_pulled (see scripts/refresh_osm.py), not a per-feature field -
  // every street was pulled in the same run, so there's nothing to gain
  // from repeating that date 128 times over.
  const sourceNote = properties.source
    ? `<p class="panel-source-footer">Source: ${properties.source}${
        sourcePulled ? ` (pulled ${sourcePulled})` : ""
      }</p>`
    : "";

  panel.innerHTML = `
    <div class="panel-header-row">
      <div class="panel-header-names">
        <h2>${properties.name}</h2>
        <p class="street-panel__name-bg">${properties.name_bg || ""}</p>
      </div>
      <span class="status-badge" data-status="${properties.status}">${STATUS_LABEL[properties.status] || properties.status}</span>
    </div>

    <section>
      <h3>Attributes</h3>
      ${attributesHtml}
    </section>

    <p class="street-panel__wip-note">
      This street hasn't been documented yet. Observations, trivia, and full
      attributes will appear here once an audit has been completed.
    </p>

    ${sourceNote}
  `;
}

async function loadStreetDetail(streetId) {
  showPlaceholder("Loading street record…");
  try {
    const response = await fetch(`data/streets/${streetId}.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const record = await response.json();
    renderStreetDetail(record);
  } catch (err) {
    showError(
      `Could not load the record for this street. (${err.message})`
    );
  }
}

async function init() {
  try {
    const [geojson, taxonomy, observationsData] = await Promise.all([
      fetch("data/tutrakan-streets.geojson").then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading tutrakan-streets.geojson`);
        }
        return response.json();
      }),
      fetch("data/taxonomy.json").then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading taxonomy.json`);
        }
        return response.json();
      }),
      fetch("data/observations.json").then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading observations.json`);
        }
        return response.json();
      }),
    ]);

    CATEGORY_ICON = taxonomy.category_icon;
    FALLBACK_ICON = taxonomy.fallback_icon;
    allObservations = observationsData.observations || [];

    // id -> { layer, props }, for the search control below to jump to a
    // street that isn't necessarily visible or already clicked - the plain
    // click/keyboard path above never needed this, it always already has
    // the layer in hand.
    const streetLayersById = {};

    function selectStreet(layer, props) {
      selectStreetLayer(layer, props.status);
      if (props.audited && props.status !== "not_started") {
        loadStreetDetail(props.id);
      } else {
        renderUnauditedStreetDetail(props, geojson.source_pulled);
      }
    }

    L.geoJSON(geojson, {
      style: (feature) => styleForStreet(feature.properties),
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        streetLayersById[props.id] = { layer, props };
        layer.bindTooltip(props.name);
        layer.on("click", () => selectStreet(layer, props));

        // Leaflet's own interactive paths aren't keyboard-focusable by
        // default (no tabindex/role is set for vector layers, only for
        // markers) - make street selection genuinely reachable by
        // keyboard rather than relying on a focus outline that wouldn't
        // otherwise appear. Same selection logic as a click, on Enter/Space.
        layer.on("add", () => {
          const el = layer.getElement();
          if (!el) {
            return;
          }
          el.setAttribute("tabindex", "0");
          el.setAttribute("role", "button");
          el.setAttribute("aria-label", `${props.name} street`);
          el.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectStreet(layer, props);
            }
          });
        });
      },
    }).addTo(map);

    // Search-driven selection: same select-and-load-detail behaviour as a
    // direct click, plus flying the map to the street - a search result
    // usually isn't already in view.
    function focusStreet(streetId) {
      const entry = streetLayersById[streetId];
      if (!entry) {
        return;
      }
      selectStreet(entry.layer, entry.props);
      map.flyToBounds(entry.layer.getBounds(), {
        maxZoom: 17,
        duration: 0.8,
        padding: [40, 40],
      });
    }

    createStreetSearchControl(geojson.features, focusStreet).addTo(map);

    addObservationMarkers(allObservations);
  } catch (err) {
    showError(`Could not load the map data. (${err.message})`);
  }
}

init();

const aboutButton = document.getElementById("about-button");
const aboutModal = document.getElementById("about-modal");
const aboutModalClose = document.getElementById("about-modal-close");

aboutButton.addEventListener("click", () => {
  aboutModal.hidden = false;
});

aboutModalClose.addEventListener("click", () => {
  aboutModal.hidden = true;
});

aboutModal.addEventListener("click", (event) => {
  if (event.target === aboutModal) {
    aboutModal.hidden = true;
  }
});

const tutrakanButton = document.getElementById("tutrakan-button");
const tutrakanModal = document.getElementById("tutrakan-modal");
const tutrakanModalClose = document.getElementById("tutrakan-modal-close");
const tutrakanTabButtons = tutrakanModal.querySelectorAll(".tabs__button");
const tutrakanTabPanels = tutrakanModal.querySelectorAll(".tabs__panel");

tutrakanButton.addEventListener("click", () => {
  tutrakanModal.hidden = false;
});

tutrakanModalClose.addEventListener("click", () => {
  tutrakanModal.hidden = true;
});

tutrakanModal.addEventListener("click", (event) => {
  if (event.target === tutrakanModal) {
    tutrakanModal.hidden = true;
  }
});

tutrakanTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tutrakanTabButtons.forEach((b) =>
      b.classList.toggle("tabs__button--active", b === button)
    );
    tutrakanTabPanels.forEach((tabPanel) => {
      tabPanel.hidden = tabPanel.dataset.tabPanel !== button.dataset.tab;
    });
  });
});

const welcomeOverlay = document.getElementById("welcome-overlay");
const welcomeEnterButton = document.getElementById("welcome-enter");
const welcomeDontShowCheckbox = document.getElementById("welcome-dont-show");

welcomeEnterButton.addEventListener("click", () => {
  if (welcomeDontShowCheckbox.checked) {
    try {
      // Write side of "sbs_welcome_seen" - the read side lives in
      // index.html's inline script. Change both together; a mismatch here
      // is exactly what left "Don't show this again" silently doing
      // nothing for a while.
      localStorage.setItem("sbs_welcome_seen", "true");
    } catch (err) {
      // localStorage unavailable - overlay will simply show again next visit
    }
  }
  welcomeOverlay.classList.add("welcome-overlay--dismissed");
  setTimeout(() => {
    welcomeOverlay.hidden = true;
  }, 250);
});
