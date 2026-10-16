/* Sidebar: company figures, then every location grouped. A group highlights its
   locations on the map; hovering a location pulses its marker; clicking opens it. */
window.SidePanel = (function () {
  const el = document.getElementById('side-body');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Partition, in this order: each location lands in the first group it matches.
  const GROUPS = [
    ['dev', 'Under development', p => p.status !== 'Operational'],
    ['overseas', 'Overseas', p => p.overseas],
    ['ports', 'Ports', p => p.kind === 'port'],
    ['terminals', 'Terminals', () => true],
  ];
  const ORDER = ['ports', 'terminals', 'overseas', 'dev'];   // display order
  let open = null;                      // expanded (and highlighted) group
  let members = {};                     // group key -> port codes

  const chevron = '<svg class="grp-chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function render(network) {
    const c = network.company;
    const byGroup = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
    network.ports.forEach(p => byGroup[GROUPS.find(([, , test]) => test(p))[0]].push(p));
    members = Object.fromEntries(Object.entries(byGroup).map(([k, ps]) => [k, ps.map(p => p.code)]));
    const label = Object.fromEntries(GROUPS.map(([k, l]) => [k, l]));

    el.innerHTML = `
      <div class="kpis">${c.kpis.map(k => `<div class="kpi"><b>${esc(k.value)}<small>${esc(k.unit)}</small></b><span>${esc(k.label)}</span></div>`).join('')}</div>

      <h2 class="side-h">Locations <span>${network.ports.length}</span></h2>
      <div class="groups">${ORDER.map(k => {
        const ps = byGroup[k];
        if (!ps.length) return '';
        return `<section class="grp${open === k ? ' open' : ''}" data-group="${k}">
          <button type="button" class="grp-head" aria-expanded="${open === k}">
            <span class="grp-name">${esc(label[k])}</span><span class="grp-n">${ps.length}</span>${chevron}
          </button>
          <div class="grp-body"><ul>${ps.map(p => `<li><button type="button" class="loc" data-code="${esc(p.code)}">
            <span class="loc-dot${p.status !== 'Operational' ? ' dev' : ''}${p.pulse && p.pulse.ok ? ' live' : ''}"></span>
            <span class="loc-name">${esc(p.name)}</span>
            <span class="loc-region">${esc(p.region)}</span></button></li>`).join('')}</ul></div>
        </section>`;
      }).join('')}</div>


      <p class="side-src">${esc(c.footprint)}. Figures for ${esc(c.period)} from
        <a href="${esc(c.source)}" target="_blank" rel="noopener">jswinfrastructure.in</a>.</p>`;
  }

  function setOpen(key) {
    open = key;
    el.querySelectorAll('.grp').forEach(g => {
      const on = g.dataset.group === key;
      g.classList.toggle('open', on);
      g.querySelector('.grp-head').setAttribute('aria-expanded', on);
    });
    window.PortMap.highlight(key ? members[key] : null);
  }

  el.addEventListener('click', e => {
    const head = e.target.closest('.grp-head');
    if (head) { const k = head.parentElement.dataset.group; setOpen(open === k ? null : k); return; }
    const loc = e.target.closest('.loc');
    if (loc) window.PortMap.open(loc.dataset.code);
  });
  const hover = e => { const loc = e.target.closest('.loc'); window.PortMap.hover(loc ? loc.dataset.code : null); };
  el.addEventListener('pointerover', hover);
  el.addEventListener('pointerleave', () => window.PortMap.hover(null));
  el.addEventListener('focusin', hover);
  el.addEventListener('focusout', () => window.PortMap.hover(null));

  // Support card (bottom-right <details>): close on a click anywhere else.
  const support = document.getElementById('support');
  document.addEventListener('click', e => { if (support.open && !support.contains(e.target)) support.open = false; });

  // ── footer switches: reporting lines, light theme (remembered in this browser) ──
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window: just not remembered */ } },
  };
  const swLines = document.getElementById('sw-lines'), swTheme = document.getElementById('sw-theme');
  function setLines(on) {
    swLines.setAttribute('aria-checked', String(on));
    document.body.classList.toggle('no-lines', !on);
    store.set('lines', on ? '1' : '0');
    if (window.PortMap) window.PortMap.redraw();
  }
  function applyTheme(light) {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    swTheme.setAttribute('aria-checked', String(light));
    store.set('theme', light ? 'light' : 'dark');
  }
  // The new theme spreads out from the switch as a growing circle (View Transitions).
  // Browsers without them, and reduced-motion viewers, just switch.
  function setTheme(light, from) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!from || still || !document.startViewTransition) { applyTheme(light); return; }
    const r = from.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(() => applyTheme(light)).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.2, .7, .2, 1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => {});
  }
  swLines.addEventListener('click', () => setLines(swLines.getAttribute('aria-checked') !== 'true'));
  swTheme.addEventListener('click', () => setTheme(swTheme.getAttribute('aria-checked') !== 'true', swTheme));
  setLines(store.get('lines') !== '0');
  setTheme(document.documentElement.dataset.theme === 'light');

  return { render };
})();
