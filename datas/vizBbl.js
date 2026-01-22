// datas/viz2.js
// Bubble network complet :
// - bulles confinées dans le cadre (clamp)
// - clusters par mouvement
// - filtre mouvement + légende cliquable
// - slider "min genres en commun" pour les liens
// - recherche (highlight + recentrage)
// - badge multi-genres
// - taille = paintings OU popularité Wikipedia (pageviews 30j) (lazy/cache)

const CSV_PATH = "./datas/artists.csv";
const ALL = "__ALL__";

const UI = {
  movementFilter: null,
  minCommon: null,
  minCommonLabel: null,
  sizeMetric: null,
  searchName: null,
  resetBtn: null,
  legend: null,
  stats: null
};

function parseList(raw) {
  if (!raw) return [];
  return String(raw).split(",").map(s => s.trim()).filter(Boolean);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function intersectCount(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  let c = 0;
  for (const x of b) if (setA.has(x)) c++;
  return c;
}

function toBullets(items) {
  if (!items?.length) return "—";
  return items.map(x => `• ${escapeHtml(x)}`).join("<br>");
}

// Wikipedia Pageviews API (30 jours) - cache
const WIKI_VIEWS_CACHE = new Map();

function wikiTitleFromUrl(url) {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf("/wiki/");
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + "/wiki/".length)); // garde underscores
  } catch {
    return null;
  }
}

function yyyymmdd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${da}`;
}

async function fetchWikiViews30d(title) {
  if (!title) return null;
  if (WIKI_VIEWS_CACHE.has(title)) return WIKI_VIEWS_CACHE.get(title);

  // période : aujourd'hui - 30 jours (API demande start/end)
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);

  const project = "en.wikipedia.org";
  const access = "all-access";
  const agent = "user";
  const granularity = "daily";

  // endpoint Pageviews
  const endpoint =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/` +
    `${project}/${access}/${agent}/${encodeURIComponent(title)}/${granularity}/${yyyymmdd(start)}/${yyyymmdd(end)}`;

  try {
    const r = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const items = j?.items || [];
    const sum = items.reduce((acc, it) => acc + (it.views || 0), 0);
    WIKI_VIEWS_CACHE.set(title, sum);
    return sum;
  } catch {
    WIKI_VIEWS_CACHE.set(title, null);
    return null;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("bubbleViz");
  if (!container) return;

  // UI refs
  UI.movementFilter = document.getElementById("movementFilter");
  UI.minCommon = document.getElementById("minCommon");
  UI.minCommonLabel = document.getElementById("minCommonLabel");
  UI.sizeMetric = document.getElementById("sizeMetric");
  UI.searchName = document.getElementById("searchName");
  UI.resetBtn = document.getElementById("resetBtn");
  UI.legend = document.getElementById("legend");
  UI.stats = document.getElementById("stats");

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "dv-tooltip";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  const getSize = () => {
    const r = container.getBoundingClientRect();
    return { width: Math.max(320, Math.floor(r.width)), height: Math.max(420, Math.floor(r.height)) };
  };

  // SVG base
  const svg = d3.select(container).append("svg");
  const gLinks = svg.append("g");
  const gNodes = svg.append("g");
  const gLabels = svg.append("g");

  // --- Load data
  const raw = await d3.csv(CSV_PATH, d => {
    const genres = parseList(d.genre);
    const nationalities = parseList(d.nationality);
    const primaryGenre = genres[0] || "Unknown";
    const paintings = +d.paintings || 0;

    const title = wikiTitleFromUrl(d.wikipedia);

    return {
      id: d.id,
      name: d.name,
      years: d.years,
      wikipedia: d.wikipedia,
      wikiTitle: title,
      paintings,
      // views 30d (lazy)
      wiki30d: null,
      // lists
      genres,
      primaryGenre,
      nationalities,
      // multi-genre indicator
      multi: genres.length > 1
    };
  });

  // Palette / genres
  const genreDomain = Array.from(new Set(raw.map(d => d.primaryGenre))).sort(d3.ascending);

  // Couleurs
  const palette = d3.schemeTableau10.concat(d3.schemeSet3, d3.schemePaired).flat();
  const color = d3.scaleOrdinal().domain(genreDomain).range(palette.slice(0, genreDomain.length));

  // UI options
  function fillSelect(selectEl, values) {
    selectEl.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = ALL;
    optAll.textContent = "Tous";
    selectEl.appendChild(optAll);

    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
  }

  fillSelect(UI.movementFilter, genreDomain);

  // slider max = 3 par défaut, mais on adapte à ton dataset (max genres communs possible)
  // (tu peux augmenter si tu veux, mais 1..3 est souvent suffisant)
  UI.minCommonLabel.textContent = UI.minCommon.value;

  // Légende cliquable
  let legendActive = ALL;
  function renderLegend() {
    UI.legend.innerHTML = "";
    genreDomain.forEach(g => {
      const btn = document.createElement("button");
      btn.className = "select";
      btn.style.cursor = "pointer";
      btn.style.minWidth = "auto";
      btn.style.padding = "8px 10px";
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.gap = "8px";
      btn.style.opacity = (legendActive === ALL || legendActive === g) ? "1" : "0.55";

      btn.innerHTML = `
        <span style="width:10px;height:10px;border-radius:999px;background:${color(g)};opacity:.8;display:inline-block;"></span>
        <span>${escapeHtml(g)}</span>
      `;

      btn.addEventListener("click", () => {
        legendActive = (legendActive === g) ? ALL : g;
        // synchro sur le select
        UI.movementFilter.value = legendActive;
        renderLegend();
        rebuild();
      });

      UI.legend.appendChild(btn);
    });
  }
  renderLegend();

  // --- State
  let nodesAll = raw.map(d => ({ ...d, x: 0, y: 0, r: 12 }));
  let nodes = [];
  let links = [];
  let simulation = null;

  // size metric
  function getMetricKey() {
    return UI.sizeMetric.value; // paintings | wiki30d
  }

  // compute radii
  function computeRadiusScale(currNodes) {
    const metric = getMetricKey();
    const values = currNodes.map(d => (metric === "paintings" ? d.paintings : (d.wiki30d ?? 0)));
    const maxV = d3.max(values) || 1;

    return d3.scaleSqrt()
      .domain([0, maxV])
      .range([10, 62]);
  }

  // cluster centers (one per genre around a circle)
  function computeCenters(width, height) {
    const R = Math.min(width, height) * 0.26; // rayon du cercle de centres
    const cx = width / 2, cy = height / 2;

    const angle = d3.scalePoint()
      .domain(genreDomain)
      .range([0, Math.PI * 2]);

    const centers = new Map();
    genreDomain.forEach(g => {
      const a = angle(g);
      centers.set(g, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
    });
    return centers;
  }

  // build links based on threshold and current node set
  function buildLinks(currNodes, minCommon) {
    const byId = new Map(currNodes.map(d => [d.id, d]));
    const out = [];

    for (let i = 0; i < currNodes.length; i++) {
      for (let j = i + 1; j < currNodes.length; j++) {
        const a = currNodes[i];
        const b = currNodes[j];
        const common = intersectCount(a.genres, b.genres);
        if (common >= minCommon) {
          out.push({ source: a.id, target: b.id, common });
        }
      }
    }

    // build adjacency for highlight
    const adj = new Map();
    const key = (x, y) => (x < y ? `${x}__${y}` : `${y}__${x}`);
    out.forEach(l => adj.set(key(l.source, l.target), l.common));

    const isLinked = (A, B) => A.id === B.id || adj.has(key(A.id, B.id));

    return { links: out, isLinked, byId };
  }

  // tooltip
  function showTooltip(event, d) {
    const metric = getMetricKey();
    const metricLabel = metric === "paintings" ? "Œuvres (paintings)" : "Popularité Wiki (30j)";
    const metricValue = metric === "paintings" ? d.paintings : (d.wiki30d ?? "—");

    tooltip.innerHTML = `
      <div style="font-weight:800; margin-bottom:6px;">${escapeHtml(d.name)}</div>
      <div><b>${escapeHtml(metricLabel)}:</b> ${escapeHtml(metricValue)}</div>

      <div style="margin-top:6px;"><b>Genres:</b><br>${toBullets(d.genres)}</div>
      <div style="margin-top:6px;"><b>Nationalités:</b><br>${toBullets(d.nationalities)}</div>

      <div style="margin-top:6px;"><b>Années:</b> ${escapeHtml(d.years || "—")}</div>

      <div style="margin-top:8px;">
        <a href="${escapeHtml(d.wikipedia)}" target="_blank" rel="noopener noreferrer"
           style="color:#9ecbff; text-decoration:none;">Wikipedia</a>
      </div>
    `;
    tooltip.style.display = "block";
    moveTooltip(event);
  }

  function moveTooltip(event) {
    const pad = 14;
    const w = tooltip.offsetWidth || 260;
    const h = tooltip.offsetHeight || 140;
    let x = event.clientX + pad;
    let y = event.clientY + pad;

    if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  // search highlight
  let focusedId = null;
  function applySearchFocus() {
    const q = (UI.searchName.value || "").trim().toLowerCase();
    if (!q) {
      focusedId = null;
      return null;
    }
    // meilleur match simple : includes
    const found = nodes.find(n => (n.name || "").toLowerCase().includes(q));
    focusedId = found?.id ?? null;
    return found || null;
  }

  function pinToCenterTemporarily(node) {
    if (!node || !simulation) return;
    const { width, height } = getSize();
    node.fx = width / 2;
    node.fy = height / 2;
    simulation.alpha(0.7).restart();
    setTimeout(() => {
      node.fx = null;
      node.fy = null;
      simulation.alphaTarget(0);
    }, 900);
  }

  // Lazy fetch wiki views when metric=wiki30d
  async function ensureViewsForNodes(currNodes) {
    // charge en “petits lots” pour ne pas saturer
    const toLoad = currNodes.filter(d => d.wiki30d === null && d.wikiTitle);
    const batch = toLoad.slice(0, 10); // 10 à la fois
    if (!batch.length) return false;

    await Promise.all(batch.map(async d => {
      const v = await fetchWikiViews30d(d.wikiTitle);
      d.wiki30d = (typeof v === "number") ? v : 0;
    }));

    return true;
  }

  // Core rebuild
  async function rebuild() {
    const { width, height } = getSize();
    svg.attr("width", width).attr("height", height);

    const movement = UI.movementFilter.value;
    const minCommon = +UI.minCommon.value;
    const metric = getMetricKey();

    // filter nodes
    nodes = nodesAll.filter(d => movement === ALL ? true : d.primaryGenre === movement);

    // if metric is wiki30d, lazily fetch some views then rebuild scale
    if (metric === "wiki30d") {
      // On tente quelques batches successifs pour que ça se remplisse vite
      // sans bloquer l’UI.
      const didLoad = await ensureViewsForNodes(nodes);
      if (didLoad) {
        // On relance une fois après chargement pour que les rayons se mettent à jour
        // (sans boucle infinie : on ne recharge que si il y a encore des null)
        setTimeout(() => rebuild(), 50);
      }
    }

    // radius scale based on current filtered nodes
    const rScale = computeRadiusScale(nodes);
    nodes.forEach(d => { d.r = rScale(metric === "paintings" ? d.paintings : (d.wiki30d ?? 0)); });

    // build links based on threshold
    const built = buildLinks(nodes, minCommon);
    links = built.links;
    const isLinked = built.isLinked;

    // stats
    UI.stats.textContent = `${nodes.length} artistes — ${links.length} liens`;

    // centers per genre (clusters)
    const centers = computeCenters(width, height);

    // DATA JOINS
    // Links
    const linkSel = gLinks.selectAll("line")
      .data(links, d => `${d.source}__${d.target}`);

    linkSel.exit().remove();

    const linkEnter = linkSel.enter().append("line")
      .attr("stroke", "currentColor")
      .attr("opacity", 0.06);

    const linkAll = linkEnter.merge(linkSel)
      .attr("stroke-width", d => Math.min(3, 0.6 + d.common * 0.6));

    // Nodes as groups (circle + badge)
    const nodeSel = gNodes.selectAll("g.node")
      .data(nodes, d => d.id);

    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append("g")
      .attr("class", "node")
      .style("cursor", "default");

    nodeEnter.append("circle")
      .attr("class", "bubble");

    nodeEnter.append("circle")
      .attr("class", "badge")
      .attr("r", 4)
      .attr("opacity", 0); // visible only if multi

    const nodeAll = nodeEnter.merge(nodeSel);

    nodeAll.select("circle.bubble")
      .attr("r", d => d.r)
      .attr("fill", d => color(d.primaryGenre))
      .attr("fill-opacity", 0.22)
      .attr("stroke", d => color(d.primaryGenre))
      .attr("stroke-width", d => d.multi ? 1.8 : 1.2)
      .attr("stroke-opacity", d => d.multi ? 0.85 : 0.6);

    nodeAll.select("circle.badge")
      .attr("opacity", d => d.multi ? 0.85 : 0)
      .attr("fill", d => color(d.primaryGenre))
      .attr("stroke", "rgba(0,0,0,0.35)")
      .attr("stroke-width", 1);

    // Labels TOUJOURS visibles
    const labelSel = gLabels.selectAll("text")
      .data(nodes, d => d.id);

    labelSel.exit().remove();

    const labelEnter = labelSel.enter().append("text")
      .attr("text-anchor", "middle")
      .attr("fill", "currentColor")
      .style("user-select", "none")
      .style("pointer-events", "none");

    const labelAll = labelEnter.merge(labelSel)
      .text(d => d.name || "")
      .attr("font-size", d => Math.max(9, Math.min(13, d.r / 3.2)))
      .attr("opacity", 0.85);

    // Drag
    const drag = d3.drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });

    nodeAll.call(drag);

    // Hover highlight
    function highlight(d) {
      // nodes
      nodeAll.select("circle.bubble")
        .attr("fill-opacity", n => isLinked(d, n) ? 0.35 : 0.06)
        .attr("stroke-opacity", n => isLinked(d, n) ? 0.95 : 0.15);

      // links
      linkAll.attr("opacity", l => (l.source.id === d.id || l.target.id === d.id) ? 0.35 : 0.03);

      // labels
      labelAll.attr("opacity", n => isLinked(d, n) ? 0.95 : 0.25);
    }

    function resetHighlight() {
      nodeAll.select("circle.bubble")
        .attr("fill-opacity", 0.22)
        .attr("stroke-opacity", d => d.multi ? 0.85 : 0.6);

      linkAll.attr("opacity", 0.06);
      labelAll.attr("opacity", 0.85);
    }

    nodeAll
      .on("mouseenter", (event, d) => { highlight(d); showTooltip(event, d); })
      .on("mousemove", (event) => moveTooltip(event))
      .on("mouseleave", () => { resetHighlight(); hideTooltip(); });

    // --- Simulation init/update
    if (simulation) simulation.stop();

    simulation = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-18))
      .force("collision", d3.forceCollide().radius(d => d.r + 2).iterations(2))
      .force("center", d3.forceCenter(width / 2, height / 2))
      // cluster par mouvement principal
      .force("x", d3.forceX(d => centers.get(d.primaryGenre)?.x ?? (width / 2)).strength(0.12))
      .force("y", d3.forceY(d => centers.get(d.primaryGenre)?.y ?? (height / 2)).strength(0.12))
      // liens entre artistes “proches”
      .force("link", d3.forceLink(links)
        .id(d => d.id)
        .distance(l => 26 + (1 / l.common) * 18)
        .strength(l => Math.min(0.35, 0.10 + l.common * 0.07))
      );

    simulation.on("tick", () => {
      // ✅ Keep in bounds (clamp) — empêche les bulles de sortir
      nodes.forEach(d => {
        d.x = Math.max(d.r, Math.min(width - d.r, d.x));
        d.y = Math.max(d.r, Math.min(height - d.r, d.y));
      });

      // links
      linkAll
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      // node group positions
      nodeAll.attr("transform", d => `translate(${d.x},${d.y})`);

      // badge position (coin haut-droit)
      nodeAll.select("circle.badge")
        .attr("cx", d => Math.max(-d.r + 8, d.r - 8))
        .attr("cy", d => Math.max(-d.r + 8, -d.r + 8));

      // labels
      labelAll
        .attr("x", d => d.x)
        .attr("y", d => d.y + 4);
    });

    simulation.alpha(0.9).restart();

    // Apply search focus after rebuild
    const focusNode = applySearchFocus();
    if (focusNode) {
      const n = nodes.find(x => x.id === focusNode.id);
      if (n) {
        // highlight it briefly
        highlight(n);
        pinToCenterTemporarily(n);
        setTimeout(() => resetHighlight(), 1200);
      }
    }
  }

  // --- UI events
  UI.minCommon.addEventListener("input", () => {
    UI.minCommonLabel.textContent = UI.minCommon.value;
  });

  UI.minCommon.addEventListener("change", () => rebuild());

  UI.movementFilter.addEventListener("change", () => {
    legendActive = UI.movementFilter.value;
    renderLegend();
    rebuild();
  });

  UI.sizeMetric.addEventListener("change", () => rebuild());

  UI.searchName.addEventListener("input", () => {
    // pas besoin de rebuild complet : on peut juste focus si existant
    // mais comme les forces peuvent changer avec le filtre, on rebuild léger
    rebuild();
  });

  UI.resetBtn.addEventListener("click", () => {
    UI.movementFilter.value = ALL;
    UI.minCommon.value = 1;
    UI.minCommonLabel.textContent = "1";
    UI.sizeMetric.value = "paintings";
    UI.searchName.value = "";
    legendActive = ALL;
    renderLegend();
    rebuild();
  });

  // resize
  window.addEventListener("resize", () => rebuild());

  // first build
  await rebuild();
});