// datas/vizMap.js
// Carte sombre + tooltip au survol (sans auto-pan) + popup “pinnée” au clic + pin sobre

const CSV_PATH = "./datas/artists.csv";

// Coordonnées "représentatives" par nationalité (capitale / centre).
// (À compléter si tu veux couvrir plus de cas.)
const NATIONALITY_COORDS = {
  Italian:   { lat: 41.9028, lon: 12.4964 },
  French:    { lat: 48.8566, lon: 2.3522 },
  Belgian:   { lat: 50.8503, lon: 4.3517 },
  Flemish:   { lat: 50.8503, lon: 4.3517 },
  Dutch:     { lat: 52.3676, lon: 4.9041 },
  Spanish:   { lat: 40.4168, lon: -3.7038 },
  Russian:   { lat: 55.7558, lon: 37.6173 },
  Mexican:   { lat: 19.4326, lon: -99.1332 },
  German:    { lat: 52.5200, lon: 13.4050 },
  Austrian:  { lat: 48.2082, lon: 16.3738 },
  Swiss:     { lat: 46.9480, lon: 7.4474 },
  British:   { lat: 51.5072, lon: -0.1276 },
  Norwegian: { lat: 59.9139, lon: 10.7522 },
  American:  { lat: 38.9072, lon: -77.0369 },
  Greek:     { lat: 37.9838, lon: 23.7275 },
  Belarusian:{ lat: 53.9006, lon: 27.5590 },
  Jewish:    null // pas une localisation géographique -> ignorée
};

const WIKI_THUMB_CACHE = new Map();

// Gestion popup “pinnée” (clic)
let PINNED_MARKER = null;

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// "French,British" => essaie French puis British etc.
function pickCoords(nationalityRaw) {
  if (!nationalityRaw) return null;
  const parts = String(nationalityRaw).split(",").map(s => s.trim()).filter(Boolean);

  for (const p of parts) {
    const coords = NATIONALITY_COORDS[p];
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) return coords;
  }
  return null;
}

// Extrait le "title" de l’URL Wikipedia (…/wiki/Claude_Monet)
function wikiTitleFromUrl(url) {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf("/wiki/");
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + "/wiki/".length));
  } catch {
    return null;
  }
}

// Wikipedia REST: summary => contient souvent thumbnail.source
async function fetchWikiThumbnail(title) {
  if (!title) return null;
  if (WIKI_THUMB_CACHE.has(title)) return WIKI_THUMB_CACHE.get(title);

  const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const r = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const thumb = j?.thumbnail?.source || null;
    WIKI_THUMB_CACHE.set(title, thumb);
    return thumb;
  } catch {
    WIKI_THUMB_CACHE.set(title, null);
    return null;
  }
}

function cardHtml({ name, genre, nationality, years, thumbUrl, wikiUrl }) {
  const safeName = escapeHtml(name);
  const safeGenre = escapeHtml(genre);
  const safeNat = escapeHtml(nationality);
  const safeYears = escapeHtml(years);
  const safeWiki = escapeHtml(wikiUrl || "");

  // ✅ contain = pas de rognage (avec fond)
  const img = thumbUrl
    ? `<img src="${escapeHtml(thumbUrl)}" alt="${safeName}"
         style="width:100%;height:100%;object-fit:contain;display:block;padding:6px;background:rgba(255,255,255,0.04);">`
    : `<div style="display:flex;align-items:center;justify-content:center;height:100%;opacity:.7;">(pas de photo)</div>`;

  const wikiLine = safeWiki
    ? `<div style="margin-top:8px;font-size:12px;opacity:.9;">
         <a href="${safeWiki}" target="_blank" rel="noopener noreferrer"
            style="color:#9ecbff;text-decoration:none;">
           Ouvrir Wikipedia
         </a>
       </div>`
    : "";

  return `
    <div style="width:240px;">
      <div style="width:100%; height:140px; border-radius:12px; overflow:hidden; background:rgba(255,255,255,0.03); margin-bottom:10px;">
        ${img}
      </div>
      <div style="font-weight:800; margin-bottom:6px;">${safeName}</div>
      <div style="font-size:12px; line-height:1.45; opacity:.92;">
        <div><b>Genre (artistique):</b> ${safeGenre || "—"}</div>
        <div><b>Nationalité:</b> ${safeNat || "—"}</div>
        <div><b>Années:</b> ${safeYears || "—"}</div>
      </div>
      ${wikiLine}
    </div>
  `;
}

// Tooltip = survol (pas de pan), Popup = clic (cliquable)
function hoverHtml(payload) {
  return cardHtml(payload);
}

// ✅ pin “sobre” : petit point avec halo
const soberIcon = L.divIcon({
  className: "",
  html: `
    <div style="
      width:12px;height:12px;border-radius:999px;
      background: rgba(255,255,255,0.85);
      box-shadow: 0 0 0 4px rgba(255,255,255,0.12);
      border: 1px solid rgba(0,0,0,0.25);
    "></div>
  `,
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

// ✅ Option “smart” : choisir au survol si tooltip plutôt au-dessus ou en dessous
// (évite qu’elle parte hors-carte quand le point est en bordure).
function chooseTooltipDirection(map, latlng) {
  const size = map.getSize();                       // px
  const p = map.latLngToContainerPoint(latlng);     // px
  const margin = 160; // approx hauteur tooltip + marge

  // si pas assez de place en haut, on préfère en bas
  if (p.y < margin) return { direction: "bottom", offset: [0, 12] };
  // si pas assez de place en bas, on préfère en haut
  if (size.y - p.y < margin) return { direction: "top", offset: [0, -12] };

  // sinon, plutôt en haut (ou bottom si tu préfères)
  return { direction: "top", offset: [0, -12] };
}

document.addEventListener("DOMContentLoaded", () => {
  const map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);

  // ✅ Fond sombre (CARTO Dark Matter)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  }).addTo(map);

  // Clic sur la carte = unpin
  map.on("click", () => {
    if (PINNED_MARKER) {
      PINNED_MARKER.closePopup();
      PINNED_MARKER = null;
    }
  });

  const markers = [];

  Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: async (res) => {
      const rows = res.data || [];

      for (const row of rows) {
        const coords = pickCoords(row.nationality);
        if (!coords) continue;

        const title = wikiTitleFromUrl(row.wikipedia);
        const thumb = await fetchWikiThumbnail(title);

        const payload = {
          name: row.name,
          genre: row.genre,
          nationality: row.nationality,
          years: row.years,
          thumbUrl: thumb,
          wikiUrl: row.wikipedia
        };

        const marker = L.marker([coords.lat, coords.lon], {
          title: row.name || "",
          icon: soberIcon
        });

        // ✅ Tooltip (survol) : pas d’auto-pan, placement ajusté dynamiquement
        marker.bindTooltip(hoverHtml(payload), {
          direction: "top",      // sera ajusté au mouseover
          opacity: 1,
          offset: [0, -12],
          className: "person-tooltip",
          sticky: true           // plus agréable au survol
        });

        // ✅ Popup (clic) : cliquable + autoPan OK
        marker.bindPopup(cardHtml(payload), {
          closeButton: true,
          autoPan: true,
          className: "person-popup"
        });

        // Hover: ouvrir tooltip seulement si rien n’est pinné
        marker.on("mouseover", () => {
          if (PINNED_MARKER) return;

          // Ajuste top/bottom en fonction de la place
          const pref = chooseTooltipDirection(map, marker.getLatLng());
          marker.setTooltipContent(hoverHtml(payload)); // garde contenu
          marker.getTooltip().options.direction = pref.direction;
          marker.getTooltip().options.offset = pref.offset;

          marker.openTooltip();
        });

        marker.on("mouseout", () => {
          if (!PINNED_MARKER) marker.closeTooltip();
        });

        // Click: pin le popup (et ferme tooltip si ouvert)
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);

          marker.closeTooltip();

          if (PINNED_MARKER && PINNED_MARKER !== marker) {
            PINNED_MARKER.closePopup();
          }

          PINNED_MARKER = marker;
          marker.openPopup();
        });

        // Quand popup se ferme: unpin
        marker.on("popupclose", () => {
          if (PINNED_MARKER === marker) PINNED_MARKER = null;
        });

        marker.addTo(map);
        markers.push(marker);
      }

      if (markers.length) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.2));
      }
    },
    error: (err) => console.error("Erreur CSV:", err)
  });
});
