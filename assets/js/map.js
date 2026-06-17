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

const panel = document.getElementById("street-panel");

function styleForStreet(properties) {
  if (properties.audited) {
    return {
      color: "#1d9e75",
      weight: 5,
      opacity: 0.9,
    };
  }
  return {
    color: "#a3a3a3",
    weight: 2,
    opacity: 0.6,
  };
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
          if (props.audited) {
            loadStreetDetail(props.id);
          } else {
            showPlaceholder(
              `<strong>${props.name}</strong> (${props.name_bg}) has not been audited yet.`
            );
          }
        });
      },
    }).addTo(map);
  } catch (err) {
    showError(`Could not load the street network. (${err.message})`);
  }
}

init();
