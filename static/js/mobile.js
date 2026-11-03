/* Phone layout: a tab bar (Map, Locations, Settings), and a port's details as their
   own page. Tapping a port flies the map in and shows a card above the tab bar;
   tapping the card opens the details page. The phone's back gesture steps back
   (details -> card, Locations/Settings -> map). Desktop uses none of this. */
(function () {
  const mq = window.matchMedia('(max-width: 760px) and (pointer: fine), (max-width: 1100px) and (orientation: portrait) and (pointer: coarse)');   // = app.css, map.js
  const body = document.body, panel = document.getElementById('panel');
  const tabs = document.querySelectorAll('#tabbar [data-tab]');
  const PAGES = { list: 'm-list', more: 'm-more', port: 'm-port' };
  let page = 'map';

  function show(p) {
    page = p;
    Object.entries(PAGES).forEach(([k, cls]) => body.classList.toggle(cls, k === p));
    tabs.forEach(t => t.toggleAttribute('aria-current', t.dataset.tab === (p === 'port' ? 'map' : p)));
    panel.querySelector('.panel-scroll').scrollTo({ top: 0 });   // the card shows the top; the page opens at it
  }
  // Every page past the map is one history entry, so Back (button or gesture) returns to the map.
  function go(p) {
    if (p === page) return;
    if (p === 'map') { history.state && history.state.page ? history.back() : show('map'); return; }
    if (page === 'map') history.pushState({ page: p }, ''); else history.replaceState({ page: p }, '');
    show(p);
  }
  window.addEventListener('popstate', e => show((e.state && e.state.page) || 'map'));

  tabs.forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));

  // Locations page: a location goes back to the map, which flies to it (side.js opens it).
  document.getElementById('side-body').addEventListener('click', e => {
    if (mq.matches && e.target.closest('.loc')) go('map');
  });

  // Port card -> details page; the back arrow on that page -> card.
  panel.querySelector('.panel-hero').addEventListener('click', e => {
    if (mq.matches && page === 'map' && panel.classList.contains('open') && !e.target.closest('button')) go('port');
  });
  document.getElementById('panel-back').addEventListener('click', () => go('map'));
  // Card closed (its X): nothing left to show a details page for.
  new MutationObserver(() => { if (!panel.classList.contains('open') && page === 'port') go('map'); })
    .observe(panel, { attributes: true, attributeFilter: ['class'] });
  // Window grown to desktop size: desktop layout, no phone pages.
  mq.addEventListener('change', () => { if (!mq.matches && page !== 'map') go('map'); });

  // iOS can leave the page scrolled a little after a rotation (the Safari toolbar): buttons
  // then draw in one place and take taps a few pixels away. Nothing on the page scrolls
  // (lists scroll inside their own boxes), so any page scroll is put straight back.
  const unscroll = () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); };
  window.addEventListener('scroll', unscroll);
  window.addEventListener('resize', unscroll);
  window.addEventListener('orientationchange', () => setTimeout(unscroll, 300));   // iOS settles late

  // ── install to the home screen ──
  const installBtn = document.getElementById('m-install');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {   // Android Chrome / Edge
    e.preventDefault();
    deferred = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    installBtn.hidden = true;
  });
  // iPhone/iPad Safari has no install prompt: say how.
  if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) document.getElementById('m-ios-hint').hidden = false;
})();
