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

const STREET_STATUS_STYLES = {
  not_started: { color: "#9CA3AF", weight: 2, opacity: 0.6 },
  active: { color: "#F59E0B", weight: 3, opacity: 0.9 },
  complete: { color: "#1D9E75", weight: 4, opacity: 0.9 },
};

const legend = L.control({ position: "bottomleft" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "map-legend");
  div.innerHTML = `
    <div class="map-legend__section">
      <h4>Streets</h4>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--active"></span>Active</div>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--complete"></span>Complete</div>
      <div class="map-legend__item"><span class="map-legend__line map-legend__line--not-started"></span>Not started</div>
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

// Holds observation markers for whichever street is currently selected.
// Cleared on every street click so markers never accumulate across streets.
const observationMarkersLayer = L.layerGroup().addTo(map);

// obs.id -> Leaflet marker, for the currently selected street only. Lets a
// click on a side-panel card find and open the matching map marker's popup.
let currentMarkersByObsId = {};

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

const panel = document.getElementById("street-panel");

function styleForStreet(properties) {
  return (
    STREET_STATUS_STYLES[properties.status] ||
    STREET_STATUS_STYLES.not_started
  );
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

function renderObservationMarkers(observations, streetId) {
  observationMarkersLayer.clearLayers();
  currentMarkersByObsId = {};
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
      currentMarkersByObsId[obs.id] = marker;
    });
}

function wireObservationCardClicks(observations) {
  panel.querySelectorAll(".observation-card--locatable").forEach((card) => {
    card.addEventListener("click", () => {
      const obsId = Number(card.dataset.obsId);
      const obs = observations.find((o) => o.id === obsId);
      const marker = currentMarkersByObsId[obsId];
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
    .map(
      ([key, value]) =>
        `<dt>${key.replace(/_/g, " ")}</dt><dd>${value === null ? "—" : value}</dd>`
    )
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

  renderObservationMarkers(observations, record.meta.id);

  panel.innerHTML = `
    <h2>${record.meta.name}</h2>
    <p class="street-panel__name-bg">${record.meta.name_bg || ""}</p>

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

function renderUnauditedStreetDetail(properties) {
  panel.classList.remove("street-panel--empty");

  const attributeRows = [];
  if (properties.length_m != null) {
    attributeRows.push(`<dt>length m</dt><dd>${properties.length_m}</dd>`);
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
    ? `<p class="street-panel__source-note">Source: ${properties.source}${
        properties.source_pulled ? ` (pulled ${properties.source_pulled})` : ""
      }</p>`
    : "";

  panel.innerHTML = `
    <h2>${properties.name}</h2>
    <p class="street-panel__name-bg">${properties.name_bg || ""}</p>
    <span class="status-badge status-badge--not_started">Not yet audited</span>

    <section>
      <h3>Attributes</h3>
      ${attributesHtml}
      ${sourceNote}
    </section>

    <p class="street-panel__wip-note">
      This street hasn't been documented yet. Observations, trivia, and full
      attributes will appear here once an audit has been completed.
    </p>
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

    L.geoJSON(geojson, {
      style: (feature) => styleForStreet(feature.properties),
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        streetNamesById[props.id] = props.name;
        layer.bindTooltip(props.name);
        layer.on("click", () => {
          observationMarkersLayer.clearLayers();
          currentMarkersByObsId = {};
          if (props.audited && props.status !== "not_started") {
            loadStreetDetail(props.id);
          } else {
            renderUnauditedStreetDetail(props);
          }
        });
      },
    }).addTo(map);
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
