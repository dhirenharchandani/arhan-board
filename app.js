/* ============================================================
   Arhan's Application Board — private family board
   Data source: Supabase (Postgres + row level security).
   Sign in by emailed link; only addresses in the members
   table can read or change anything.
   ============================================================ */

var CONFIG = {
  SUPABASE_URL: 'https://rqqlvglkbpqksmaxrmkl.supabase.co',
  /* Publishable key. Safe in the page: row level security decides what anyone can read or write. */
  SUPABASE_KEY: 'sb_publishable_Sn-5-xGI0YjVu6nDg6DC5w_Z284UNc2',

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

  /* ---------- session ---------- */

  var AUTH_KEY = 'arhan-board-session';
  var session = null;

  function b64json(part) {
    var b = part.replace(/-/g, '+').replace(/_/g, '/');
    b += '==='.slice((b.length + 3) % 4);
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function jwtEmail(tok) {
    try { return b64json(tok.split('.')[1]).email || ''; } catch (e) { return ''; }
  }
  function saveSession(s2) {
    session = s2;
    try {
      if (s2) localStorage.setItem(AUTH_KEY, JSON.stringify(s2));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) {}
  }
  function restoreSession() {
    try { session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { session = null; }
  }
  function claimHash() {
    if (!location.hash || location.hash.indexOf('access_token') === -1) return false;
    var p = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    if (!p.access_token) return false;
    saveSession({
      access_token: p.access_token,
      refresh_token: p.refresh_token || '',
      expires_at: Date.now() + (parseInt(p.expires_in, 10) || 3600) * 1000,
      email: jwtEmail(p.access_token)
    });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }
  function refreshSession() {
    if (!session || !session.refresh_token) { saveSession(null); return Promise.resolve(false); }
    return fetch(CONFIG.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: CONFIG.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.access_token) { saveSession(null); return false; }
        saveSession({
          access_token: j.access_token,
          refresh_token: j.refresh_token || session.refresh_token,
          expires_at: Date.now() + ((j.expires_in || 3600) * 1000),
          email: jwtEmail(j.access_token)
        });
        return true;
      })
      .catch(function () { return false; });
  }
  function ensureFresh() {
    if (!session) return Promise.resolve(false);
    if (Date.now() < session.expires_at - 60000) return Promise.resolve(true);
    return refreshSession();
  }
  function sendLink(email) {
    var redirect = location.origin + location.pathname;
    return fetch(CONFIG.SUPABASE_URL + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
      method: 'POST',
      headers: { apikey: CONFIG.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, create_user: true })
    }).then(function (r) {
      if (r.ok) return true;
      return r.json().then(function (j) {
        throw new Error(j.msg || j.error_description || j.error || ('HTTP ' + r.status));
      }, function () { throw new Error('HTTP ' + r.status); });
    });
  }
  function signOut() {
    var tok = session && session.access_token;
    saveSession(null);
    rows = []; loadError = null; lastFetch = null;
    if (tok) {
      fetch(CONFIG.SUPABASE_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: 'Bearer ' + tok }
      }).catch(function () {});
    }
    render();
  }

  /* ---------- rest ---------- */

  function rest(path, opts) {
    opts = opts || {};
    return ensureFresh().then(function (ok) {
      if (!ok) throw new Error('auth');
      var h = {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation'
      };
      return fetch(CONFIG.SUPABASE_URL + '/rest/v1/' + path, {
        method: opts.method || 'GET',
        headers: h,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      });
    }).then(function (r) {
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      if (r.status === 204) return null;
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  /* ---------- mapping ---------- */

  function shape(r) {
    var t = r.ticks || {};
    var items = TICKS.map(function (label) { return { label: label, done: t[label] === true }; });
    var done = items.filter(function (x) { return x.done; }).length;
    return {
      id: r.id,
      name: r.name,
      country: r.country || '',
      round: r.round || '',
      deadline: r.deadline || '',
      date: parseDate(r.deadline),
      checked: !!r.date_checked,
      lead: r.lead || 'Unassigned',
      note: r.notes || '',
      items: items,
      done: done,
      total: items.length,
      pct: items.length ? done / items.length : 0
    };
  }
  function sortRows(list) {
    return list.sort(function (a, b) {
      if (!a.date) return 1; if (!b.date) return -1;
      if (a.date - b.date) return a.date - b.date;
      return a.name.localeCompare(b.name);
    });
  }

  function load() {
    if (!session) { render(); return Promise.resolve(); }
    return rest('rpc/is_board_member', { method: 'POST', body: {} })
      .then(function (isMember) {
        if (isMember !== true) { loadError = 'notmember'; rows = []; render(); return null; }
        return rest('schools?select=*').then(function (list) {
          rows = sortRows((list || []).map(shape));
          loadError = rows.length ? null : 'empty';
          lastFetch = new Date();
          render();
        });
      })
      .catch(function (e) {
        if (String(e.message) === 'auth') { saveSession(null); loadError = null; }
        else { loadError = 'fetch'; console.error('Board load failed:', e); }
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
      return '<li class="tickrow' + (it.done ? ' on' : '') + '" data-tick="' + esc(it.label) + '"' +
        ' role="button" tabindex="0" aria-pressed="' + (it.done ? 'true' : 'false') + '"' +
        ' aria-label="' + esc(it.label + ' — ' + s.name) + '">' +
        '<span class="box"></span><span class="lab">' + esc(it.label) + '</span></li>';
    }).join('');

    return '<article class="card ' + (t ? 'is-' + t : '') + '" data-id="' + esc(s.id) + '">' +
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
      '<div class="card-foot"><div class="notefoot">' + esc(s.note) + '</div>' +
        '<button type="button" class="linkbtn" data-edit="' + esc(s.id) + '">Edit</button></div>' +
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
        '<div class="target"><span>Add a school with a deadline and the clock starts.</span></div></div>';
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
      (loadError === 'notmember' ? '' : '<button type="button" class="cta" id="addschool">Add a school</button>') +
      '</div>' + clock + '</div></header>';
  }

  function loadBlock() {
    var L = loadByLead();
    var bars = L.rows.map(function (r) {
      return '<div class="brow' + (r.n === 0 ? ' zero' : '') + '"><div class="who">' + esc(r.name) + '</div>' +
        '<div class="track"><i style="width:' + (r.n === 0 ? 2 : Math.max(4, r.n / L.max * 100)) + '%"></i></div>' +
        '<div class="v">' + r.n + '</div></div>';
    }).join('');
    return '<div class="bars"><p class="cap">Open items counted against whoever is named as lead for that school. Open a school and change its lead to move the load.</p>' + bars + '</div>';
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
    if (loadError === 'notmember') {
      return '<div class="errorbox"><b>You are signed in, but not on the list for this board.</b>Ask Dhiren to add ' + esc(session ? session.email : 'your address') + ', then sign in again.</div>';
    }
    if (loadError === 'fetch') {
      return '<div class="errorbox"><b>Could not reach the board.</b>That is usually a dropped connection. Press Refresh, and if it keeps failing the database may be paused.</div>';
    }
    if (loadError === 'empty') {
      return '<div class="errorbox"><b>No schools on the board yet.</b>Press <b>Add a school</b> to put the first one up.</div>';
    }
    return '';
  }

  /* ---------- render ---------- */

  function render() {
    if (!session) { renderAuth(); return; }
    var err = errorBlock();
    app.innerHTML =
      '<nav class="topbar"><div class="inner">' +
        '<div class="mark">' + esc(CONFIG.STUDENT) + ' <em>/ applications</em></div>' +
        '<div class="navlinks">' +
          '<a href="#runway" data-nav>Runway</a><a href="#board" data-nav>Board</a>' +
          '<a href="#load" data-nav>Who carries what</a><a href="#cycle" data-nav>The cycle</a>' +
        '</div>' +
        '<button type="button" class="cta small" id="signout">' + esc(session ? session.email : 'Sign out') + '</button>' +
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

        '<p class="colophon">The board is the record. Tick an item and it saves for everyone straight away; the page also re-reads itself every five minutes so another person\u2019s change appears without a reload. Only people on the list can open it. Cycle dates come from the published 2026 to 2027 calendars, and the UCAS equal consideration deadline of 13 January 2027 at 18:00 UK time is confirmed on ucas.com. US dates vary school by school, so a deadline stays marked unchecked until someone confirms it on the school\u2019s own site and ticks it here.</p>' +
      '</main>';

    stamp();
    startClock();
    watchNav();
  }

  function stamp() {
    var el = document.getElementById('stamp');
    if (!el) return;
    el.textContent = lastFetch
      ? 'Last synced at ' + lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

  /* ---------- sign in ---------- */

  function renderAuth() {
    app.innerHTML =
      '<div class="gate"><div class="gatebox">' +
        '<div class="eyebrow">' + esc(CONFIG.ENTRY) + '</div>' +
        '<h1>' + esc(CONFIG.STUDENT) + '’s Application Board</h1>' +
        '<p class="lede">Private to the family. Put in your email and a sign-in link comes back.</p>' +
        '<form id="signin" class="gateform" novalidate>' +
          '<input type="email" id="email" placeholder="you@example.com" autocomplete="email" required>' +
          '<button class="cta" type="submit">Send me a link</button>' +
        '</form>' +
        '<p class="gatenote" id="gatenote">The link lasts an hour. Open it on this device.</p>' +
      '</div></div>';
    var f = document.getElementById('signin');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var em = document.getElementById('email').value.trim();
      var note = document.getElementById('gatenote');
      var btn = f.querySelector('button');
      if (!em || em.indexOf('@') < 1) { note.textContent = 'That does not look like an email address.'; note.className = 'gatenote bad'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      sendLink(em).then(function () {
        note.textContent = 'Link sent to ' + em + '. Open it on this device.';
        note.className = 'gatenote ok';
        btn.textContent = 'Sent';
      }).catch(function (err) {
        note.textContent = 'Could not send that: ' + err.message;
        note.className = 'gatenote bad';
        btn.disabled = false; btn.textContent = 'Send me a link';
      });
    });
  }

  /* ---------- add and edit ---------- */

  var LEADS = ['Arhan', 'Dhiren', 'Unassigned'];
  var openId = null;

  function byId(id) { var f = null; rows.forEach(function (r) { if (r.id === id) f = r; }); return f; }

  function openForm(id) {
    openId = id || null;
    var s2 = id ? byId(id) : null;
    var v = s2 || { name: '', country: '', round: '', deadline: '', lead: 'Arhan', note: '', checked: false };
    var wrap = document.createElement('div');
    wrap.className = 'modal on';
    wrap.id = 'modal';
    wrap.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true">' +
        '<h3>' + (id ? 'Edit ' + esc(v.name) : 'Add a school') + '</h3>' +
        '<form id="schoolform">' +
          '<label>School<input name="name" required value="' + esc(v.name) + '"></label>' +
          '<div class="row2">' +
            '<label>Country<input name="country" value="' + esc(v.country) + '" placeholder="US"></label>' +
            '<label>Round<input name="round" value="' + esc(v.round) + '" placeholder="EA"></label>' +
          '</div>' +
          '<div class="row2">' +
            '<label>Deadline<input name="deadline" type="date" value="' + esc(v.deadline) + '"></label>' +
            '<label>Lead<input name="lead" list="leadlist" value="' + esc(v.lead) + '"></label>' +
          '</div>' +
          '<datalist id="leadlist">' + LEADS.map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') + '</datalist>' +
          '<label>Notes<textarea name="notes" rows="2">' + esc(v.note) + '</textarea></label>' +
          '<label class="chk"><input type="checkbox" name="date_checked"' + (v.checked ? ' checked' : '') + '>' +
            '<span>Deadline confirmed on the school’s own site</span></label>' +
          '<div class="modal-foot">' +
            (id ? '<button type="button" class="linkbtn danger" id="delschool">Remove</button>' : '<span></span>') +
            '<div class="modal-actions">' +
              '<button type="button" class="cta small ghost" id="cancelform">Cancel</button>' +
              '<button type="submit" class="cta small">' + (id ? 'Save' : 'Add') + '</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(wrap);
    var form = document.getElementById('schoolform');
    form.addEventListener('submit', function (ev) { ev.preventDefault(); submitForm(form, openId); });
    var first = form.querySelector('input[name=name]');
    if (first) first.focus();
  }

  function closeForm() {
    var m = document.getElementById('modal');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    openId = null;
  }

  function submitForm(form, id) {
    var fd = new FormData(form);
    var body = {
      name: String(fd.get('name') || '').trim(),
      country: String(fd.get('country') || '').trim(),
      round: String(fd.get('round') || '').trim(),
      deadline: String(fd.get('deadline') || '').trim() || null,
      lead: String(fd.get('lead') || '').trim() || 'Unassigned',
      notes: String(fd.get('notes') || '').trim(),
      date_checked: fd.get('date_checked') === 'on'
    };
    if (!body.name) { toast('A school needs a name.'); return; }
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    var req = id
      ? rest('schools?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: body })
      : rest('schools', { method: 'POST', body: { name: body.name, country: body.country, round: body.round, deadline: body.deadline, lead: body.lead, notes: body.notes, date_checked: body.date_checked, ticks: {} } });
    req.then(function () {
      closeForm();
      toast(id ? 'Saved.' : 'School added.');
      return load();
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = id ? 'Save' : 'Add';
      toast(String(e.message) === 'auth' ? 'Session expired. Sign in again.' : 'Could not save that.');
      if (String(e.message) === 'auth') { closeForm(); render(); }
      else console.error(e);
    });
  }

  function removeSchool(id, btn) {
    var s2 = byId(id);
    if (!s2) return;
    if (btn && btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1');
      btn.textContent = 'Tap again to remove';
      btn.classList.add('armed');
      clearTimeout(removeSchool._t);
      removeSchool._t = setTimeout(function () {
        if (!btn.parentNode) return;
        btn.removeAttribute('data-armed');
        btn.textContent = 'Remove';
        btn.classList.remove('armed');
      }, 4000);
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }
    rest('schools?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' })
      .then(function () { closeForm(); toast('Removed.'); return load(); })
      .catch(function (e) { toast('Could not remove that.'); console.error(e); });
  }

  function recompute(s2) {
    s2.done = s2.items.filter(function (x) { return x.done; }).length;
    s2.pct = s2.total ? s2.done / s2.total : 0;
  }

  function toggleTick(id, label) {
    var s2 = byId(id);
    if (!s2) return;
    var hit = null;
    s2.items.forEach(function (x) { if (x.label === label) hit = x; });
    if (!hit) return;
    hit.done = !hit.done;
    recompute(s2);
    render();
    var payload = {};
    s2.items.forEach(function (x) { payload[x.label] = x.done; });
    rest('schools?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { ticks: payload }, prefer: 'return=minimal' })
      .catch(function (e) {
        if (String(e.message) === 'auth') { toast('Session expired. Sign in again.'); render(); return; }
        toast('That did not save. Reloading the board.');
        console.error(e);
        load();
      });
  }

  /* ---------- events ---------- */

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;

    if (t.id === 'refresh') {
      t.textContent = 'Reading…';
      load().then(function () { toast('Board refreshed.'); });
      return;
    }
    if (t.id === 'signout') { signOut(); return; }
    if (t.id === 'addschool') { openForm(null); return; }
    if (t.id === 'cancelform') { closeForm(); return; }
    if (t.id === 'delschool') { removeSchool(openId, t); return; }
    if (t.id === 'modal') { closeForm(); return; }

    var ed = t.closest ? t.closest('[data-edit]') : null;
    if (ed) { openForm(ed.getAttribute('data-edit')); return; }

    var row = t.closest ? t.closest('.tickrow') : null;
    if (row) {
      var card = row.closest('[data-id]');
      if (card) toggleTick(card.getAttribute('data-id'), row.getAttribute('data-tick'));
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('modal')) { closeForm(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target && e.target.closest ? e.target.closest('.tickrow') : null;
    if (!row) return;
    e.preventDefault();
    var card = row.closest('[data-id]');
    if (card) toggleTick(card.getAttribute('data-id'), row.getAttribute('data-tick'));
  });

  restoreSession();
  claimHash();
  render();
  load();
  setInterval(function () { if (session) load(); }, CONFIG.REFRESH_MS);
})();
