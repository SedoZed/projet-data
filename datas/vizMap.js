// datas/vizMap.js

const CSV_PATH = "./datas/artists.csv";

// Coordonnées "représentatives" par nationalité (capitale / centre).
// (Tu peux ajuster / compléter si besoin.)
const NATIONALITY_COORDS = {
  Italian:   { lat: 41.9028, lon: 12.4964 },   // Rome
  French:    { lat: 48.8566, lon: 2.3522 },    // Paris
  Belgian:   { lat: 50.8503, lon: 4.3517 },    // Bruxelles
  Flemish:   { lat: 50.8503, lon: 4.3517 },    // (Belgique)
  Dutch:     { lat: 52.3676, lon: 4.9041 },    // Amsterdam
  Spanish:   { lat: 40.4168, lon: -3.7038 },   // Madrid
  Russian:   { lat: 55.7558, lon: 37.6173 },   // Moscou
  Mexican:   { lat: 19.4326, lon: -99.1332 },  // Mexico City
  German:    { lat: 52.5200, lon: 13.4050 },   // Berlin
  Austrian:  { lat: 48.2082, lon: 16.3738 },   // Vienne
  Swiss:     { lat: 46.9480, lon: 7.4474 },    // Berne
  British:   { lat: 51.5072, lon: -0.1276 },   // Londres
  Norwegian: { lat: 59.9139, lon: 10.7522 },   // Oslo
  American:  { lat: 38.9072, lon: -77.0369 },  // Washington DC

  // Nationalités parfois présentes en “secondaires”
  Greek:     { lat: 37.9838, lon: 23.7275 },   // Athènes
  Belarusian:{ lat: 53.9006, lon: 27.5590 },   // Minsk
  Jewish:    null // pas une localisation géographique -> ignorée
};

// Cache des thumbnails Wikipedia (évite de re-fetch)
const WIKI_THUMB_CACHE = new Map();

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Prend la valeur "French,British" => essaie French puis British etc.
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
    const title = u.pathname.slice(idx + "/wiki/".length);
    return decodeURIComponent(title); // garde underscores
  } catch {
    return null;
  }
}

// API REST Wikipedia: summary => contient souvent thumbnail.source
async function fetchWikiThumbnail(title) {
  if (!title) return null;
  if (WIKI_THUMB_CACHE.has(title)) return WIKI_THUMB_CACHE.get(title);

  const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const r = await fetch(endpoint, { headers: { "accept": "application/json" } });
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

function popupHtml({ name, genre, nationality, years, thumbUrl, wikiUrl }) {
  const safeName = escapeHtml(name);
  const safeGenre = escapeHtml(genre);
  const safeNat = escapeHtml(nationality);
  const safeYears = escapeHtml(years);
  const safeWiki = escapeHtml(wikiUrl || "");

  const img = thumbUrl
    ? `<img src="${escapeHtml(thumbUrl)}" alt="${safeName}" style="width:100%;height:120px;object-fit:cover;">`
    : `<div style="display:flex;align-items:center;justify-content:center;height:120px;opacity:.7;">(pas de photo)</div>`;

  const wikiLine = safeWiki
    ? `<div style="margin-top:6px; font-size:12px; opacity:.8;">
         <a href="${safeWiki}" target="_blank" rel="noopener noreferrer" style="color:#9ecbff; text-decoration:none;">
           Wikipedia
         </a>
       </div>`
    : "";

  return `
    <div style="width:230px;">
      <div style="width:100%; height:120px; border-radius:12px; overflow:hidden; background:rgba(255,255,255,0.06); margin-bottom:8px;">
        ${img}
      </div>
      <div style="font-weight:800; margin-bottom:6px;">${safeName}</div>
      <div style="font-size:12px; line-height:1.4; opacity:.9;">
        <div><b>Genre (artistique):</b> ${safeGenre || "—"}</div>
        <div><b>Nationalité:</b> ${safeNat || "—"}</div>
        <div><b>Années:</b> ${safeYears || "—"}</div>
      </div>
      ${wikiLine}
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  const map = L.map("map", { preferCanvas: true }).setView([20, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

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

        const marker = L.marker([coords.lat, coords.lon], { title: row.name || "" });

        marker.bindPopup(
          popupHtml({
            name: row.name,
            genre: row.genre,
            nationality: row.nationality,
            years: row.years,
            thumbUrl: thumb,
            wikiUrl: row.wikipedia
          }),
          { closeButton: false, autoPan: true, className: "person-popup" }
        );

        // Survol => open ; sortie => close
        marker.on("mouseover", () => marker.openPopup());
        marker.on("mouseout", () => marker.closePopup());

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
