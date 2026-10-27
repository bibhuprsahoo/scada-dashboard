/* BAMUL Executive Dashboard — shared behaviour: top bar, tabs, clock, animated bars */
(function () {
  const MODULES = [
    ['m01-overview.html',      'BAMUL Overview'],
    ['m02-finance.html',       'Finance Module'],
    ['m03-production.html',    'Production Data'],
    ['m04-procurement.html',   'Procurement & Input'],
    ['m05-transport.html',     'Transportation'],
    ['m06-quality.html',       'Quality & Testing'],
    ['m07-animal-health.html', 'Animal Health & Vet'],
    ['m08-hr.html',            'HR & Manpower'],
    ['m09-cattle-relief.html', 'Cattle Relief Funds'],
    ['m10-mis.html',           'MIS & Reports'],
    ['m11-events.html',        'Events & Meetings'],
    ['m12-settings.html',      'Settings / Admin']
  ];
  window.BAMUL_MODULES = MODULES;

  /* ---------- top bar ---------- */
  const bar = document.getElementById('topbar');
  if (bar) {
    const here = location.pathname.split('/').pop() || 'portal.html';
    const opts = MODULES.map(([f, n], i) =>
      `<option value="${f}"${f === here ? ' selected' : ''}>${String(i + 1).padStart(2, '0')} · ${n}</option>`).join('');
    bar.className = 'topbar';
    bar.innerHTML = `
      <a class="brand" href="portal.html" title="Back to portal">
        <img src="images/logo.png" alt="BAMUL" onerror="this.closest('.brand').classList.add('noimg')">
        <span class="mark">BM</span>
        <span><span class="t1"><span class="lg">BAMUL Executive Dashboard</span><span class="sm">BAMUL</span></span><span class="t2">Bangalore Milk Union Ltd.</span></span>
      </a>
      <span class="spacer"></span>
      <span class="chip demo" title="Figures are illustrative until EBS, warehouse and SCADA are connected">Illustrative data</span>
      <span class="clock"><span class="dot-live" style="display:inline-block;margin-right:8px;vertical-align:1px"></span><span id="clk"></span></span>
      <select class="modsel" aria-label="Jump to module">
        <option value="portal.html"${here === 'portal.html' ? ' selected' : ''}>All modules</option>${opts}
      </select>`;
    bar.querySelector('.modsel').addEventListener('change', e => { location.href = e.target.value; });
    const clk = bar.querySelector('#clk');
    const tick = () => {
      clk.textContent = new Date().toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };
    tick(); setInterval(tick, 30000);
  }

  /* ---------- left sidebar for module sub-tabs ---------- */
  const tabNav = document.querySelector('[data-tabs]');
  const wrap = document.querySelector('main.wrap');
  if (tabNav && wrap) {
    const kicker = (wrap.querySelector('.phead .kicker') || {}).textContent || '';
    const [modNo, modName] = kicker.split('·').map(s => s.trim());
    const side = document.createElement('aside');
    side.className = 'side';
    side.innerHTML = `
      <a class="side-back" href="portal.html">← All modules</a>
      <div class="side-mod"><span class="side-no">${modNo || ''}</span><b>${modName || ''}</b></div>
      <div class="side-lbl">Sections</div>`;
    const main = document.createElement('div');
    main.className = 'main';
    while (wrap.firstChild) main.appendChild(wrap.firstChild);
    side.appendChild(tabNav);
    tabNav.classList.add('side-tabs');
    [...tabNav.querySelectorAll('button[data-tab]')].forEach((b, i) => {
      b.innerHTML = `<span class="ix">${String(i + 1).padStart(2, '0')}</span><span class="tx">${b.innerHTML}</span>`;
    });
    wrap.classList.add('has-side');
    wrap.append(side, main);
  }

  /* ---------- tabs (with #hash deep link) ---------- */
  document.querySelectorAll('[data-tabs]').forEach(tabs => {
    const btns = [...tabs.querySelectorAll('button[data-tab]')];
    const show = id => {
      btns.forEach(b => b.classList.toggle('on', b.dataset.tab === id));
      document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === id));
      animate(document.getElementById(id));
      const on = btns.find(b => b.dataset.tab === id);
      if (on && window.innerWidth <= 900) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    };
    btns.forEach(b => b.addEventListener('click', () => {
      show(b.dataset.tab); history.replaceState(null, '', '#' + b.dataset.tab);
      const main = document.querySelector('.has-side .main .kpis, .has-side .main .panel.on');
      if (main && main.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    const start = location.hash.slice(1);
    show(btns.some(b => b.dataset.tab === start) ? start : btns[0].dataset.tab);
  });

  /* ---------- bar/column grow-in ---------- */
  function animate(root) {
    if (!root) return;
    root.querySelectorAll('.fill[data-v], .c[data-h]').forEach(el => {
      const isCol = el.classList.contains('c');
      el.style.setProperty(isCol ? '--h' : '--v', '0%');
      requestAnimationFrame(() => requestAnimationFrame(() =>
        el.style.setProperty(isCol ? '--h' : '--v', (isCol ? el.dataset.h : el.dataset.v) + '%')));
    });
  }
  if (!document.querySelector('[data-tabs]')) animate(document.body);

  /* ---------- simple client-side table filter ---------- */
  document.querySelectorAll('[data-filter]').forEach(inp => {
    const tbl = document.getElementById(inp.dataset.filter);
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase();
      tbl.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    });
  });
  document.querySelectorAll('[data-status-filter]').forEach(sel => {
    const tbl = document.getElementById(sel.dataset.statusFilter);
    sel.addEventListener('change', () => {
      const v = sel.value;
      tbl.querySelectorAll('tbody tr').forEach(tr => { tr.style.display = !v || tr.dataset.status === v ? '' : 'none'; });
    });
  });

  /* ---------- toggles ---------- */
  document.querySelectorAll('.switch, .chk').forEach(s => s.addEventListener('click', () => s.classList.toggle('on')));
})();
