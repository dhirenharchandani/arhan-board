/* ============================================================
   Arhan's Application Board — public site
   Data source: a Google Sheet published to the web as CSV.
   Everything below is read-only. Editing happens in the sheet.
   ============================================================ */

var CONFIG = {
  /* Paste the published-to-web CSV link here.
     Sheet > File > Share > Publish to web > choose the tab > Comma-separated values (.csv) */
  SHEET_CSV: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTOv5kbUtnEUDdVFvB3Rf8EDdoaLogyBm4eoCL9BrUW1D5gFjQ0ra-E2xMECgVvUTbd7PEkUNkd7H8J/pub?gid=1392823886&single=true&output=csv',

  /* The normal edit link, for the "Update the board" button. */
  SHEET_EDIT: 'https://docs.google.com/spreadsheets/d/1micJob3EH9BX4Jo6ZFTCEtAKB8dMbXLujgcFhHbBq38/edit',

  STUDENT: 'Arhan',
  ENTRY: 'Autumn 2027 entry',
  REFRESH_MS: 300000
};

(function () {
  var app = document.getElementById('app');
  var rows = [];
  var lastFetch = null;
  var loadError = null;
  var clockTimer = null;

  var TICKS = ['Account', 'Essay / statement', 'References', 'Transcript / grades', 'Test scores', 'Financial aid', 'Submitted'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WINDOW_START = new Date(2026, 7, 1);
  var WINDOW_END = new Date(2027, 4, 15);

  var MILESTONES = [
    { date: '2026-08-01', label: 'Common App opens', note: 'Applications for autumn 2027 entry opened in August 2026.' },
    { date: '2026-11-01', label: 'Early rounds close', note: 'The common early deadline for ED and EA. A handful of schools sit at 15 November instead.' },
    { date: '2026-11-30', label: 'University of California window closes', note: 'The UC system runs no early round. Confirm the exact date per campus.' },
    { date: '2027-01-01', label: 'Regular Decision deadlines begin', note: 'Most regular deadlines fall between 1 January and mid February.' },
    { date: '2027-01-13', label: 'UCAS equal consideration, 18:00 UK time', note: 'Anything in by this moment is judged on the same basis. After it, only if places remain.' },
    { date: '2027-03-15', label: 'Decisions arrive', note: 'US decisions land through March and April.' },
    { date: '2027-05-01', label: 'Reply by', note: 'Accept one offer and place the deposit.' }
  ];

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parseDate(v) {
    if (!v) return null;
    v = String(v).trim();
    var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          /* month/day/year, Google's US export */
    if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
    var d = new Date(v);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function iso(d) {
    if (!d) return '';
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmt(d) { return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : 'No date set'; }
  function daysTo(d) { return d ? Math.round((d - today()) / 86400000) : null; }
  function truthy(v) { return String(v).trim().toUpperCase() === 'TRUE'; }
  function shortName(n) {
    var s = String(n).replace(/^University of /i, 'Univ. of ');
    return s.length > 26 ? s.slice(0, 25) + '…' : s;
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 3200);
  }

  /* ---------- csv ---------- */

  function parseCSV(text) {
    var out = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); cur = ''; out.push(row); row = []; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); out.push(row); }
    return out;
  }

  function toRecords(grid) {
    if (!grid.length) return [];
    var head = grid[0].map(function (h) { return String(h).trim(); });
    var idx = {};
    head.forEach(function (h, i) { if (idx[h] === undefined) idx[h] = i; });
    var get = function (r, name) { return idx[name] === undefined ? '' : (r[idx[name]] || '').trim(); };

    return grid.slice(1).map(function (r) {
      var name = get(r, 'School');
      if (!name) return null;
      var items = TICKS.filter(function (t) { return idx[t] !== undefined; })
        .map(function (t) { return { label: t, done: truthy(get(r, t)) }; });
      var done = items.filter(function (x) { return x.done; }).length;
      return {
        name: name,
        country: get(r, 'Country') || '',
        round: get(r, 'Round') || '',
        date: parseDate(get(r, 'Deadline')),
        checked: truthy(get(r, 'Date checked')),
        lead: get(r, 'Lead') || 'Unassigned',
        note: get(r, 'Notes') || '',
        items: items,
        done: done,
        total: items.length,
        pct: items.length ? done / items.length : 0
      };
    }).filter(Boolean).sort(function (a, b) {
      if (!a.date) return 1; if (!b.date) return -1;
      return a.date - b.date;
    });
  }

  function load() {
    if (!CONFIG.SHEET_CSV || CONFIG.SHEET_CSV.indexOf('PASTE_') === 0) {
      loadError = 'notconfigured';
      render();
      return Promise.resolve();
    }
    var url = CONFIG.SHEET_CSV + (CONFIG.SHEET_CSV.indexOf('?') > -1 ? '&' : '?') + 'cachebust=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        rows = toRecords(parseCSV(text));
        loadError = rows.length ? null : 'empty';
        lastFetch = new Date();
        render();
      })
      .catch(function (e) {
        loadError = 'fetch';
        console.error('Sheet fetch failed:', e);
        render();
      });
  }

  /* ---------- derived ---------- */

  function tone(s) {
    if (s.total && s.done === s.total) return 'done';
    var d = daysTo(s.date);
    if (d === null) return '';
    if (d < 0) return 'crit';
    if (d <= 21) return 'warn';
    return '';
  }
  function nextTarget() {
    return rows.filter(function (s) { return s.date && !(s.total && s.done === s.total) && daysTo(s.date) >= 0; })[0] || null;
  }
  function totals() {
    var done = 0, total = 0;
    rows.forEach(function (s) { done += s.done; total += s.total; });
    return { done: done, total: total, open: total - done };
  }
  function loadByLead() {
    var map = {};
    rows.forEach(function (s) {
      var open = s.total - s.done;
      map[s.lead] = (map[s.lead] || 0) + open;
    });
    var list = Object.keys(map).map(function (k) { return { name: k, n: map[k] }; });
    list.sort(function (a, b) { return b.n - a.n; });
    var max = Math.max.apply(null, list.map(function (r) { return r.n; }).concat([1]));
    return { rows: list, max: max };
  }

  /* ---------- runway ---------- */

  function runway() {
    var W = 1000, H = 250, L = 26, R = 26, BASE = 196;
    var span = WINDOW_END - WINDOW_START;
    function x(d) { return L + (d - WINDOW_START) / span * (W - L - R); }

    var ticks = '', cur = new Date(2026, 7, 1);
    while (cur <= WINDOW_END) {
      var tx = x(cur);
      ticks += '<line x1="' + tx.toFixed(1) + '" y1="' + BASE + '" x2="' + tx.toFixed(1) + '" y2="' + (BASE + 6) + '" stroke="var(--line-2)" stroke-width="1"/>' +
        '<text class="rw-mut" x="' + tx.toFixed(1) + '" y="' + (BASE + 21) + '" text-anchor="middle">' + MONTHS[cur.getMonth()].toUpperCase() + '</text>';
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    var ms = MILESTONES.map(function (m) {
      var d = parseDate(m.date);
      if (!d || d < WINDOW_START || d > WINDOW_END) return '';
      var mx = x(d);
      return '<rect x="' + (mx - 3).toFixed(1) + '" y="' + (BASE - 3) + '" width="6" height="6" transform="rotate(45 ' + mx.toFixed(1) + ' ' + BASE + ')" fill="var(--line-2)"><title>' + esc(m.label) + ', ' + fmt(d) + '</title></rect>';
    }).join('');

    var lanes = [];
    var marks = rows.filter(function (s) { return s.date; }).map(function (s) {
      var px = x(s.date), lane = 0;
      while (lanes[lane] !== undefined && px - lanes[lane] < 190) lane++;
      lanes[lane] = px;
      var y = BASE - 34 - lane * 40;
      var t = tone(s);
      var col = t === 'crit' ? 'var(--crit)' : t === 'warn' ? 'var(--warn)' : t === 'done' ? 'var(--accent)' : 'var(--accent-2)';
      var C = 2 * Math.PI * 9;
      var flip = px > W - 250;
      var lx = flip ? px - 20 : px + 20;
      var anchor = flip ? 'end' : 'start';
      var d = daysTo(s.date);
      var sub = (d < 0 ? Math.abs(d) + 'd past' : d + 'd left') + '  ·  ' + s.done + '/' + s.total;
      return '<g class="rw-hit" data-tipname="' + esc(s.name) + '" data-tipsub="' + esc(fmt(s.date) + ' · ' + s.round + ' · ' + s.done + ' of ' + s.total + ' done') + '">' +
        '<line x1="' + px.toFixed(1) + '" y1="' + (y + 13) + '" x2="' + px.toFixed(1) + '" y2="' + BASE + '" stroke="var(--line)" stroke-width="1"/>' +
        '<circle cx="' + px.toFixed(1) + '" cy="' + y + '" r="9" fill="none" stroke="var(--surface-2)" stroke-width="3"/>' +
        '<circle cx="' + px.toFixed(1) + '" cy="' + y + '" r="9" fill="none" stroke="' + col + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (C * s.pct).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 ' + px.toFixed(1) + ' ' + y + ')"/>' +
        '<circle cx="' + px.toFixed(1) + '" cy="' + y + '" r="3.2" fill="' + col + '"/>' +
        '<text class="rw-name" x="' + lx.toFixed(1) + '" y="' + (y - 1) + '" text-anchor="' + anchor + '">' + esc(shortName(s.name)) + '</text>' +
        '<text class="rw-mut" x="' + lx.toFixed(1) + '" y="' + (y + 13) + '" text-anchor="' + anchor + '">' + esc(sub) + '</text>' +
      '</g>';
    }).join('');

    var t = today(), nowMark = '';
    if (t >= WINDOW_START && t <= WINDOW_END) {
      var nx = x(t);
      nowMark = '<line x1="' + nx.toFixed(1) + '" y1="16" x2="' + nx.toFixed(1) + '" y2="' + BASE + '" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 4"/>' +
        '<text class="rw-mut" x="' + (nx + 7).toFixed(1) + '" y="24">TODAY</text>';
    }

    return '<div class="runway"><div class="scroller">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Timeline of application deadlines from August 2026 to May 2027">' +
      '<line x1="' + L + '" y1="' + BASE + '" x2="' + (W - R) + '" y2="' + BASE + '" stroke="var(--line-2)" stroke-width="1"/>' +
      ticks + ms + nowMark + marks + '</svg></div>' +
      '<div class="legend">' +
        '<span><i style="background:var(--accent-2)"></i>On track</span>' +
        '<span><i style="background:var(--warn)"></i>Inside 3 weeks</span>' +
        '<span><i style="background:var(--crit)"></i>Past deadline</span>' +
        '<span><i style="background:var(--accent)"></i>Complete</span>' +
        '<span><i style="background:var(--line-2);border-radius:1px;transform:rotate(45deg)"></i>Cycle milestone</span>' +
      '</div></div>';
  }

  /* ---------- blocks ---------- */

  function card(s) {
    var t = tone(s), d = daysTo(s.date), C = 2 * Math.PI * 20;
    var statusChip = t === 'crit' ? '<span class="chip late">Past deadline</span>'
      : t === 'warn' ? '<span class="chip soon">' + d + ' days out</span>'
      : t === 'done' ? '<span class="chip round">Complete</span>' : '';
    var items = s.items.map(function (it) {
      return '<li class="tickrow' + (it.done ? ' on' : '') + '"><span class="box"></span><span class="lab">' + esc(it.label) + '</span></li>';
    }).join('');

    return '<article class="card ' + (t ? 'is-' + t : '') + '">' +
      '<div class="card-top"><div class="meta">' +
        '<h3>' + esc(s.name) + '</h3>' +
        '<div class="chips"><span class="chip round">' + esc(s.round) + '</span><span class="chip">' + esc(s.country) + '</span>' + statusChip + '</div>' +
        '<div class="datebar">' +
          '<span style="font-family:var(--mono);font-size:13px;' + (s.checked ? '' : 'border-bottom:1px dotted var(--warn);') + '">' + fmt(s.date) + '</span>' +
          '<span class="leadchip">' + esc(s.lead) + '</span>' +
        '</div>' +
        (s.checked ? '' : '<div class="eyebrow" style="color:var(--warn)">Date not yet checked on their site</div>') +
      '</div>' +
      '<div class="ring"><svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">' +
        '<circle class="track" cx="26" cy="26" r="20" fill="none" stroke-width="4"/>' +
        '<circle class="fill" cx="26" cy="26" r="20" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - s.pct)).toFixed(1) + '"/>' +
      '</svg><b>' + s.done + '/' + s.total + '</b></div>' +
      '</div>' +
      '<ul class="list">' + items + '</ul>' +
      '<div class="card-foot"><div class="notefoot">' + esc(s.note) + '</div></div>' +
    '</article>';
  }

  function heroBlock() {
    var tg = nextTarget(), tt = totals(), clock;
    if (tg) {
      clock = '<div class="clock" id="clock" data-deadline="' + iso(tg.date) + '">' +
        '<div class="cap">Time to the next deadline</div><div class="units" id="units"></div>' +
        '<div class="target"><b>' + esc(tg.name) + '</b><br><span>' + esc(tg.round) + ' closes ' + fmt(tg.date) + '</span></div></div>';
    } else {
      clock = '<div class="clock"><div class="cap">Time to the next deadline</div>' +
        '<div class="units"><div class="u"><div class="n">&mdash;</div><div class="l">nothing queued</div></div></div>' +
        '<div class="target"><span>Add a school with a date in the sheet and the clock starts.</span></div></div>';
    }
    return '<header class="hero"><div class="wrap"><div>' +
      '<div class="eyebrow">' + esc(CONFIG.ENTRY) + '</div>' +
      '<h1>' + esc(CONFIG.STUDENT) + '’s Application Board</h1>' +
      '<p class="lede">One list the whole family reads the same way. Tick what is done, name who is carrying it, and the deadline maths takes care of itself.</p>' +
      '<div class="tally">' +
        '<div><div class="v">' + rows.length + '</div><div class="k">Schools</div></div>' +
        '<div><div class="v">' + tt.done + ' / ' + tt.total + '</div><div class="k">Items done</div></div>' +
        '<div><div class="v">' + tt.open + '</div><div class="k">Still open</div></div>' +
      '</div>' +
      '<a class="cta" href="' + esc(CONFIG.SHEET_EDIT) + '" target="_blank" rel="noopener">Update the board</a>' +
      '</div>' + clock + '</div></header>';
  }

  function loadBlock() {
    var L = loadByLead();
    var bars = L.rows.map(function (r) {
      return '<div class="brow' + (r.n === 0 ? ' zero' : '') + '"><div class="who">' + esc(r.name) + '</div>' +
        '<div class="track"><i style="width:' + (r.n === 0 ? 2 : Math.max(4, r.n / L.max * 100)) + '%"></i></div>' +
        '<div class="v">' + r.n + '</div></div>';
    }).join('');
    return '<div class="bars"><p class="cap">Open items counted against whoever is named as lead for that school. Change the Lead column in the sheet to move the load.</p>' + bars + '</div>';
  }

  function railBlock() {
    var t = today(), nextIdx = -1;
    for (var i = 0; i < MILESTONES.length; i++) { if (parseDate(MILESTONES[i].date) >= t) { nextIdx = i; break; } }
    return '<ul class="rail">' + MILESTONES.map(function (m, i) {
      var cls = parseDate(m.date) < t ? 'past' : (i === nextIdx ? 'now' : '');
      return '<li class="' + cls + '"><div class="m-date">' + fmt(parseDate(m.date)) + '</div>' +
        '<div class="m-label">' + esc(m.label) + '</div><div class="m-note">' + esc(m.note) + '</div></li>';
    }).join('') + '</ul>';
  }

  function errorBlock() {
    if (loadError === 'notconfigured') {
      return '<div class="errorbox"><b>The sheet link is not set yet.</b>Open <code>app.js</code> and put the published CSV link into <code>CONFIG.SHEET_CSV</code>, then redeploy.</div>';
    }
    if (loadError === 'fetch') {
      return '<div class="errorbox"><b>Could not reach the sheet.</b>The board is usually published to the web as CSV. Check that the publish is still switched on in the sheet, then refresh this page.</div>';
    }
    if (loadError === 'empty') {
      return '<div class="errorbox"><b>The sheet loaded, but there are no schools in it.</b>Add a row with a school name and a deadline, then refresh.</div>';
    }
    return '';
  }

  /* ---------- render ---------- */

  function render() {
    var err = errorBlock();
    app.innerHTML =
      '<nav class="topbar"><div class="inner">' +
        '<div class="mark">' + esc(CONFIG.STUDENT) + ' <em>/ applications</em></div>' +
        '<div class="navlinks">' +
          '<a href="#runway" data-nav>Runway</a><a href="#board" data-nav>Board</a>' +
          '<a href="#load" data-nav>Who carries what</a><a href="#cycle" data-nav>The cycle</a>' +
        '</div>' +
        '<a class="cta small" href="' + esc(CONFIG.SHEET_EDIT) + '" target="_blank" rel="noopener">Edit</a>' +
      '</div></nav>' +

      heroBlock() +

      '<main class="wrap">' +
        (err ? '<div style="margin-top:34px">' + err + '</div>' : '') +

        '<section id="runway"><div class="sechead"><h2>The runway</h2>' +
          '<span class="hint">August 2026 to May 2027. Rings show how much of each application is done.</span></div>' +
          (rows.length ? runway() : '') + '</section>' +

        '<section id="board"><div class="sechead"><h2>The board</h2>' +
          '<span class="hint">' + rows.length + ' on the list</span></div>' +
          '<div class="grid">' + rows.map(card).join('') + '</div>' +
          '<div class="statusline"><span id="stamp"></span>' +
          '<button class="cta small" id="refresh" type="button">Refresh</button></div>' +
        '</section>' +

        '<section id="load"><div class="sechead"><h2>Who carries what</h2>' +
          '<span class="hint">Load, not blame</span></div>' + loadBlock() + '</section>' +

        '<section id="cycle"><div class="sechead"><h2>The cycle</h2>' +
          '<span class="hint">Fixed dates, not ours to move</span></div>' + railBlock() + '</section>' +

        '<p class="colophon">This page reads a Google Sheet the family edits. Changes show up here within about five minutes, or straight away if you press Refresh. Cycle dates come from the published 2026 to 2027 calendars, and the UCAS equal consideration deadline of 13 January 2027 at 18:00 UK time is confirmed on ucas.com. US dates vary school by school, so a deadline stays marked unchecked until someone ticks the Date checked column in the sheet.</p>' +
      '</main>';

    stamp();
    startClock();
    watchNav();
  }

  function stamp() {
    var el = document.getElementById('stamp');
    if (!el) return;
    el.textContent = lastFetch
      ? 'Last read from the sheet at ' + lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Not loaded yet';
  }

  function startClock() {
    clearInterval(clockTimer);
    var el = document.getElementById('clock');
    if (!el) return;
    var d = parseDate(el.getAttribute('data-deadline'));
    var units = document.getElementById('units');
    if (!d || !units) return;
    function tick() {
      var end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
      var ms = end - new Date(), past = ms < 0;
      ms = Math.abs(ms);
      var days = Math.floor(ms / 86400000);
      var hrs = Math.floor(ms % 86400000 / 3600000);
      var mins = Math.floor(ms % 3600000 / 60000);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      units.innerHTML =
        '<div class="u"><div class="n' + (past ? ' past' : '') + '">' + days + '</div><div class="l">' + (past ? 'days past' : 'days') + '</div></div>' +
        '<div class="u"><div class="n' + (past ? ' past' : '') + '">' + pad(hrs) + '</div><div class="l">hours</div></div>' +
        '<div class="u"><div class="n' + (past ? ' past' : '') + '">' + pad(mins) + '</div><div class="l">minutes</div></div>';
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function watchNav() {
    var links = [].slice.call(document.querySelectorAll('[data-nav]'));
    if (!links.length || !window.IntersectionObserver) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-56px 0px -70% 0px' });
    ['runway', 'board', 'load', 'cycle'].forEach(function (id) {
      var s = document.getElementById(id); if (s) obs.observe(s);
    });
  }

  var tip = document.getElementById('tip');
  document.addEventListener('mousemove', function (e) {
    var g = e.target.closest ? e.target.closest('.rw-hit') : null;
    if (!g) { tip.classList.remove('on'); return; }
    tip.innerHTML = '<b>' + esc(g.getAttribute('data-tipname')) + '</b><span>' + esc(g.getAttribute('data-tipsub')) + '</span>';
    tip.classList.add('on');
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 265) + 'px';
    tip.style.top = Math.max(8, e.clientY - 58) + 'px';
  });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'refresh') {
      e.target.textContent = 'Reading…';
      load().then(function () { toast('Board refreshed.'); });
    }
  });

  load();
  setInterval(load, CONFIG.REFRESH_MS);
})();
