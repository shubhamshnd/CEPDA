/* India map, ports, and the reporting arcs into the head office. */
(function () {
  const CFG = window.PORTNET;
  const REFRESH_MS = 5 * 60 * 1000;
  const REGION_MIN_SPAN = 2.0;          // degrees; keeps "Zoom to ports" from zooming in too far
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

  const svg = d3.select('#map');
  const root = svg.append('g');
  const gMap = root.append('g');
  const gOver = svg.append('g');       // screen-space layer: arcs, markers, labels
  const gSeas = gOver.append('g');
  const gPlaces = gOver.append('g');
  const SEAS = [
    { name: 'Arabian Sea', lng: 66.5, lat: 15.5 },
    { name: 'Bay of Bengal', lng: 87.5, lat: 15.5 },
  ];
  const gArcs = gOver.append('g');
  const gMarks = gOver.append('g');

  const projection = d3.geoMercator();
  const path = d3.geoPath(projection);
  let india = null, network = null, transform = d3.zoomIdentity, width = 0, height = 0;
  let sparks = [];

  const zoom = d3.zoom()
    .scaleExtent([0.8, 600])
    .on('zoom', (e) => {
      transform = e.transform;
      gMap.attr('transform', transform);
      drawOverlay();
    });
  svg.call(zoom).on('dblclick.zoom', null);

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

  function regionBounds() {
    const pts = network.ports.map(p => [p.lng, p.lat]).concat([[network.head_office.lng, network.head_office.lat]]);
    let [lo0, la0, lo1, la1] = [180, 90, -180, -90];
    pts.forEach(([lo, la]) => { lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); la0 = Math.min(la0, la); la1 = Math.max(la1, la); });
    const cx = (lo0 + lo1) / 2, cy = (la0 + la1) / 2;
    const half = Math.max(lo1 - lo0, la1 - la0, REGION_MIN_SPAN) / 2;
    return [[cx - half, cy - half], [cx + half, cy + half]];
  }

  function indiaView() { return fitTransform([[68, 6.5], [97.5, 37.2]], 40); }
  function portsView() { return fitTransform(regionBounds(), 60); }

  function go(t, ms) {
    svg.transition().duration(reduceMotion ? 0 : ms).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }

  // ── base map ──────────────────────────────────────────
  function drawBase() {
    const states = topojson.feature(india, india.objects.states);
    projection.fitExtent([[30, 30], [width - 30, height - 30]], states);
    gMap.selectAll('*').remove();

    gMap.append('path')
      .attr('class', 'graticule')
      .attr('d', path(d3.geoGraticule().step([2, 2]).extent([[30, -20], [130, 60]])()));

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
    const k = transform.k;

    gSeas.selectAll('text').data(SEAS).join('text')
      .attr('class', 'sea-label')
      .attr('text-anchor', 'middle')
      .attr('transform', d => `translate(${screen(d.lng, d.lat)})`)
      .text(d => d.name);

    // Reference towns, only once zoomed into a region.
    const places = k > 5 ? network.places : [];
    const pl = gPlaces.selectAll('g.place').data(places, d => d.name);
    pl.exit().remove();
    const plIn = pl.enter().append('g').attr('class', 'place');
    plIn.append('circle').attr('r', 2);
    plIn.append('text').attr('x', 6).attr('y', 4).text(d => d.name);
    plIn.merge(pl).attr('transform', d => `translate(${screen(d.lng, d.lat)})`);

    // Arcs: three strands per port, the middle one carries the flow.
    sparks = [];
    const arcs = [];
    network.ports.forEach(p => {
      const p0 = screen(p.lng, p.lat);
      [0.28, 0.42, 0.58].forEach((bend, i) => {
        const g = arcGeometry(p0, ho, bend);
        arcs.push({ key: p.code + i, d: g.d, cls: i === 1 ? 'main' : 'strand' });
        if (i === 1) {
          arcs.push({ key: p.code + 'flow', d: g.d, cls: 'flow' });
          sparks.push({ code: p.code, p0, c: g.c, p1: ho });
        }
      });
    });
    gArcs.selectAll('path.arc').data(arcs, d => d.key)
      .join('path')
      .attr('class', d => 'arc ' + d.cls)
      .attr('d', d => d.d);
    gArcs.selectAll('circle.arc-spark').data(reduceMotion ? [] : sparks, d => d.code)
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
    const pm = gMarks.selectAll('g.port-mark').data(network.ports, d => d.code).join(enter => {
      const g = enter.append('g')
        .attr('class', 'port-mark')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', d => `${d.name}, open summary`)
        .on('click', (e, d) => openPort(d.code))
        .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPort(d.code); } });
      g.append('circle').attr('class', 'hit').attr('r', 18);
      g.append('circle').attr('class', 'ring').attr('r', 7);
      g.append('circle').attr('class', 'core').attr('r', 7);
      g.append('text').attr('class', 'name').attr('x', 16).attr('y', -1);
      g.append('text').attr('class', 'sub').attr('x', 16).attr('y', 15);
      return g;
    });
    pm.attr('transform', d => `translate(${screen(d.lng, d.lat)})`)
      .classed('offline', d => !d.pulse || !d.pulse.ok)
      .classed('active', d => window.PortPanel.current() === d.code);
    pm.select('.name').text(d => d.name);
    pm.select('.sub').text(d => {
      if (!d.pulse || !d.pulse.ok) return 'No data from this location';
      return `${fmt.format(d.pulse.today)} MT today`;
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
    gMarks.selectAll('g.port-mark').classed('active', d => d.code === code);
    // Keep the port clear of the panel on wide screens.
    requestAnimationFrame(() => {
      const pw = panelWidth();
      const [x] = screen(p.lng, p.lat);
      if (pw && x > width - pw - 80) {
        const dx = (width - pw) / 2 - x;
        go(d3.zoomIdentity.translate(transform.x + dx, transform.y).scale(transform.k), 600);
      }
    });
  }
  window.PortPanel.onClose = () => gMarks.selectAll('g.port-mark').classed('active', false);

  // ── header text + clock ───────────────────────────────
  function updateBrand() {
    const n = network.ports.length;
    const live = network.ports.filter(p => p.pulse && p.pulse.ok).length;
    const txt = `${n} ${n === 1 ? 'location' : 'locations'} reporting to ${network.head_office.city}`;
    document.getElementById('brand-sub').textContent = live === n ? txt : `${txt}, ${n - live} without data`;
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
      const s = states.find(f => d3.geoContains(f, [p.lng, p.lat]));
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
    drawOverlay();
  }

  async function loadNetwork() {
    const res = await fetch(CFG.network);
    if (!res.ok) throw new Error(`Network data returned ${res.status}`);
    return res.json();
  }

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
      [india, network] = await Promise.all([
        fetch(CFG.topo).then(r => { if (!r.ok) throw new Error('Map outline could not load'); return r.json(); }),
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
    svg.call(zoom.transform, indiaView());
    setTimeout(() => go(portsView(), 2200), reduceMotion ? 0 : 600);
    if (!reduceMotion) requestAnimationFrame(animate);

    document.getElementById('btn-india').onclick = () => go(indiaView(), 1400);
    document.getElementById('btn-ports').onclick = () => go(portsView(), 1400);
    window.addEventListener('resize', () => { resize(); });

    const wanted = new URLSearchParams(location.search).get('port');
    if (wanted) setTimeout(() => openPort(wanted.toUpperCase()), reduceMotion ? 0 : 2400);

    setInterval(refresh, REFRESH_MS);
  }

  init();
})();
