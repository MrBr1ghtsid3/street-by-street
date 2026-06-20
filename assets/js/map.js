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
  return `
    <div class="observation-card observation-card--${obs.type}">
      <div class="observation-card__header">
        <span class="observation-card__title">${obs.title}</span>
        <span class="observation-card__category">${categoryLabel(obs.category)}</span>
      </div>
      <p class="observation-card__description">${obs.description}</p>
      <div class="observation-card__meta">
        <span class="status-badge status-badge--${obs.status}">${statusLabel(obs.status)}</span>
        &middot; reported ${obs.reported_date}${obs.resolved_date ? ` &middot; resolved ${obs.resolved_date}` : ""}
      </div>
    </div>
  `;
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
        layer.bindTooltip(props.name);
        layer.on("click", () => {
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
