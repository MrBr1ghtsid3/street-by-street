// Loads data/*.geojson and data/streets/*.json via fetch(), which browsers
// block under file://. Serve this directory over HTTP (see README) to test
// locally.

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
  complete: { color: "#1D9E75", weight: 14, opacity: 0.9, lineCap: "round", lineJoin: "round", fill: false, fillColor: "transparent", className: "street-line" },
};

const legend = L.control({ position: "bottomleft" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "map-legend");
  div.innerHTML = `
    <div class="map-legend__section">
      <h4>Streets</h4>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--active"></span>Active</div>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--complete"></span>Complete</div>
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

// Holds every audited street's observation markers, all at once, regardless
// of which street's panel is currently open. Populated once at startup and
// never cleared on street switch - marker visibility is independent of
// panel selection.
const observationMarkersLayer = L.layerGroup().addTo(map);

// `${streetId}::${obs.id}` -> Leaflet marker, across all audited streets.
// Composite-keyed because obs.id is only unique within a street. Lets a
// click on a side-panel card find and open the matching map marker's popup.
const markersByKey = {};

// street id -> display name, populated from the GeoJSON on load. Used to
// label nearby streets in the observation popup.
const streetNamesById = {};

const OBSERVATION_MARKER_COLOR = {
  issue: "#D85A30",
  asset: "#1D9E75",
};

// Single source of truth for category -> Tabler icon, shared by the
// observation cards in the side panel and the map pin markers.
const CATEGORY_ICON = {
  road: "ti-road",
  litter: "ti-trash",
  vegetation: "ti-plant-2",
  hazard: "ti-alert-triangle",
  structure: "ti-wall",
  business: "ti-building-store",
  green_space: "ti-tree",
  infrastructure: "ti-droplet",
  service: "ti-users",
  heritage: "ti-building-monument",
  other: "ti-dots",
};

const REPO_ISSUES_URL = "https://github.com/MrBr1ghtsid3/street-by-street/issues";

// Street audit status -> display label, for the badge shown in the side
// panel. Distinct from statusLabel() below, which formats observation
// status (open/in_progress/resolved/active/inactive), not street status.
const STATUS_LABEL = {
  not_started: "Not yet audited",
  active: "Audit in progress",
  complete: "Fully documented",
};

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
  const icon = CATEGORY_ICON[obs.category] || CATEGORY_ICON.other;
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
  const icon = CATEGORY_ICON[obs.category] || CATEGORY_ICON.other;
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
        Photo pending. Once published, faces and identifiable animal
        features will be blurred prior to publication &mdash; see
        <a href="https://github.com/MrBr1ghtsid3/street-by-street/blob/main/docs/ethics.md" target="_blank" rel="noopener noreferrer">Ethics</a>.
      </p>
    </div>
  `;
}

function streetNameFor(streetId) {
  return streetNamesById[streetId] || streetId;
}

function renderNearbyStreetsLine(obs) {
  const nearby = obs.nearby_streets;
  if (!nearby || !nearby.length) {
    return "";
  }

  const primary = nearby.find((entry) => entry.primary) || nearby[0];
  const others = nearby.filter((entry) => entry !== primary);

  if (!others.length) {
    return `<p class="observation-popup__nearby">Street: ${streetNameFor(primary.street_id)}</p>`;
  }

  const othersText = others
    .map((entry) => `${streetNameFor(entry.street_id)} (${entry.distance_m}m)`)
    .join(", ");

  return `
    <p class="observation-popup__nearby">
      Primary: ${streetNameFor(primary.street_id)} (${primary.distance_m}m)
      &middot; Also near: ${othersText}
    </p>
  `;
}

function renderCaseLink(obs, streetId) {
  if (obs.tracking_issue) {
    return `<a class="observation-popup__case" href="${REPO_ISSUES_URL}/${obs.tracking_issue}" target="_blank" rel="noopener noreferrer">Case #${obs.tracking_issue}</a>`;
  }

  const params = new URLSearchParams({
    template: "case.yml",
    "street-ref": streetId,
    "observation-ref": String(obs.id),
  });

  return `
    <span class="observation-popup__no-case">No case opened yet</span>
    <a class="observation-popup__open-case" href="${REPO_ISSUES_URL}/new?${params.toString()}" target="_blank" rel="noopener noreferrer">+ Open a Case</a>
  `;
}

function renderObservationPopup(obs, streetId) {
  const icon = CATEGORY_ICON[obs.category] || CATEGORY_ICON.other;
  return `
    <div class="observation-popup">
      <div class="observation-popup__title">${obs.title}</div>
      <div class="observation-popup__meta">
        <span class="observation-popup__category observation-popup__category--${obs.type}"><i class="ti ${icon}" aria-hidden="true"></i> ${categoryLabel(obs.category)}</span>
        <span class="status-badge status-badge--${obs.status}">${statusLabel(obs.status)}</span>
      </div>
      ${renderPhotoPlaceholder()}
      <p class="observation-popup__date">${renderObservationDate(obs)}</p>
      ${renderNearbyStreetsLine(obs)}
      <div class="observation-popup__case-row">${renderCaseLink(obs, streetId)}</div>
    </div>
  `;
}

function addObservationMarkers(streetId, observations) {
  observations
    .filter((obs) => obs.coordinates)
    .forEach((obs) => {
      const marker = L.marker([obs.coordinates.lat, obs.coordinates.lng], {
        icon: buildPinIcon(obs),
      });
      marker.bindPopup(renderObservationPopup(obs, streetId), {
        maxWidth: 320,
        className: "observation-popup-wrapper",
      });
      observationMarkersLayer.addLayer(marker);
      markersByKey[`${streetId}::${obs.id}`] = marker;
    });
}

async function loadAllObservationMarkers(geojson) {
  const auditedFeatures = geojson.features.filter(
    (feature) => feature.properties.audited === true
  );

  await Promise.all(
    auditedFeatures.map(async (feature) => {
      const streetId = feature.properties.id;
      try {
        const response = await fetch(`data/streets/${streetId}.json`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const record = await response.json();
        addObservationMarkers(streetId, record.observations || []);
      } catch (err) {
        console.error(`Could not load observations for ${streetId}. (${err.message})`);
      }
    })
  );
}

function wireObservationCardClicks(observations, streetId) {
  panel.querySelectorAll(".observation-card--locatable").forEach((card) => {
    card.addEventListener("click", () => {
      const obsId = Number(card.dataset.obsId);
      const obs = observations.find((o) => o.id === obsId);
      const marker = markersByKey[`${streetId}::${obsId}`];
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

  const observations = record.observations || [];
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

  wireObservationCardClicks(observations, record.meta.id);
}

function renderUnauditedStreetDetail(properties) {
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

  const sourceNote = properties.source
    ? `<p class="panel-source-footer">Source: ${properties.source}${
        properties.source_pulled ? ` (pulled ${properties.source_pulled})` : ""
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
    const response = await fetch("data/tutrakan-streets.geojson");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const geojson = await response.json();

    function selectStreet(layer, props) {
      selectStreetLayer(layer, props.status);
      if (props.audited && props.status !== "not_started") {
        loadStreetDetail(props.id);
      } else {
        renderUnauditedStreetDetail(props);
      }
    }

    L.geoJSON(geojson, {
      style: (feature) => styleForStreet(feature.properties),
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        streetNamesById[props.id] = props.name;
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

    loadAllObservationMarkers(geojson);
  } catch (err) {
    showError(`Could not load the street network. (${err.message})`);
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
