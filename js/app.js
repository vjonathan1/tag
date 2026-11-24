// ─────────────────────────────────────────────────────────────
//  TAG//OPS — player app
//
//  Data model (Realtime Database):
//    meta/players/{id}  { name, order }          roster (written once by setup.html)
//    meta/uids/{uid}    "<player id>"            Firebase Auth uid → player
//    game/start         { it, at }               who was IT when the game began
//    game/log[]         { from, to, at, confirmedAt, via }   confirmed tags, in order
//    game/voided[]      { from, to, at, resolvedAt, votes }  tags rejected by audit or voided by an admin
//    game/undone[]      confirmed tags an admin rolled back
//    meta/admins/{uid}  true                     command-console access
//    logins/{id}        "<id>.r<stamp>"          (public) current login id after an admin reset
//    game/pending       { from, to, at, status: "awaiting"|"audit", reason?, auditAt?, votes? }
//
//  Who is IT, how long, and the leaderboard are DERIVED from start + log every time,
//  so totals can never drift out of sync with the history.
// ─────────────────────────────────────────────────────────────
import { PLAYERS, RESPONSE_TIMEOUT_MIN, isConfigured } from "./config.js";

const DEMO = new URLSearchParams(location.search).has("demo");
const LS = DEMO ? "tagops-demo-" : "tagops-";
const TIMEOUT = RESPONSE_TIMEOUT_MIN * 60_000;
// Human-readable response window, e.g. "1 hour", "90 minutes".
const WINDOW = RESPONSE_TIMEOUT_MIN % 60 === 0
  ? `${RESPONSE_TIMEOUT_MIN / 60} hour${RESPONSE_TIMEOUT_MIN === 60 ? "" : "s"}`
  : `${RESPONSE_TIMEOUT_MIN} minutes`;

const $app = document.getElementById("app");
const $modal = document.getElementById("modal-root");

const S = {
  backend: null, creds: {}, user: null, me: null, meta: null, game: null,
  subs: [], screen: "loading", message: "", busy: false, confirm: null,
  dismissed: new Set(), alerted: new Set(), escalating: new Set(), primed: false, modalKey: null,
};

// ── Small utilities ──────────────────────────────────────────
const store = {
  get(k) { try { return localStorage.getItem(LS + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(LS + k) : localStorage.setItem(LS + k, v); } catch {} },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => (S.backend ? S.backend.now() : Date.now());
const pad = (n) => String(n).padStart(2, "0");
const toArr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : []);
const pkey = (p) => `${p.from}>${p.to}@${p.at}`;
const rosterName = (id) => PLAYERS.find((p) => p.id === id)?.name || id;
const name = (id) => S.meta?.players?.[id]?.name || rosterName(id);
const initials = (id) => name(id).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const playerIds = () => Object.entries(S.meta?.players || {})
  .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0)).map(([id]) => id);

function clockHTML(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const sep = '<span class="sep">:</span>';
  return `${d ? `${d}<span class="u">d</span>` : ""}${pad(h)}${sep}${pad(m)}${sep}${pad(s % 60)}`;
}
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h) return `${h}h ${pad(m)}m ${pad(s % 60)}s`;
  return `${m}m ${pad(s % 60)}s`;
}
function ago(ts) {
  const s = Math.max(0, Math.floor((now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
function countdown(ts) {
  const s = Math.max(0, Math.floor((ts - now()) / 1000));
  return s <= 0 ? "now" : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
const fmtWhen = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Game derivation ──────────────────────────────────────────
function derive(g) {
  const ids = playerIds();
  const totals = Object.fromEntries(ids.map((i) => [i, 0]));
  const stints = Object.fromEntries(ids.map((i) => [i, 0]));
  const log = toArr(g.log);
  let it = g.start.it, since = g.start.at;
  stints[it] = (stints[it] || 0) + 1;
  for (const t of log) {
    totals[t.from] = (totals[t.from] || 0) + Math.max(0, t.at - since);
    it = t.to; since = Math.max(since, t.at);
    stints[it] = (stints[it] || 0) + 1;
  }
  return { it, since, log, totals, stints, last: log[log.length - 1] || null };
}
function liveTotals(d) {
  const t = { ...d.totals };
  t[d.it] = (t[d.it] || 0) + Math.max(0, now() - d.since);
  return t;
}
function tally(p) {
  const voters = playerIds().filter((i) => i !== p.from && i !== p.to);
  const votes = p.votes || {};
  let yes = 0, no = 0;
  for (const v of voters) { if (votes[v] === true) yes++; else if (votes[v] === false) no++; }
  return { voters, votes, yes, no, need: Math.floor(voters.length / 2) + 1 };
}

// ── Actions (each is an atomic transaction on /game) ─────────
// Every op re-checks the rules against the *latest* server state; returning undefined aborts.
function finalize(g, via) {
  const p = g.pending, log = toArr(g.log);
  log.push({ from: p.from, to: p.to, at: p.at, confirmedAt: now(), via, ...(p.votes ? { votes: p.votes } : {}) });
  g.log = log; delete g.pending;
  return g;
}
function voidTag(g) {
  const p = g.pending, voided = toArr(g.voided);
  voided.push({ from: p.from, to: p.to, at: p.at, resolvedAt: now(), votes: p.votes || {} });
  g.voided = voided; delete g.pending;
  return g;
}
const ops = {
  tag: (target) => (g) => {
    if (!g?.start || g.pending) return;
    const d = derive(g);
    if (d.it !== S.me || target === S.me || !S.meta.players[target]) return;
    g.pending = { from: S.me, to: target, at: Math.max(now(), d.since), status: "awaiting" };
    return g;
  },
  retract: () => (g) => { if (g?.pending?.from !== S.me) return; delete g.pending; return g; },
  accept: () => (g) => { if (g?.pending?.to !== S.me) return; return finalize(g, g.pending.status === "audit" ? "conceded" : "accepted"); },
  dispute: () => (g) => {
    const p = g?.pending;
    if (!p || p.to !== S.me || p.status !== "awaiting") return;
    Object.assign(p, { status: "audit", reason: "disputed", auditAt: now() });
    return g;
  },
  escalate: (key) => (g) => {
    const p = g?.pending;
    if (!p || p.status !== "awaiting" || pkey(p) !== key || now() - p.at < TIMEOUT) return;
    Object.assign(p, { status: "audit", reason: "timeout", auditAt: now() });
    return g;
  },
  vote: (v) => (g) => {
    const p = g?.pending;
    if (!p || p.status !== "audit" || p.from === S.me || p.to === S.me) return;
    p.votes = { ...(p.votes || {}), [S.me]: v };
    const t = tally(p);
    if (t.yes >= t.need) return finalize(g, "audit");
    if (t.no >= t.need) return voidTag(g);
    return g;
  },
  // ── Admin overrides ──
  adminConfirm: (key) => (g) => { if (!g?.pending || pkey(g.pending) !== key) return; return finalize(g, "admin"); },
  adminVoid: (key) => (g) => { if (!g?.pending || pkey(g.pending) !== key) return; return voidTag(g); },
  adminUndo: (key) => (g) => {
    const log = toArr(g?.log);
    if (g?.pending || !log.length || pkey(log[log.length - 1]) !== key) return;
    const undone = toArr(g.undone);
    undone.push({ ...log.pop(), undoneAt: now(), by: S.me });
    g.log = log; g.undone = undone;
    return g;
  },
};
const isAdmin = () => S.meta?.admins?.[S.user?.uid] === true;
async function run(op) {
  if (S.busy) return;
  S.busy = true;
  try {
    const ok = await S.backend.transact(op);
    if (!ok) toast("Status changed before your action went through — refreshed.");
  } catch (e) {
    console.error(e);
    toast(`Transmission failed (${e.code || e.message}).`);
  } finally { S.busy = false; }
}

// ── Credentials & auth ───────────────────────────────────────
// Everyone shares one link. The device remembers which agent last signed in here,
// purely to pre-select the name on the login screen (it is not a credential).
function readCreds() {
  const h = new URLSearchParams(location.hash.slice(1));
  const agent = h.get("agent");
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  if (agent && PLAYERS.some((p) => p.id === agent)) store.set("agent", agent);
  store.set("key", null); // clean up from the old per-player-link version
  return { agent: store.get("agent") };
}

function unsubscribeAll() { S.subs.forEach((u) => { try { u(); } catch {} }); S.subs = []; }

function onAuth(user) {
  unsubscribeAll();
  S.user = user; S.meta = null; S.game = null; S.me = null; S.primed = false;
  if (!user) return show("login");
  if (user.agent) { S.creds.agent = user.agent; store.set("agent", user.agent); }
  show("loading");
  const denied = (err) => {
    console.error(err);
    show("error", "This login no longer has access. If an admin reset your password, sign out and sign in with the new one.");
  };
  S.subs.push(S.backend.watchMeta((meta) => {
    S.meta = meta;
    S.me = meta?.uids?.[user.uid] || null;
    if (!meta) return show("error", "The operation hasn't been initialized yet. Ask your admin to run setup.html.");
    if (!S.me) return show("error", "This login no longer has access. If an admin reset your password, sign out and sign in with the new one.");
    if (S.game) show("main");
  }, denied));
  S.subs.push(S.backend.watchGame((game) => {
    S.game = game;
    if (!game?.start) { if (S.meta) show("error", "No game data found. Ask your admin to run setup.html."); return; }
    if (S.meta && S.me) show("main");
    checkAlerts();
  }, denied));
}

const authError = (e) => {
  const code = e.code || "";
  return code.includes("too-many-requests") ? "Too many attempts. Wait a few minutes and try again."
    : code.includes("network") ? "Network error. Check your connection."
    : code.includes("weak-password") ? "Password must be at least 6 characters."
    : code.includes("requires-recent-login") ? "Please sign out and back in, then try again."
    : "Access denied. Check your name and password.";
};

async function login(agent, password, $err, $btn) {
  if (!agent) { $err.textContent = "Select your name."; return; }
  $btn.disabled = true; $err.textContent = "";
  S.creds.agent = agent; store.set("agent", agent);
  try {
    await S.backend.signIn(agent, password);
  } catch (e) {
    $err.textContent = authError(e);
    $btn.disabled = false;
  }
}

async function changePassword(form) {
  const $err = form.querySelector(".err"), $btn = form.querySelector("button[type=submit]");
  const cur = form.cur.value, next = form.next.value;
  if (next.length < 6) { $err.textContent = "New password must be at least 6 characters."; return; }
  if (next !== form.next2.value) { $err.textContent = "New passwords don't match."; return; }
  $btn.disabled = true; $err.textContent = "";
  try {
    await S.backend.changePassword(cur, next);
    S.pwModal = false; renderModal();
    toast("Password updated. Other devices stay signed in.");
  } catch (e) {
    $err.textContent = authError(e);
    $btn.disabled = false;
  }
}

const WORDS = "amber,anchor,atlas,blade,cipher,cobalt,comet,delta,echo,ember,falcon,ghost,glacier,harbor,jade,kite,lynx,maple,nova,onyx,orbit,pixel,quartz,raven,shadow,signal,sonar,talon,tundra,vector,viper,zephyr".split(",");
const pick = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const genPassword = () => `${WORDS[pick(WORDS.length)]}-${WORDS[pick(WORDS.length)]}-${10 + pick(90)}`;

async function adminReset(form) {
  const $err = form.querySelector(".err"), $btn = form.querySelector("button[type=submit]");
  const pid = form.pid.value, pw = form.pw.value.trim();
  if (pw.length < 6) { $err.textContent = "Password must be at least 6 characters."; return; }
  if (!confirm(`Reset ${name(pid)}'s password? They'll be signed out on every device.`)) return;
  $btn.disabled = true; $err.textContent = "";
  try {
    await S.backend.resetPassword(pid, pw, S.meta);
    S.lastReset = { pid, pw };
    form.reset();
    renderMain();
  } catch (e) {
    console.error(e);
    $err.textContent = `Reset failed (${e.code || e.message}).`;
    $btn.disabled = false;
  }
}

async function disconnect() {
  if (!confirm("Sign out on this device? You'll need your password to sign back in.")) return;
  await S.backend.signOut();
}

// ── Rendering ────────────────────────────────────────────────
const ICON_LOCK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg>';
const ICON_ALERT = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18v.5"/></svg>';
const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function show(screen, message = "") {
  S.screen = screen; S.message = message;
  render();
}

function gate(icon, eyebrow, title, body) {
  return `<div class="gate-wrap"><div class="card gate">
    <div class="gate-icon">${icon}</div>
    <div class="eyebrow">${eyebrow}</div>
    <h1>${title}</h1>${body}</div></div>`;
}

function render() {
  document.body.classList.toggle("demo", DEMO);
  if (S.screen !== "main") document.body.classList.remove("mode-it");

  switch (S.screen) {
    case "loading":
      $app.innerHTML = `<div class="gate-wrap"><div class="gate"><div class="loader"></div><div class="eyebrow">Establishing secure channel…</div></div></div>`;
      break;
    case "unconfigured":
      $app.innerHTML = gate(ICON_ALERT, "System offline", "Firebase isn't configured yet",
        `<p>Paste your Firebase config into <code>js/config.js</code> (see README.md), then run <code>setup.html</code>.</p>
         <a class="btn btn-primary" href="?demo">Preview demo mode</a>`);
      break;
    case "login": {
      const known = PLAYERS.some((p) => p.id === S.creds.agent);
      $app.innerHTML = gate(ICON_LOCK, "Secure channel · Identity check",
        known ? `Welcome back, Agent ${esc(rosterName(S.creds.agent).split(" ").slice(-1)[0])}` : "Identify yourself, agent",
        `<p>Sign in with your personal password. This device will remember you after this.</p>
         <form id="login-form" autocomplete="on">
           <select class="field" id="agent" name="username" autocomplete="username" required aria-label="Your name">
             <option value="" ${known ? "" : "selected"} disabled>Who are you?</option>
             ${PLAYERS.map((p) => `<option value="${esc(p.id)}" ${p.id === S.creds.agent ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
           </select>
           <input class="field" id="pass" type="password" name="password" autocomplete="current-password"
                  placeholder="${DEMO ? "Demo: any password" : "Password"}" required aria-label="Password">
           <button class="btn btn-primary" type="submit">Authenticate</button>
           <p class="err" id="login-err" role="alert"></p>
         </form>`);
      const $f = document.getElementById("login-form");
      document.getElementById(known ? "pass" : "agent").focus();
      $f.addEventListener("submit", (e) => {
        e.preventDefault();
        login($f.agent.value, $f.pass.value, document.getElementById("login-err"), $f.querySelector("button"));
      });
      break;
    }
    case "error":
      $app.innerHTML = gate(ICON_ALERT, "Channel error", "Access unavailable",
        `<p>${esc(S.message)}</p><button class="btn" data-act="disconnect">Sign out</button>`);
      break;
    case "main":
      renderMain();
      break;
  }
  renderDemoBar();
  renderModal();
}

function renderMain() {
  const g = S.game, d = derive(g), me = S.me, isIt = d.it === me, p = g.pending;
  document.body.classList.toggle("mode-it", isIt);
  document.title = isIt ? "● YOU ARE IT — TAG//OPS" : "TAG//OPS";

  const hero = `
    <section class="card hero">
      <span class="reticle tl"></span><span class="reticle tr"></span><span class="reticle bl"></span><span class="reticle br"></span>
      <div class="hero-top">
        <span class="eyebrow"><span class="pulse"></span>${isIt ? "Priority alert · You are the tagger" : "Live feed · Current tagger"}</span>
        <span class="case-no mono">CASE TAG-${String(d.log.length + 1).padStart(3, "0")}</span>
      </div>
      ${isIt
        ? `<h1 class="hero-name">You are <em>IT</em></h1><p class="hero-sub">You have been IT for</p>`
        : `<h1 class="hero-name">${esc(name(d.it))}</h1><p class="hero-sub">has been IT for</p>`}
      <div class="timer" id="main-timer" role="timer">${clockHTML(now() - d.since)}</div>
      <div class="hero-meta">
        ${d.last
          ? `<span>Tagged by <b>${esc(name(d.last.from))}</b></span><span class="mono">${fmtWhen(d.last.at)}</span>`
          : `<span>Started the operation as IT</span><span class="mono">${fmtWhen(g.start.at)}</span>`}
      </div>
      ${isIt ? '<div class="stamp" aria-hidden="true">Tagger</div>' : ""}
    </section>`;

  const targets = isIt && !p ? targetsHTML(d) : "";

  // Keep anything typed into the admin form across live re-renders.
  const $rf = document.getElementById("reset-form");
  const keep = $rf ? { pid: $rf.pid.value, pw: $rf.pw.value, open: document.getElementById("admin-console")?.open } : null;

  $app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark"></span>TAG<span>//</span>OPS</div>
      <div class="agent-chip"><span class="dot"></span><span class="lbl">Agent</span><b>${esc(name(me))}</b></div>
    </header>
    <main class="wrap">
      <div class="stack">${hero}${pendingHTML(p)}${targets}</div>
      <div class="cols">
        <section class="card">
          <div class="card-head"><h2>Recent tags</h2><span class="mono dim">Last 3</span></div>
          <ul class="list">${historyHTML(d)}</ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Leaderboard</h2><span class="mono dim">Total time IT</span></div>
          <ul class="list" id="lb-body">${leaderboardHTML(d)}</ul>
          <p class="lb-note">Includes every stint as IT. The live stint keeps counting.</p>
        </section>
      </div>
      ${isAdmin() ? adminHTML(d, p) : ""}
      <footer class="foot">
        <span>TAG//OPS · ${playerIds().length} agents · ${d.log.length} confirmed tags</span>
        <span class="foot-actions">
          ${"Notification" in window && Notification.permission === "default"
            ? '<button class="btn-link" data-act="alerts">Enable alerts</button>' : ""}
          <button class="btn-link" data-act="change-pw">Change password</button>
          <button class="btn-link" data-act="disconnect">Sign out</button>
        </span>
      </footer>
    </main>`;

  const $nf = document.getElementById("reset-form");
  if ($nf && keep) {
    if (keep.pid) $nf.pid.value = keep.pid;
    $nf.pw.value = keep.pw;
    if (keep.open !== undefined) document.getElementById("admin-console").open = keep.open;
  }
}

function adminHTML(d, p) {
  const others = playerIds().filter((i) => i !== S.me);
  const r = S.lastReset;
  const last = d.last;
  return `
    <details class="card admin-card" id="admin-console" ${r ? "open" : ""}>
      <summary class="card-head"><h2>Command console</h2><span class="mono dim">Admin only ▾</span></summary>
      <div class="admin-grid">
        <div class="admin-block">
          <h3>Reset a password</h3>
          ${r ? `<div class="warnbox" style="margin-bottom:12px">
              <b>${esc(name(r.pid))}</b>'s new password: <code class="mono">${esc(r.pw)}</code>
              <div class="actions" style="margin-top:10px"><button class="btn btn-sm" data-act="copy-reset">Copy message</button>
              <button class="btn btn-sm btn-ghost" data-act="clear-reset">Done</button></div></div>` : ""}
          <form id="reset-form" autocomplete="off" style="display:grid;gap:10px">
            <select class="field" name="pid" aria-label="Player">${others.map((id) => `<option value="${esc(id)}">${esc(name(id))}</option>`).join("")}</select>
            <div style="display:flex;gap:8px">
              <input class="field" name="pw" type="text" minlength="6" required spellcheck="false" placeholder="New password" aria-label="New password">
              <button class="btn btn-sm" type="button" data-act="gen-pw">Generate</button>
            </div>
            <button class="btn btn-primary" type="submit">Reset password</button>
            <p class="err" role="alert"></p>
          </form>
          <p class="hint">Signs them out everywhere. To change your own password, use <b>Change password</b> below.</p>
        </div>
        <div class="admin-block">
          <h3>Pending tag</h3>
          ${p ? `<p>${esc(name(p.from))} → ${esc(name(p.to))} · ${p.status === "audit" ? "in audit" : "awaiting reply"} · ${fmtWhen(p.at)}</p>
              <div class="actions"><button class="btn btn-sm" data-act="admin-void">Void it</button>
              <button class="btn btn-sm btn-primary" data-act="admin-confirm">Force confirm</button></div>`
            : `<p class="dim">Nothing pending.</p>`}
        </div>
        <div class="admin-block">
          <h3>Undo last tag</h3>
          ${last && !p ? `<p>${esc(name(last.from))} → ${esc(name(last.to))} · ${fmtWhen(last.at)}</p>
              <div class="actions"><button class="btn btn-sm" data-act="admin-undo">Undo this tag</button></div>
              <p class="hint">IT goes back to ${esc(name(last.from))} and their timer resumes from the original time.</p>`
            : `<p class="dim">${p ? "Resolve the pending tag first." : "No tags to undo."}</p>`}
        </div>
      </div>
    </details>`;
}

function targetsHTML(d) {
  const lt = liveTotals(d);
  const others = playerIds().filter((i) => i !== S.me);
  return `
    <section class="card targets-card">
      <div class="card-head"><h2>Select target</h2><span class="mono dim">${others.length} agents in field</span></div>
      <div class="targets">
        ${others.map((id) => `
          <div class="target">
            <div class="avatar">${esc(initials(id))}</div>
            <div class="t-info"><b>${esc(name(id))}</b><small class="mono">Total IT ${fmtDur(lt[id] || 0)}</small></div>
            <button class="btn btn-tag" data-act="tag" data-id="${esc(id)}">Tag</button>
          </div>`).join("")}
      </div>
      <p class="hint">Only tag after real contact. Your target has to confirm it, or the squad votes on it.</p>
    </section>`;
}

function pendingHTML(p) {
  if (!p) return "";
  const from = `<b>${esc(name(p.from))}</b>`, to = `<b>${esc(name(p.to))}</b>`;
  if (p.status === "awaiting") {
    let title, actions = "";
    if (p.from === S.me) {
      title = `Waiting for ${to} to confirm your tag`;
      actions = `<button class="btn" data-act="retract">Retract tag</button>`;
    } else if (p.to === S.me) {
      title = `${from} says they tagged you`;
      actions = `<button class="btn btn-ghost" data-act="dispute">Dispute</button>
                 <button class="btn btn-primary" data-act="accept">Accept tag</button>`;
    } else {
      title = `${from} reports a tag on ${to}`;
    }
    return `
      <section class="card alert-card">
        <span class="eyebrow"><span class="pulse"></span>Tag pending confirmation</span>
        <div class="alert-title">${title}</div>
        <div class="alert-meta">Reported <span data-ago="${p.at}">${ago(p.at)}</span> · goes to audit in <span data-countdown="${p.at + TIMEOUT}">${countdown(p.at + TIMEOUT)}</span> if not accepted</div>
        ${actions ? `<div class="actions">${actions}</div>` : ""}
      </section>`;
  }
  // Audit
  const t = tally(p), mine = t.votes[S.me];
  const reason = p.reason === "timeout"
    ? `${to} didn't respond within ${WINDOW}.`
    : `${to} disputed the tag.`;
  let actions = "";
  if (t.voters.includes(S.me)) {
    actions = `<button class="btn ${mine === false ? "on" : ""}" data-act="vote" data-v="no">No, it didn't happen</button>
               <button class="btn ${mine === true ? "on" : ""}" data-act="vote" data-v="yes">Yes, it happened</button>`;
  } else if (p.to === S.me) {
    actions = `<button class="btn" data-act="accept">Concede — accept the tag</button>`;
  } else if (p.from === S.me) {
    actions = `<button class="btn" data-act="retract">Withdraw claim</button>`;
  }
  return `
    <section class="card alert-card">
      <span class="eyebrow"><span class="pulse"></span>Audit in progress</span>
      <div class="alert-title">Did ${from} tag ${to}?</div>
      <div class="alert-meta">${reason} Reported ${fmtWhen(p.at)}. ${t.need} matching votes decide it.</div>
      <div class="pips">
        ${t.voters.map((v) => `<span class="pip ${t.votes[v] === true ? "yes" : t.votes[v] === false ? "no" : ""}"><i></i>${esc(name(v).split(" ")[0])}</span>`).join("")}
      </div>
      <div class="tally"><span>Yes <b>${t.yes}</b></span><span>No <b>${t.no}</b></span><span>Needed <b>${t.need}</b></span></div>
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </section>`;
}

function historyHTML(d) {
  const recent = d.log.slice(-3).reverse();
  if (!recent.length) return `<li class="empty">No tags on record yet. ${esc(name(S.game.start.it))} started as IT.</li>`;
  const label = { audit: ["Audit verified", "badge-audit"], conceded: ["Conceded", "badge-audit"], admin: ["Admin confirmed", "badge-audit"] };
  return recent.map((t) => {
    const [txt, cls] = label[t.via] || ["Confirmed", ""];
    return `
      <li class="h-item">
        <div class="h-avatars"><span class="avatar sm">${esc(initials(t.from))}</span>${ARROW}<span class="avatar sm hot">${esc(initials(t.to))}</span></div>
        <div class="h-text">
          <div><b>${esc(name(t.from))}</b> tagged <b>${esc(name(t.to))}</b></div>
          <small class="mono">${fmtWhen(t.at)} · <span data-ago="${t.at}">${ago(t.at)}</span></small>
        </div>
        <span class="badge ${cls}">${txt}</span>
      </li>`;
  }).join("");
}

function leaderboardHTML(d) {
  const lt = liveTotals(d);
  const rows = playerIds().map((id) => ({ id, ms: lt[id] || 0 })).sort((a, b) => b.ms - a.ms);
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return rows.map((r, i) => `
    <li class="lb-row ${r.id === d.it ? "live" : ""} ${r.id === S.me ? "self" : ""}">
      <span class="lb-rank mono">${pad(i + 1)}</span>
      <div class="lb-main">
        <div class="lb-line">
          <span class="lb-name">${esc(name(r.id))}${r.id === d.it ? '<i class="it">IT</i>' : ""}${r.id === S.me ? "<i>You</i>" : ""}</span>
          <span class="lb-time mono">${fmtDur(r.ms)}<small>×${d.stints[r.id] || 0}</small></span>
        </div>
        <div class="lb-bar"><span style="width:${((r.ms / max) * 100).toFixed(1)}%"></span></div>
      </div>
    </li>`).join("");
}

// ── Modals ───────────────────────────────────────────────────
function modalSpec() {
  if (S.screen !== "main") return null;
  if (S.pwModal) {
    return {
      key: "pw", cls: "",
      html: `<span class="eyebrow">Credentials</span>
        <h2>Change your password</h2>
        <form id="pw-form" style="display:grid;gap:10px;margin-top:14px">
          <input type="text" name="username" autocomplete="username" value="${esc(S.me)}" hidden>
          <input class="field" name="cur" type="password" autocomplete="current-password" placeholder="Current password" required aria-label="Current password">
          <input class="field" name="next" type="password" autocomplete="new-password" placeholder="New password (6+ characters)" minlength="6" required aria-label="New password">
          <input class="field" name="next2" type="password" autocomplete="new-password" placeholder="Confirm new password" minlength="6" required aria-label="Confirm new password">
          <p class="err" role="alert"></p>
          <div class="actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-act="close-pw">Cancel</button>
          <button class="btn btn-primary" type="submit">Update</button></div>
        </form>`,
    };
  }
  if (S.confirm) {
    return {
      key: "confirm:" + S.confirm, cls: "danger",
      html: `<span class="eyebrow" style="color:var(--red)">Confirm engagement</span>
        <h2>Tag ${esc(name(S.confirm))}?</h2>
        <p>They'll be asked to confirm. If they don't accept within ${WINDOW}, the rest of the squad audits it.</p>
        <div class="actions"><button class="btn btn-ghost" data-act="cancel-confirm">Abort</button>
        <button class="btn btn-red" data-act="confirm-tag">Confirm tag</button></div>`,
    };
  }
  const p = S.game?.pending;
  if (!p) return null;
  const key = pkey(p) + ":" + p.status;
  if (S.dismissed.has(key)) return null;
  if (p.status === "awaiting" && p.to === S.me) {
    return {
      key, cls: "warn",
      html: `<span class="eyebrow" style="color:var(--amber)">Incoming tag</span>
        <h2>${esc(name(p.from))} says they tagged you</h2>
        <p>Reported ${fmtWhen(p.at)}. Accept if it happened. If you dispute it, the other agents vote.</p>
        <div class="actions"><button class="btn btn-ghost" data-act="dispute">Dispute</button>
        <button class="btn btn-primary" data-act="accept">Accept tag</button></div>
        <button class="btn-link later" data-act="later" data-key="${esc(key)}">Decide later</button>`,
    };
  }
  if (p.status === "audit" && tally(p).voters.includes(S.me) && p.votes?.[S.me] === undefined) {
    return {
      key, cls: "warn",
      html: `<span class="eyebrow" style="color:var(--amber)">Audit requested</span>
        <h2>Did ${esc(name(p.from))} tag ${esc(name(p.to))}?</h2>
        <p>${p.reason === "timeout" ? `${esc(name(p.to))} didn't respond in time.` : `${esc(name(p.to))} disputed it.`} Your vote helps decide. Reported ${fmtWhen(p.at)}.</p>
        <div class="actions"><button class="btn" data-act="vote" data-v="no">No</button>
        <button class="btn btn-primary" data-act="vote" data-v="yes">Yes, it happened</button></div>
        <button class="btn-link later" data-act="later" data-key="${esc(key)}">Not sure — skip for now</button>`,
    };
  }
  return null;
}

function renderModal() {
  const m = modalSpec();
  const key = m?.key || null;
  if (key === S.modalKey) return;
  S.modalKey = key;
  $modal.innerHTML = m
    ? `<div class="overlay" role="dialog" aria-modal="true"><div class="card modal ${m.cls}">${m.html}</div></div>`
    : "";
  ($modal.querySelector("input:not([hidden])") || $modal.querySelector(".btn-primary, .btn-red"))?.focus();
}

// ── Alerts (browser notifications while the page is open) ────
function checkAlerts() {
  if (!S.game?.start || !S.me || !S.meta) return;
  const p = S.game.pending;
  let key = null, title = "", body = "";
  if (p?.status === "awaiting" && p.to === S.me) {
    key = "in:" + pkey(p); title = `${name(p.from)} says they tagged you`; body = "Open TAG//OPS to accept or dispute.";
  } else if (p?.status === "audit" && tally(p).voters.includes(S.me) && p.votes?.[S.me] === undefined) {
    key = "au:" + pkey(p); title = "Audit requested"; body = `Did ${name(p.from)} tag ${name(p.to)}? Cast your vote.`;
  } else {
    const d = derive(S.game);
    if (d.last?.to === S.me) { key = "it:" + pkey(d.last); title = "You are IT"; body = `${name(d.last.from)}'s tag was confirmed.`; }
  }
  if (!S.primed) { if (key) S.alerted.add(key); S.primed = true; return; } // no alert for what was already true at load
  if (!key || S.alerted.has(key)) return;
  S.alerted.add(key);
  try { navigator.vibrate?.([120, 60, 120]); } catch {}
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, tag: key }); } catch {}
  }
}

// ── Demo bar ─────────────────────────────────────────────────
function renderDemoBar() {
  if (!DEMO) return;
  let bar = document.querySelector(".demo-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.innerHTML = `<span>Demo</span>
      <select aria-label="View as agent">${PLAYERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
      <button class="btn btn-sm" data-act="demo-reset">Reset</button>`;
    document.body.appendChild(bar);
    bar.querySelector("select").addEventListener("change", async (e) => {
      S.creds = { agent: e.target.value };
      store.set("agent", e.target.value);
      await S.backend.signOut();
      await S.backend.signIn(e.target.value);
    });
  }
  const sel = bar.querySelector("select");
  sel.value = S.me || S.creds.agent || "";
}

// ── Events ───────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case "tag": S.confirm = el.dataset.id; renderModal(); break;
    case "cancel-confirm": S.confirm = null; renderModal(); break;
    case "confirm-tag": { const t = S.confirm; S.confirm = null; renderModal(); run(ops.tag(t)); break; }
    case "retract": run(ops.retract()); break;
    case "accept": run(ops.accept()); break;
    case "dispute": run(ops.dispute()); break;
    case "vote": run(ops.vote(el.dataset.v === "yes")); break;
    case "later": S.dismissed.add(el.dataset.key); renderModal(); break;
    case "disconnect": disconnect(); break;
    case "change-pw": S.pwModal = true; renderModal(); break;
    case "close-pw": S.pwModal = false; renderModal(); break;
    case "gen-pw": document.getElementById("reset-form").pw.value = genPassword(); break;
    case "copy-reset": {
      const r = S.lastReset;
      const msg = `Your TAG//OPS password was reset. Sign out if you're still signed in, then pick "${name(r.pid)}" and sign in with: ${r.pw}\n${new URL("./", location.href).href}`;
      navigator.clipboard.writeText(msg).then(() => toast("Message copied."), () => toast("Couldn't copy — select the password manually."));
      break;
    }
    case "clear-reset": S.lastReset = null; renderMain(); break;
    case "admin-confirm": case "admin-void": {
      const p = S.game?.pending;
      if (!p) break;
      const verb = act === "admin-confirm" ? "Force-confirm" : "Void";
      if (!confirm(`${verb} ${name(p.from)}'s tag on ${name(p.to)}? This skips the normal accept/audit process.`)) break;
      run((act === "admin-confirm" ? ops.adminConfirm : ops.adminVoid)(pkey(p)));
      break;
    }
    case "admin-undo": {
      const last = derive(S.game).last;
      if (!last || !confirm(`Undo ${name(last.from)}'s tag on ${name(last.to)}? ${name(last.from)} becomes IT again.`)) break;
      run(ops.adminUndo(pkey(last)));
      break;
    }
    case "alerts": Notification.requestPermission().then(() => render()); break;
    case "demo-reset": S.backend.reset?.(); toast("Demo data reset."); break;
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "pw-form") { e.preventDefault(); changePassword(e.target); }
  if (e.target.id === "reset-form") { e.preventDefault(); adminReset(e.target); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (S.confirm || S.pwModal)) { S.confirm = null; S.pwModal = false; renderModal(); }
});

// ── Clock tick: live timers, leaderboard, auto-escalation ───
function tick() {
  if (S.screen !== "main" || !S.game?.start) return;
  const d = derive(S.game);
  const t = document.getElementById("main-timer");
  if (t) t.innerHTML = clockHTML(now() - d.since);
  const lb = document.getElementById("lb-body");
  if (lb) lb.innerHTML = leaderboardHTML(d);
  document.querySelectorAll("[data-ago]").forEach((el) => { el.textContent = ago(+el.dataset.ago); });
  document.querySelectorAll("[data-countdown]").forEach((el) => { el.textContent = countdown(+el.dataset.countdown); });

  // Any open client can push an unanswered tag into audit once the response window passes.
  const p = S.game.pending;
  if (p?.status === "awaiting" && now() - p.at >= TIMEOUT) {
    const k = pkey(p);
    if (!S.escalating.has(k)) { S.escalating.add(k); run(ops.escalate(k)); }
  }
}

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  S.creds = readCreds();
  if (!DEMO && !isConfigured()) return show("unconfigured");
  show("loading");
  try {
    const mod = DEMO ? await import("./backend-demo.js") : await import("./backend-firebase.js");
    S.backend = mod.createBackend();
  } catch (e) {
    console.error(e);
    return show("error", "Couldn't load the secure channel. Check your connection and reload.");
  }
  S.backend.watchAuth(onAuth);
  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
boot();
