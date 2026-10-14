/* Fixed map of JSW Infrastructure sites and the reporting arcs into head office. */
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
  let india = null, world = null, network = null, sites = [], transform = d3.zoomIdentity, width = 0, height = 0;
  let sparks = [];

  // The zoom behaviour only drives programmatic transitions; it is never bound
  // to the svg, so users cannot pan or zoom.
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

  // Every site plus head office, with room for labels (east) and the header (north).
  function homeView() {
    const pts = network.ports.map(p => [p.lng, p.lat]).concat([[network.head_office.lng, network.head_office.lat]]);
    const lng = d3.extent(pts, d => d[0]), lat = d3.extent(pts, d => d[1]);
    return fitTransform([[lng[0] - 2, lat[0] - 1.5], [lng[1] + 4, lat[1] + 5]], 60);  // extra north: header
  }

  function go(t, ms) {
    svg.transition().duration(reduceMotion ? 0 : ms).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }

  // Terminals sharing a site become one marker, placed at the first one listed.
  function buildSites() {
    sites = d3.groups(network.ports, p => p.site).map(([name, ports]) => {
      const live = ports.filter(p => p.pulse && p.pulse.ok);
      return {
        name, ports,
        lng: ports[0].lng, lat: ports[0].lat,
        label: ports.length === 1 ? ports[0].name : name,
        dev: ports.every(p => p.status !== 'Operational'),
        live: live.length > 0,
        today: d3.sum(live, p => p.pulse.today),
      };
    });
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

    // Arcs: three strands per site, the middle one carries the flow.
    sparks = [];
    const arcs = [];
    sites.forEach(s => {
      const p0 = screen(s.lng, s.lat);
      [0.28, 0.42, 0.58].forEach((bend, i) => {
        const g = arcGeometry(p0, ho, bend);
        arcs.push({ key: s.name + i, d: g.d, cls: (i === 1 ? 'main' : 'strand') + (s.dev ? ' dev' : '') });
        if (i === 1 && !s.dev) {
          arcs.push({ key: s.name + 'flow', d: g.d, cls: 'flow' });
          sparks.push({ key: s.name, p0, c: g.c, p1: ho });
        }
      });
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

    // Sites.
    const current = window.PortPanel.current();
    const pm = gMarks.selectAll('g.port-mark').data(sites, d => d.name).join(enter => {
      const g = enter.append('g')
        .attr('class', 'port-mark')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', d => `${d.label}, open summary`)
        .on('click', (e, d) => openSite(d))
        .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSite(d); } });
      g.append('circle').attr('class', 'hit').attr('r', 18);
      g.append('circle').attr('class', 'ring').attr('r', 7);
      g.append('circle').attr('class', 'core').attr('r', 7);
      g.append('text').attr('class', 'name').attr('x', 14).attr('y', -1);
      g.append('text').attr('class', 'sub').attr('x', 14).attr('y', 14);
      return g;
    });
    pm.attr('transform', d => `translate(${screen(d.lng, d.lat)})`)
      .classed('live', d => d.live)
      .classed('dev', d => d.dev)
      .classed('active', d => d.ports.some(p => p.code === current));
    pm.select('.name').text(d => d.label);
    pm.select('.sub').text(d => {
      if (d.live) return `${fmt.format(d.today)} MT today`;
      if (d.ports.length > 1) return `${d.ports.length} terminals`;
      return d.dev ? 'Under development' : '';
    });
    // Flip labels to the left when they would run under the panel or off screen.
    const edge = width - panelWidth() - 12;
    pm.each(function (d) {
      const x = screen(d.lng, d.lat)[0];
      const w = d3.max(d3.select(this).selectAll('text').nodes(), n => n.getComputedTextLength()) || 0;
      const left = x + 14 + w > edge;
      d3.select(this).selectAll('text').attr('x', left ? -14 : 14).attr('text-anchor', left ? 'end' : 'start');
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
  function openSite(s, code) {
    const p = s.ports.find(x => x.code === code) || s.ports.find(x => x.connected) || s.ports[0];
    window.PortPanel.open(p, s.ports);
    drawOverlay();
    go(homeView(), 700);               // slide the map into the left half
  }
  function openPort(code) {
    const s = sites.find(x => x.ports.some(p => p.code === code));
    if (s) openSite(s, code);
  }
  window.PortPanel.onSwitch = () => drawOverlay();
  window.PortPanel.onClose = () => { drawOverlay(); go(homeView(), 700); };

  // ── header text + clock ───────────────────────────────
  function updateBrand() {
    const n = network.ports.length;
    const abroad = network.ports.filter(p => p.overseas).length;
    document.getElementById('brand-sub').textContent =
      `${n} locations${abroad ? `, ${abroad} overseas` : ''}, reporting to ${network.head_office.city}`;
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
    svg.interrupt().call(zoom.transform, homeView());
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
      buildSites();
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
    buildSites();
    resize();
    updateBrand();
    if (!reduceMotion) requestAnimationFrame(animate);
    window.addEventListener('resize', resize);

    const wanted = new URLSearchParams(location.search).get('port');
    if (wanted) openPort(wanted.toUpperCase());

    setInterval(refresh, REFRESH_MS);
  }

  init();
})();
