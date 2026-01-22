// datas/viz2.js
// Bubble network: rayon = paintings, couleur = mouvement (1er genre), liens si genres en commun

const CSV_PATH = "./datas/artists.csv";

function parseGenres(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
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

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("bubbleViz");
  if (!container) return;

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "dv-tooltip";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  // Dimensions
  const getSize = () => {
    const r = container.getBoundingClientRect();
    return { width: Math.max(320, Math.floor(r.width)), height: Math.max(420, Math.floor(r.height)) };
  };

  // SVG
  const svg = d3.select(container).append("svg");
  const gLinks = svg.append("g");
  const gNodes = svg.append("g");
  const gLabels = svg.append("g");

  // Charge CSV
  const rows = await d3.csv(CSV_PATH, d => ({
    id: d.id,
    name: d.name,
    years: d.years,
    nationality: d.nationality,
    genreRaw: d.genre,
    genres: parseGenres(d.genre),
    primaryGenre: parseGenres(d.genre)[0] || "Unknown",
    paintings: +d.paintings || 0,
    wikipedia: d.wikipedia
  }));

  // Echelles
  const maxPaintings = d3.max(rows, d => d.paintings) || 1;
  const rScale = d3.scaleSqrt()
    .domain([0, maxPaintings])
    .range([10, 60]);

  // Couleur par mouvement (primaryGenre)
  const genreList = Array.from(new Set(rows.map(d => d.primaryGenre))).sort(d3.ascending);
  const color = d3.scaleOrdinal()
    .domain(genreList)
    .range(d3.schemeTableau10.concat(d3.schemeSet3).slice(0, genreList.length));

  // Nodes
  const nodes = rows.map(d => ({
    ...d,
    r: rScale(d.paintings),
    x: 0,
    y: 0
  }));

  // Links: si au moins 1 genre commun
  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const common = intersectCount(nodes[i].genres, nodes[j].genres);
      if (common > 0) {
        links.push({
          source: nodes[i].id,
          target: nodes[j].id,
          common
        });
      }
    }
  }

  // Index adjacency pour highlight
  const adj = new Map();
  function key(a, b) { return a < b ? `${a}__${b}` : `${b}__${a}`; }
  links.forEach(l => adj.set(key(l.source, l.target), l.common));
  const isLinked = (a, b) => a === b || adj.has(key(a.id, b.id));

  // Resize helper
  function resize() {
    const { width, height } = getSize();
    svg.attr("width", width).attr("height", height);
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
    simulation.alpha(0.6).restart();
  }

  // Dessin liens (faibles, visibles surtout en hover)
  const linkSel = gLinks.selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("stroke", "currentColor")
    .attr("opacity", 0.06)
    .attr("stroke-width", d => Math.min(3, 0.6 + d.common * 0.6));

  // Dessin nodes
  const nodeSel = gNodes.selectAll("circle")
    .data(nodes)
    .enter()
    .append("circle")
    .attr("r", d => d.r)
    .attr("fill", d => color(d.primaryGenre))
    .attr("fill-opacity", 0.22)
    .attr("stroke", d => color(d.primaryGenre))
    .attr("stroke-opacity", 0.6)
    .attr("stroke-width", 1.2)
    .style("cursor", "default");

  // Labels uniquement sur gros cercles
  const labelSel = gLabels.selectAll("text")
    .data(nodes)
    .enter()
    .append("text")
    .text(d => d.name)
    .attr("text-anchor", "middle")
    .attr("font-size", d => Math.max(10, Math.min(14, d.r / 4)))
    .attr("fill", "currentColor")
    .attr("opacity", d => d.r >= 28 ? 0.85 : 0.0)
    .style("user-select", "none")
    .style("pointer-events", "none");

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

  nodeSel.call(drag);

  // Hover interactions (highlight + tooltip)
  function showTooltip(event, d) {
    const genres = d.genres.join(", ");
    tooltip.innerHTML = `
      <div style="font-weight:800; margin-bottom:6px;">${escapeHtml(d.name)}</div>
      <div><b>Œuvres:</b> ${escapeHtml(d.paintings)}</div>
      <div><b>Genres:</b> ${escapeHtml(genres || "—")}</div>
      <div><b>Nationalité:</b> ${escapeHtml(d.nationality || "—")}</div>
      <div style="margin-top:6px;">
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
    const h = tooltip.offsetHeight || 120;
    let x = event.clientX + pad;
    let y = event.clientY + pad;

    // éviter de sortir de l'écran
    if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideTooltip() {
    tooltip.style.display = "none";
  }

  function highlight(d) {
    nodeSel
      .attr("fill-opacity", n => isLinked(d, n) ? 0.35 : 0.06)
      .attr("stroke-opacity", n => isLinked(d, n) ? 0.95 : 0.15);

    linkSel
      .attr("opacity", l => (l.source.id === d.id || l.target.id === d.id) ? 0.35 : 0.03);

    labelSel
      .attr("opacity", n => (n.r >= 28 && isLinked(d, n)) ? 0.9 : (n.r >= 28 ? 0.15 : 0.0));
  }

  function resetHighlight() {
    nodeSel
      .attr("fill-opacity", 0.22)
      .attr("stroke-opacity", 0.6);

    linkSel
      .attr("opacity", 0.06);

    labelSel
      .attr("opacity", d => d.r >= 28 ? 0.85 : 0.0);
  }

  nodeSel
    .on("mouseenter", (event, d) => { highlight(d); showTooltip(event, d); })
    .on("mousemove", (event) => moveTooltip(event))
    .on("mouseleave", () => { resetHighlight(); hideTooltip(); });

  // Simulation
  const { width, height } = getSize();
  svg.attr("width", width).attr("height", height);

  const simulation = d3.forceSimulation(nodes)
    .force("charge", d3.forceManyBody().strength(-18))
    .force("collision", d3.forceCollide().radius(d => d.r + 2).iterations(2))
    .force("center", d3.forceCenter(width / 2, height / 2))
    // force de liens => rapproche les artistes qui partagent des genres
    .force("link", d3.forceLink(links)
      .id(d => d.id)
      .distance(l => 22 + (1 / l.common) * 18)
      .strength(l => Math.min(0.3, 0.10 + l.common * 0.06))
    );

  simulation.on("tick", () => {
    linkSel
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    nodeSel
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    labelSel
      .attr("x", d => d.x)
      .attr("y", d => d.y + 4);
  });

  // resize
  window.addEventListener("resize", () => resize());
});