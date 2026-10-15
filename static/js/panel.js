/* Port summary panel: opens on marker click, refreshes while open. */
window.PortPanel = (function () {
  const CFG = window.PORTNET;
  const REFRESH_MS = 2 * 60 * 1000;
  const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

  const CARGO_COLORS = {
    'IBRM': '#C97B5A',          // iron ore, rust
    'CBRM': '#8E9AA6',          // coal, graphite
    'FLUXES': '#D9D2B8',        // limestone, dolomite
    'CLINKER': '#7FA88A',
    'SLAG': '#A98CC9',
    'FINISH GOODS': '#6CC4F2',
    'OTHERS': '#5A6C7A',
  };
  const TYPE_NAMES = {
    'IBRM': 'Iron-bearing raw material', 'CBRM': 'Carbon-bearing raw material',
    'FLUXES': 'Fluxes', 'CLINKER': 'Clinker', 'SLAG': 'Slag',
    'FINISH GOODS': 'Finished goods', 'OTHERS': 'Others',
  };

  // MBC voyage stages, in the order a round trip runs.
  const MBC_STAGES = [
    ['UNDER LOADING', 'Under loading'],
    ['LOADED : WAITING AT LOAD PORT', 'Loaded, waiting at load port'],
    ['LOADED : ON THE WAY TO GULL', 'Loaded, heading to Gull Island'],
    ['LOADED : WAITING AT GULL', 'Loaded, waiting at Gull Island'],
    ['LOADED : ON THE WAY TO DHARAMTAR', 'Loaded, heading to Dharamtar'],
    ['LOADED : WAITING AT DHARAMTAR', 'Loaded, waiting at Dharamtar'],
    ['UNDER DISCHARGE AT DHARAMTAR', 'Discharging at Dharamtar'],
    ['EMPTY : ON THE WAY TO JAIGAD', 'Empty, heading to Jaigad'],
    ['EMPTY : WAITING AT JAIGAD', 'Empty, waiting at Jaigad'],
    ['EMPTY : WAITING AT DHARAMTAR', 'Empty, waiting at Dharamtar'],
    ['EMPTY : WAITING AT LOAD PORT', 'Empty, waiting at load port'],
  ];
  const stageIndex = st => { const i = MBC_STAGES.findIndex(([k]) => k === String(st).toUpperCase()); return i < 0 ? 99 : i; };
  const stageLabel = st => { const m = MBC_STAGES.find(([k]) => k === String(st).toUpperCase()); return m ? m[1] : cap(st).replace(/ : /g, ', '); };

  const el = {
    panel: document.getElementById('panel'),
    hero: document.getElementById('panel-hero'),
    img: document.getElementById('panel-img'),
    title: document.getElementById('panel-title'),
    region: document.getElementById('panel-region'),
    meta: document.getElementById('panel-meta'),
    body: document.getElementById('panel-body'),
    close: document.getElementById('panel-close'),
  };

  let code = null, timer = null, data = null, mixPeriod = 'month', lastFocus = null;
  const api = { onClose: null, current: () => code, open, close };

  // ── utils ─────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mt = n => (n == null ? '–' : fmt.format(n));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const cap = s => String(s || '').toLowerCase().replace(/^\w/, c => c.toUpperCase());

  function parseLocal(s) {
    if (!s) return null;
    const d = new Date(String(s).trim().replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  function hm(d) { return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function dayTag(d, ref) {
    const a = new Date(d); a.setHours(0, 0, 0, 0);
    const b = new Date(ref); b.setHours(0, 0, 0, 0);
    const diff = Math.round((a - b) / 864e5);
    if (diff === 0) return '';
    if (Math.abs(diff) < 7) return ' ' + d.toLocaleDateString('en-IN', { weekday: 'short' });
    return ' ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function ago(d) {
    const m = Math.max(0, Math.round((Date.now() - d) / 6e4));
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} d ago`;
  }
  function mins(m) { const h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; }

  // ── sections ──────────────────────────────────────────
  function secToday(t, shift) {
    const s = t.today.by_shift;
    const max = Math.max(1, ...Object.values(s), ...Object.values(t.yesterday.by_shift));
    const bars = ['A', 'B', 'C'].map(k => {
      const h = Math.round((s[k] / max) * 100);
      const now = k === shift;
      return `<div class="shift${now ? ' now' : ''}">
        <div class="bar"><i style="height:${h}%"></i></div>
        Shift ${k}${now ? ', running' : ''}<b>${mt(s[k])}</b></div>`;
    }).join('');
    const need = t.today.needed;
    let line = `Yesterday: <strong>${mt(t.yesterday.total)} MT</strong>.`;
    if (need != null) {
      line += need > 0
        ? ` Needed today to stay on the month target: <strong>${mt(need)} MT</strong>.`
        : ` The month target is already met.`;
    }
    return `<section class="sec">
      <h3>Discharged today <small>op-day from 06:00</small></h3>
      <div><span class="fig fig-xl">${mt(t.today.total)}</span><span class="unit">MT</span></div>
      <div class="shifts">${bars}</div>
      <p class="note">${line}</p>
    </section>`;
  }

  function progressBlock(title, sub, total, target, elapsedShare, footer) {
    if (!target) {
      return `<section class="sec"><h3>${title} <small>${sub}</small></h3>
        <div><span class="fig fig-l">${mt(total)}</span><span class="unit">MT</span></div>
        <p class="note muted">No target has been set for this period.</p></section>`;
    }
    const p = pct(total, target);
    const behind = total < target * elapsedShare;
    return `<section class="sec">
      <h3>${title} <small>${sub}</small></h3>
      <div class="progress">
        <div><span class="fig fig-l">${mt(total)}</span><span class="unit">of ${mt(target)} MT</span></div>
        <span class="pct ${behind ? 'short' : 'good'}">${p}%</span>
      </div>
      <div class="meter" role="img" aria-label="${p}% of target, ${behind ? 'behind' : 'on or ahead of'} pace">
        <i class="${behind ? 'behind' : ''}" style="width:${Math.min(p, 100)}%"></i>
        <span class="pace" style="left:${(elapsedShare * 100).toFixed(1)}%" title="Where the total should be today"></span>
      </div>
      <p class="note">${footer}</p>
    </section>`;
  }

  function secMonth(t, opDate) {
    const m = t.month;
    const d = new Date(opDate + 'T00:00');
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const share = (dim - m.days_left) / dim;
    let foot = '';
    if (m.avg_per_day != null) foot += `Averaging <strong>${mt(m.avg_per_day)} MT</strong> a day so far. `;
    if (m.needed_per_day != null) {
      foot += m.needed_per_day > 0
        ? (m.days_left === 1
          ? `Needs <strong>${mt(m.needed_per_day)} MT</strong> today to reach the target.`
          : `Needs <strong>${mt(m.needed_per_day)} MT</strong> a day for the remaining ${m.days_left} days.`)
        : 'Target met.';
    }
    return progressBlock('This month', t.month_label, m.total, m.target, share, foot);
  }

  function secFY(t) {
    const f = t.fy;
    const start = Number(t.fy_label.split('-')[0]);
    const daysInFY = (new Date(start + 1, 2, 31) - new Date(start, 3, 1)) / 864e5 + 1;
    const share = (daysInFY - f.days_left) / daysInFY;
    const foot = f.needed_per_day == null ? '' : f.needed_per_day > 0
      ? `Needs <strong>${mt(f.needed_per_day)} MT</strong> a day for the remaining ${f.days_left} days.`
      : 'Financial-year target met.';
    return progressBlock('Financial year', `FY ${t.fy_label}`, f.total, f.target, share, foot)
      .replace('</section>', `<p class="note">All-time discharged at this port: <strong>${mt(t.cumulative)} MT</strong>.</p></section>`);
  }

  function secMix(t) {
    const src = { today: t.today.by_type, month: t.month.by_type, fy: t.fy.by_type }[mixPeriod] || {};
    const entries = Object.entries(src);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    const tab = (k, label) => `<button type="button" data-mix="${k}" aria-pressed="${mixPeriod === k}">${label}</button>`;
    const body = entries.length ? `
      <div class="stack" aria-hidden="true">${entries.map(([k, v]) =>
        `<i style="flex:${v};background:${CARGO_COLORS[k] || CARGO_COLORS.OTHERS}"></i>`).join('')}</div>
      <ul class="mix">${entries.map(([k, v]) => `<li>
        <span class="sw" style="background:${CARGO_COLORS[k] || CARGO_COLORS.OTHERS}"></span>
        <span title="${esc(TYPE_NAMES[k] || k)}">${esc(k === 'FINISH GOODS' ? 'Finished goods' : k === 'OTHERS' ? 'Others' : k)}</span>
        <span class="v">${mt(v)}</span><span class="p">${Math.round((v / total) * 100)}%</span></li>`).join('')}</ul>`
      : `<p class="empty-note">Nothing discharged in this period yet.</p>`;
    return `<section class="sec" id="sec-mix">
      <h3>Cargo mix <span class="tabs">${tab('today', 'Today')}${tab('month', 'Month')}${tab('fy', 'FY')}</span></h3>
      ${body}</section>`;
  }

  function secAtPort(a) {
    const s = a.status;
    const berths = a.berths.map(b => {
      if (!b.vessels.length) return `<li class="berth empty"><div class="berth-name">${esc(b.berth)}</div></li>`;
      const vs = b.vessels.map(v => {
        const cls = v.status === 'Under Discharge' ? 'working' : v.status === 'Discharge Completed' ? 'done' : '';
        const state = v.status === 'Under Discharge' ? `${mt(v.balance)} MT left`
          : v.status === 'Discharge Completed' ? 'Discharge complete' : 'Waiting to start';
        return `<div class="vessel ${cls}">
          <span class="vn">${esc(v.name)}<em>${esc(v.type === 'MBC' ? 'MBC' : 'Barge')}, ${esc(v.position)}</em></span>
          <span class="vq">${mt(v.total)} MT</span>
          <span class="vc">${esc(v.cargo)}</span>
          <span class="vs">${state}</span>
          ${v.done_pct != null && v.status !== 'Waiting' ? `<span class="vm"><i style="width:${v.done_pct}%"></i></span>` : ''}
        </div>`;
      }).join('');
      return `<li class="berth"><div class="berth-name">${esc(b.berth)}</div>${vs}</li>`;
    }).join('');
    return `<section class="sec">
      <h3>At the berths <small>${a.occupied_berths} of ${a.berths.length} occupied</small></h3>
      <div class="counts">
        <div class="count working"><span class="fig">${s['Under Discharge'] || 0}</span><span>Discharging</span></div>
        <div class="count"><span class="fig">${s['Waiting'] || 0}</span><span>Waiting</span></div>
        <div class="count done"><span class="fig">${s['Discharge Completed'] || 0}</span><span>Completed</span></div>
      </div>
      <p class="note">Still to discharge at port: <strong>${mt(a.balance_to_discharge)} MT</strong></p>
      ${a.berths.length ? `<ul class="berths">${berths}</ul>` : ''}
    </section>`;
  }

  function secInbound(list) {
    if (!list.length) {
      return `<section class="sec"><h3>On the way from Gull Island</h3>
        <p class="empty-note">No loaded barges or MBCs are under way right now.</p></section>`;
    }
    const total = list.reduce((a, v) => a + v.qty, 0);
    return `<section class="sec">
      <h3>On the way from Gull Island <small>${mt(total)} MT</small></h3>
      <ul class="rows">${list.map(v => {
        const d = parseLocal(v.departed);
        return `<li><span>${esc(v.name)}<span class="tag">${v.type === 'MBC' ? 'MBC' : 'Barge'}</span></span>
          <span class="r">${mt(v.qty)} MT</span>
          <span class="sub">${esc(v.cargo)}</span>
          <span class="sub r">${d ? 'Left ' + ago(d) : esc(v.departed)}</span></li>`;
      }).join('')}</ul></section>`;
  }

  function secDelays(dl) {
    if (!dl.top.length) {
      return `<section class="sec"><h3>Delays today</h3><p class="empty-note">No delays logged this op-day.</p></section>`;
    }
    const max = dl.top[0].minutes;
    return `<section class="sec">
      <h3>Delays today <small>${mins(dl.total_minutes)} in total</small></h3>
      <ul class="delay-bars">${dl.top.map(d => `<li>
        <div class="top"><span>${esc(d.label)}</span><span>${mins(d.minutes)}</span></div>
        <div class="track"><i style="width:${(d.minutes / max) * 100}%"></i></div></li>`).join('')}</ul>
      ${dl.count > dl.top.length ? `<p class="note muted">Top ${dl.top.length} of ${dl.count} delay types.</p>` : ''}
    </section>`;
  }

  function secShift(si) {
    return `<section class="sec">
      <h3>Shift ${esc(si.shift)} <small>${si.incharge ? 'In charge: ' + esc(si.incharge) : 'In-charge not recorded'}</small></h3>
      ${si.notes.length ? `<ol class="notes">${si.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ol>`
        : `<p class="empty-note">No shift notes yet.</p>`}
    </section>`;
  }

  function secTideWeather(tide, wx, asOf) {
    const ref = new Date(asOf);
    const tides = tide && tide.length ? `<ul class="tides">${tide.map(t => {
      const d = new Date(t.at);
      return `<li><span class="${t.type === 'HW' ? 'hw' : ''}">${t.type === 'HW' ? 'High' : 'Low'} ${t.meters} m</span><span>${hm(d)}<span class="muted">${dayTag(d, ref)}</span></span></li>`;
    }).join('')}</ul>` : `<p class="empty-note">No upcoming tides in the table.</p>`;

    let w = `<p class="empty-note">No weather cached.</p>`;
    if (wx) {
      w = `<div class="wx">${wx.icon ? `<img src="${esc(wx.icon)}" alt="" onerror="this.remove()">` : ''}
          <span class="fig fig-l">${Math.round(wx.temp)}°</span></div>
        <p class="note" style="margin-top:4px">${esc(wx.text || '')}<br>
          Wind ${Math.round(wx.wind)} km/h ${esc(wx.wind_dir || '')}${wx.gust ? `, gusts ${Math.round(wx.gust)}` : ''}<br>
          Humidity ${Math.round(wx.humidity)}%</p>
        ${wx.stale ? `<p class="note short">Last updated ${ago(new Date(wx.fetched))}</p>` : ''}`;
    }
    return `<section class="sec duo">
      <div><h3>Next tides</h3>${tides}</div>
      <div><h3>Weather</h3>${w}</div>
    </section>`;
  }

  function secFleet(fleet) {
    if (!fleet.length) return '';
    return `<section class="sec">
      <h3>MBC fleet <small>${fleet.reduce((a, g) => a + g.vessels.length, 0)} vessels</small></h3>
      <ul class="fleet">${[...fleet].sort((a, b) => stageIndex(a.status) - stageIndex(b.status)).map(g => `<li>
        <div class="st"><span>${esc(stageLabel(g.status))}</span><span>${g.vessels.length}</span></div>
        <div class="ns">${g.vessels.map(v => esc(v.name) + (v.cargo ? ` <span class="muted">(${esc(v.cargo)})</span>` : '')).join(', ')}</div>
      </li>`).join('')}</ul></section>`;
  }

  // ── render ────────────────────────────────────────────
  function render() {
    const d = data;
    if (!d.connected) {
      el.body.innerHTML = `<section class="sec"><h3>${esc(d.status)}${d.overseas ? ' <small>Overseas</small>' : ''}</h3>
        <p class="empty-note">Live operations data for this location is not connected to the dashboard yet.</p></section>`;
      el.body.classList.remove('loading');
      el.meta.textContent = '';
      return;
    }
    const parts = [];
    if (d.throughput) {
      parts.push(secToday(d.throughput, d.shift), secMonth(d.throughput, d.op_date), secFY(d.throughput), secMix(d.throughput));
    }
    if (d.at_port) parts.push(secAtPort(d.at_port));
    if (d.inbound) parts.push(secInbound(d.inbound));
    if (d.delays) parts.push(secDelays(d.delays));
    if (d.shift_info) parts.push(secShift(d.shift_info));
    if (d.tide || d.weather) parts.push(secTideWeather(d.tide, d.weather, d.as_of));
    if (d.mbc_fleet) parts.push(secFleet(d.mbc_fleet));
    if (d.errors && d.errors.length) {
      parts.push(`<div class="errors">Some sections could not load: ${d.errors.map(e => `${esc(e.section)} (${esc(e.error)})`).join('; ')}</div>`);
    }
    el.body.innerHTML = parts.join('');
    el.body.classList.remove('loading');

    const synced = d.last_synced ? new Date(d.last_synced) : null;
    el.meta.textContent = synced ? `Data synced ${hm(synced)}${dayTag(synced, new Date())}, ${ago(synced)}` : 'No sync time recorded';
  }

  el.body.addEventListener('click', e => {
    const b = e.target.closest('[data-mix]');
    if (!b || !data) return;
    mixPeriod = b.dataset.mix;
    document.getElementById('sec-mix').outerHTML = secMix(data.throughput);
  });

  async function load() {
    if (!code) return;
    const want = code;
    el.body.classList.add('loading');
    try {
      const res = await fetch(CFG.summary.replace('__CODE__', encodeURIComponent(want)));
      if (!res.ok) throw new Error(`Summary returned ${res.status}`);
      const json = await res.json();
      if (want !== code) return;                 // user switched ports meanwhile
      data = json;
      render();
    } catch (e) {
      if (want !== code) return;
      el.body.classList.remove('loading');
      el.body.innerHTML = `<div class="errors">${esc(e.message)}. The panel will retry in two minutes, or close and reopen it to retry now.</div>`;
    }
  }

  function setHero(p) {
    el.title.textContent = p.name;
    el.region.textContent = p.region || '';
    if (p.image) {
      el.img.onload = () => { el.img.hidden = false; el.hero.classList.add('has-img'); };
      el.img.onerror = () => { el.img.hidden = true; el.hero.classList.remove('has-img'); };
      el.img.src = p.image;
    } else {
      el.img.hidden = true; el.hero.classList.remove('has-img');
    }
  }

  function open(p) {
    if (!el.panel.classList.contains('open')) lastFocus = document.activeElement;
    if (code !== p.code) { data = null; el.body.innerHTML = ''; el.meta.textContent = 'Loading summary'; }
    code = p.code;
    setHero(p);
    el.panel.classList.add('open');
    el.panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
    el.panel.focus({ preventScroll: true });
    const url = new URL(location.href); url.searchParams.set('port', p.code);
    history.replaceState(null, '', url);
    clearInterval(timer);
    timer = setInterval(load, REFRESH_MS);
    load();
  }

  function close() {
    code = null;
    clearInterval(timer);
    el.panel.classList.remove('open');
    el.panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    const url = new URL(location.href); url.searchParams.delete('port');
    history.replaceState(null, '', url);
    if (api.onClose) api.onClose();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  el.close.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && code) close(); });

  return api;
})();
