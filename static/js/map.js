/* Map of JSW Infrastructure ports and the reporting arcs into head office. */
(function () {
  const CFG = window.PORTNET;
  const REFRESH_MS = 5 * 60 * 1000;
  const INDIA_ID = '356';               // world-atlas id; India itself comes from the states file
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

  const svg = d3.select('#map');
  const root = svg.append('g');
  const gMap = root.append('g');
  const gOver = svg.append('g');       // screen-space layer: arcs, markers, labels
  const gSeas = gOver.append('g');
  const SEAS = [
    { name: 'Arabian Sea', lng: 65.5, lat: 15.5 },
    { name: 'Bay of Bengal', lng: 87.5, lat: 15.5 },
  ];
  const gArcs = gOver.append('g');
  const gMarks = gOver.append('g');

  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);
  let india = null, world = null, network = null, transform = d3.zoomIdentity, width = 0, height = 0;
  let sparks = [], focused = null;      // port the map is zoomed to, null = overview
  const SITE_SPAN = 5;                  // degrees shown around a clicked port
  const STACK_PX = 18, STACK_GAP = 20;  // ports closer than this on screen are stacked in a column

  // The zoom behaviour only drives programmatic transitions; it is never bound
  // to the svg, so the view changes only on clicks and Reset view.
  const zoom = d3.zoom().on('zoom', (e) => {
    transform = e.transform;
    gMap.attr('transform', transform);
    drawOverlay();
  });

  // ── helpers ───────────────────────────────────────────
  const screen = (lng, lat) => transform.apply(projection([lng, lat]));

  function panelWidth() {
    return document.body.classList.contains('panel-open') && window.innerWidth > 760
      ? document.getElementById('panel').offsetWidth : 0;
  }

  function fitTransform(bounds, pad) {
    // bounds: [[minLng, minLat], [maxLng, maxLat]]
    const a = projection(bounds[0]), b = projection(bounds[1]);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const w = width - panelWidth();
    const k = Math.min((w - pad * 2) / (x1 - x0), (height - pad * 2) / (y1 - y0));
    return d3.zoomIdentity
      .translate(w / 2, height / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  }

  // All of India plus every port, with room for labels (east) and the header (north-west).
  const INDIA_BOUNDS = [[68, 6.5], [97.5, 37.2]];
  function homeView() {
    const pts = network.ports.map(p => [p.lng, p.lat]);
    const lng = d3.extent(pts, d => d[0]), lat = d3.extent(pts, d => d[1]);
    return fitTransform([
      [Math.min(lng[0] - 2, INDIA_BOUNDS[0][0]), Math.min(lat[0] - 1.5, INDIA_BOUNDS[0][1])],
      [Math.max(lng[1] + 4, INDIA_BOUNDS[1][0]), Math.max(lat[1] + 5, INDIA_BOUNDS[1][1])],
    ], 40);
  }

  // Fixed zoom on one port, centred in whatever part of the map is visible.
  function portView(s) {
    const h = SITE_SPAN / 2;
    return fitTransform([[s.lng - h, s.lat - h], [s.lng + h, s.lat + h]], 40);
  }
  const currentView = () => (focused ? portView(focused) : homeView());

  // Back to the overview: everything visible, beside the panel if it is open.
  function reset(ms) { focused = null; go(homeView(), ms); }

  function go(t, ms) {
    svg.transition().duration(reduceMotion ? 0 : ms).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }

  // Each port is its own marker. Ports that land within STACK_PX of each other on
  // screen are stacked in a short column, so every one stays visible and clickable.
  function layout() {
    const groups = [];
    network.ports.forEach(p => {
      const [x, y] = screen(p.lng, p.lat);
      const g = groups.find(g => Math.hypot(g.x - x, g.y - y) < STACK_PX);
      if (g) g.ports.push(p); else groups.push({ x, y, ports: [p] });
    });
    return groups.flatMap(g => g.ports.map((p, i) => ({
      p, stacked: g.ports.length > 1,
      x: g.x, y: g.y + (i - (g.ports.length - 1) / 2) * STACK_GAP,
    })));
  }

  // ── base map ──────────────────────────────────────────
  function drawBase() {
    const states = topojson.feature(india, india.objects.states);
    projection.fitExtent([[30, 30], [width - 30, height - 30]], states);
    gMap.selectAll('*').remove();

    gMap.append('path')
      .attr('class', 'graticule')
      .attr('d', path(d3.geoGraticule().step([2, 2]).extent([[30, -20], [130, 60]])()));

    const countries = topojson.feature(world, world.objects.countries).features.filter(f => f.id !== INDIA_ID);
    gMap.append('g').selectAll('path')
      .data(countries)
      .join('path')
      .attr('class', 'land foreign')
      .attr('d', path);

    const homeStates = new Set(network.ports.map(p => p.state).filter(Boolean));
    gMap.append('g').selectAll('path')
      .data(states.features)
      .join('path')
      .attr('class', d => 'land' + (homeStates.has(d.properties.name) ? ' home' : ''))
      .attr('d', path);

    gMap.append('path')
      .attr('class', 'state-borders')
      .attr('d', path(topojson.mesh(india, india.objects.states, (a, b) => a !== b)));
    gMap.append('path')
      .attr('class', 'coastline')
      .attr('d', path(topojson.mesh(india, india.objects.states, (a, b) => a === b)));
  }

  // ── arcs, markers ─────────────────────────────────────
  function arcGeometry(p0, p1, bend) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const d = Math.hypot(dx, dy) || 1;
    let nx = -dy / d, ny = dx / d;
    // Bow toward the north-west: out over the sea for west-coast ports,
    // upward for everything else.
    if (-ny - 0.8 * nx < 0) { nx = -nx; ny = -ny; }
    const h = d * bend;
    const c = [(p0[0] + p1[0]) / 2 + nx * h, (p0[1] + p1[1]) / 2 + ny * h];
    return { c, d: `M${p0[0]},${p0[1]} Q${c[0]},${c[1]} ${p1[0]},${p1[1]}` };
  }

  function drawOverlay() {
    if (!network) return;
    const ho = screen(network.head_office.lng, network.head_office.lat);

    gSeas.selectAll('text').data(SEAS).join('text')
      .attr('class', 'sea-label')
      .attr('text-anchor', 'middle')
      .attr('transform', d => `translate(${screen(d.lng, d.lat)})`)
      .text(d => d.name);

    const nodes = layout();
    const isDev = p => p.status !== 'Operational';

    // Arcs: one per port, carrying the flow unless the port is still being built.
    sparks = [];
    const arcs = [];
    nodes.forEach(n => {
      const g = arcGeometry([n.x, n.y], ho, 0.42);
      arcs.push({ key: n.p.code, d: g.d, cls: 'main' + (isDev(n.p) ? ' dev' : '') });
      if (!isDev(n.p)) {
        arcs.push({ key: n.p.code + 'flow', d: g.d, cls: 'flow' });
        sparks.push({ key: n.p.code, p0: [n.x, n.y], c: g.c, p1: ho });
      }
    });
    gArcs.selectAll('path.arc').data(arcs, d => d.key)
      .join('path')
      .attr('class', d => 'arc ' + d.cls)
      .attr('d', d => d.d);
    gArcs.selectAll('circle.arc-spark').data(reduceMotion ? [] : sparks, d => d.key)
      .join('circle').attr('class', 'arc-spark').attr('r', 2.6);

    // Head office.
    const hoG = gMarks.selectAll('g.ho-mark').data([network.head_office]).join(enter => {
      const g = enter.append('g').attr('class', 'ho-mark');
      g.append('rect').attr('class', 'halo').attr('x', -9).attr('y', -9).attr('width', 18).attr('height', 18).attr('transform', 'rotate(45)');
      g.append('rect').attr('x', -4.5).attr('y', -4.5).attr('width', 9).attr('height', 9).attr('transform', 'rotate(45)');
      g.append('text').attr('class', 'name').attr('x', -16).attr('y', -2).attr('text-anchor', 'end');
      g.append('text').attr('class', 'sub').attr('x', -16).attr('y', 14).attr('text-anchor', 'end');
      return g;
    });
    hoG.attr('transform', `translate(${ho})`);
    hoG.select('.name').text(d => d.city);
    hoG.select('.sub').text(d => d.name);

    // Ports.
    const current = window.PortPanel.current();
    const pm = gMarks.selectAll('g.port-mark').data(nodes, d => d.p.code).join(enter => {
      const g = enter.append('g')
        .attr('class', 'port-mark')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', d => `${d.p.name}, open summary`)
        .on('click', (e, d) => openPort(d.p.code))
        .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPort(d.p.code); } });
      g.append('circle').attr('class', 'hit').attr('r', 12);
      g.append('circle').attr('class', 'ring').attr('r', 7);
      g.append('circle').attr('class', 'core').attr('r', 7);
      g.append('text').attr('class', 'name').attr('x', 14).attr('y', 5);
      g.append('text').attr('class', 'sub').attr('x', 14).attr('y', 20);
      g.append('title');               // name on hover, for labels hidden by placeLabels
      return g;
    });
    pm.attr('transform', d => `translate(${d.x},${d.y})`)
      .classed('live', d => !!(d.p.pulse && d.p.pulse.ok))
      .classed('dev', d => isDev(d.p))
      .classed('active', d => d.p.code === current);
    pm.select('.name').text(d => d.p.name);
    pm.select('title').text(d => d.p.name);
    pm.select('.sub').text(d => {
      if (d.stacked) return '';        // no room between stacked rows
      if (d.p.pulse && d.p.pulse.ok) return `${fmt.format(d.p.pulse.today)} MT today`;
      return isDev(d.p) ? 'Under development' : '';
    });
    placeLabels(pm, nodes, ho);
  }

  // Greedy label placement: right of the marker, else left, else without the
  // sub-line, else hidden (the name still shows on hover). Most important first.
  function placeLabels(pm, nodes, ho) {
    const edge = width - panelWidth() - 8;
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const taken = nodes.map(n => [n.x - 8, n.y - 8, n.x + 8, n.y + 8]);   // every marker
    const hoW = d3.max(gMarks.selectAll('g.ho-mark text').nodes(), t => t.getComputedTextLength()) || 0;
    taken.push([ho[0] - 18 - hoW, ho[1] - 14, ho[0] + 8, ho[1] + 18]);    // head office + its label
    const rank = d => (d.p.code === window.PortPanel.current() ? 0 : d.p.pulse && d.p.pulse.ok ? 1 : d.p.status === 'Operational' ? 2 : 3);
    // Sort a copy, not the DOM, so keyboard tab order stays as listed in config.
    pm.nodes().sort((a, b) => rank(a.__data__) - rank(b.__data__)).forEach(el => {
      const d = el.__data__, g = d3.select(el), name = g.select('.name'), sub = g.select('.sub');
      const hasSub = !!sub.text() && getComputedStyle(sub.node()).display !== 'none';
      const w = Math.max(name.node().getComputedTextLength(), hasSub ? sub.node().getComputedTextLength() : 0);
      const tries = [];
      [hasSub, false].forEach(withSub => [1, -1].forEach(side => {
        const x0 = side > 0 ? d.x + 12 : d.x - 12 - w;
        tries.push({ side, withSub, box: [x0, d.y - 8, x0 + w, d.y + (withSub ? 24 : 9)] });
      }));
      const ok = tries.find(t => t.box[0] > 4 && t.box[2] < edge && !taken.some(b => hit(t.box, b)));
      if (ok) taken.push(ok.box);
      g.selectAll('text').attr('x', ok && ok.side < 0 ? -14 : 14).attr('text-anchor', ok && ok.side < 0 ? 'end' : 'start');
      name.attr('visibility', ok ? null : 'hidden');
      sub.attr('visibility', ok && ok.withSub ? null : 'hidden');
    });
  }

  // Moving spark along each main arc.
  function animate(t) {
    const phase = (t % 2600) / 2600;
    gArcs.selectAll('circle.arc-spark').each(function (s) {
      const u = phase, v = 1 - u;
      const x = v * v * s.p0[0] + 2 * v * u * s.c[0] + u * u * s.p1[0];
      const y = v * v * s.p0[1] + 2 * v * u * s.c[1] + u * u * s.p1[1];
      this.setAttribute('cx', x);
      this.setAttribute('cy', y);
      this.setAttribute('opacity', Math.sin(Math.PI * u).toFixed(2));
    });
    requestAnimationFrame(animate);
  }

  // ── panel link ────────────────────────────────────────
  function openPort(code) {
    const p = network.ports.find(x => x.code === code);
    if (!p) return;
    window.PortPanel.open(p);
    drawOverlay();
    focused = p;
    go(portView(p), 900);              // zoom in and slide the port into the left half
  }
  window.PortPanel.onClose = () => { drawOverlay(); go(currentView(), 700); };   // stays zoomed until Reset view

  // ── header text + clock ───────────────────────────────
  function updateBrand() {
    const n = network.ports.length;
    const abroad = network.ports.filter(p => p.overseas).length;
    document.getElementById('brand-sub').textContent =
      `${n} locations${abroad ? `, ${abroad} overseas` : ''}`;
  }

  function tick() {
    const now = new Date();
    const hh = now.getHours();
    const shift = hh >= 6 && hh < 14 ? 'A' : hh >= 14 && hh < 22 ? 'B' : 'C';
    const op = new Date(now); if (hh < 6) op.setDate(op.getDate() - 1);
    document.getElementById('clock-time').textContent =
      now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    document.getElementById('clock-meta').textContent =
      `Op-day ${op.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, shift ${shift}`;
  }

  // Shade the home state of each port (worked out from its coordinates).
  function tagStates() {
    const states = topojson.feature(india, india.objects.states).features;
    network.ports.forEach(p => {
      const s = p.overseas ? null : states.find(f => d3.geoContains(f, [p.lng, p.lat]));
      p.state = s ? s.properties.name : null;
    });
  }

  // ── lifecycle ─────────────────────────────────────────
  function resize() {
    const r = svg.node().getBoundingClientRect();
    width = r.width; height = r.height;
    if (!india || !network) return;
    drawBase();
    zoom.extent([[0, 0], [width, height]]);
    svg.interrupt().call(zoom.transform, currentView());
  }

  async function loadNetwork() {
    const res = await fetch(CFG.network);
    if (!res.ok) throw new Error(`Network data returned ${res.status}`);
    return res.json();
  }

  const loadJson = (url, what) => fetch(url).then(r => { if (!r.ok) throw new Error(`${what} could not load`); return r.json(); });

  async function refresh() {
    try {
      network = await loadNetwork();
      tagStates();
      updateBrand();
      drawOverlay();
    } catch (e) { console.warn('refresh failed', e); }
  }

  async function init() {
    tick(); setInterval(tick, 15000);
    try {
      [india, world, network] = await Promise.all([
        loadJson(CFG.topo, 'Map outline'),
        loadJson(CFG.world, 'World outline'),
        loadNetwork(),
      ]);
    } catch (e) {
      const el = document.getElementById('map-error');
      el.hidden = false;
      el.textContent = `${e.message}. Check that the server is running and the database is reachable, then reload.`;
      return;
    }
    tagStates();
    resize();
    updateBrand();
    if (!reduceMotion) requestAnimationFrame(animate);
    window.addEventListener('resize', resize);
    document.getElementById('btn-reset').onclick = () => reset(900);

    const wanted = new URLSearchParams(location.search).get('port');
    if (wanted) openPort(wanted.toUpperCase());

    setInterval(refresh, REFRESH_MS);
  }

  init();
})();
