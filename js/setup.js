// One-time admin setup: creates a Firebase Auth login per player with the password the admin
// chooses, writes the roster + game start, and prints a ready-to-send message for each player.
import { firebaseConfig, PLAYERS, isConfigured } from "./config.js";
import { emailFor } from "./backend-firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const log = (msg) => { $("log").textContent += msg + "\n"; };

$("start").innerHTML = PLAYERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
$("pw-fields").innerHTML = PLAYERS.map((p) => `
  <div style="display:flex;justify-content:space-between;align-items:end;gap:8px">
    <label for="pw-${p.id}">${esc(p.name)}</label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" id="adm-${p.id}" ${p.id === "jonny" ? "checked" : ""}> Admin
    </label>
  </div>
  <div style="display:flex;gap:8px">
    <input class="field" id="pw-${p.id}" type="text" minlength="6" required spellcheck="false" autocomplete="off">
    <button class="btn btn-sm" type="button" data-gen="${p.id}">Generate</button>
  </div>`).join("");
if (!isConfigured()) { $("unconfigured").hidden = false; $("setup-form").querySelector("button[type=submit]").disabled = true; }

// Readable random password, e.g. "kite-amber-74". Easy to type on a phone.
const WORDS = "amber,anchor,atlas,blade,cipher,cobalt,comet,delta,echo,ember,falcon,ghost,glacier,harbor,jade,kite,lynx,maple,nova,onyx,orbit,pixel,quartz,raven,shadow,signal,sonar,talon,tundra,vector,viper,zephyr".split(",");
const pick = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const genPassword = () => `${WORDS[pick(WORDS.length)]}-${WORDS[pick(WORDS.length)]}-${10 + pick(90)}`;

$("pw-fields").addEventListener("click", (e) => {
  const id = e.target.closest("[data-gen]")?.dataset.gen;
  if (id) $(`pw-${id}`).value = genPassword();
});
$("gen-all").onclick = () => PLAYERS.forEach((p) => { $(`pw-${p.id}`).value = genPassword(); });

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("log").textContent = "";
  const pws = Object.fromEntries(PLAYERS.map((p) => [p.id, $(`pw-${p.id}`).value.trim()]));
  if (Object.values(pws).some((v) => v.length < 6)) { log("✗ Every password needs at least 6 characters."); return; }
  if (new Set(Object.values(pws)).size !== PLAYERS.length) { log("✗ Each agent needs a different password."); return; }

  const startIt = $("start").value;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app), db = getDatabase(app);
  const uids = {}, admins = {};
  if (!PLAYERS.some((p) => $(`adm-${p.id}`).checked)) {
    if (!confirm("No admin selected. Nobody will be able to reset passwords or fix tags. Continue anyway?")) { btn.disabled = false; return; }
  }

  for (const p of PLAYERS) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, emailFor(p.id), pws[p.id]);
      uids[cred.user.uid] = p.id;
      if ($(`adm-${p.id}`).checked) admins[cred.user.uid] = true;
      log(`✓ Login created for ${p.name}`);
    } catch (err) {
      log(`✗ ${p.name}: ${err.code || err.message}`);
      if (err.code === "auth/email-already-in-use") {
        log("  Setup was already run. To start over: delete all users in Firebase → Authentication, delete the database data, then reload this page.");
      } else if (err.code === "auth/operation-not-allowed") {
        log("  Enable the Email/Password provider in Firebase → Authentication → Sign-in method.");
      } else if (err.code === "auth/weak-password") {
        log("  Firebase rejected that password as too weak. Use 6+ characters.");
      }
      if (Object.keys(uids).length) log("  Some logins were created before this error — delete them in the console before retrying.");
      btn.disabled = false;
      return;
    }
  }

  try {
    // The last-created user is still signed in; the rules let a roster member write the initial state once.
    await update(ref(db), {
      meta: {
        players: Object.fromEntries(PLAYERS.map((p, i) => [p.id, { name: p.name, order: i }])),
        uids,
        admins,
        createdAt: serverTimestamp(),
      },
      game: { start: { it: startIt, at: serverTimestamp() } },
    });
    log("✓ Roster and game clock written.");
  } catch (err) {
    log(`✗ Database write failed: ${err.code || err.message}`);
    log("  Check that database.rules.json is published and the database exists. Logins were created; delete them before retrying.");
    btn.disabled = false;
    return;
  }
  await signOut(auth);
  log("✓ Done. Signed out of the admin session.");

  const site = new URL("./", location.href).href;
  const msgs = PLAYERS.map((p) => ({
    ...p,
    text: `TAG//OPS is live: ${site}\nPick "${p.name}" and sign in with your password: ${pws[p.id]}\nKeep it to yourself. You can change it in the app (footer → Change password).`,
  }));
  $("link-list").innerHTML = `
    <div class="link-row"><div class="link-head"><b>Site link (same for everyone)</b></div><code>${esc(site)}</code></div>
    ${msgs.map((m, i) => `
      <div class="link-row">
        <div class="link-head"><b>${esc(m.name)}</b><button class="btn btn-sm" data-i="${i}">Copy message</button></div>
        <code style="white-space:pre-wrap">${esc(m.text)}</code>
      </div>`).join("")}`;
  $("links").hidden = false;
  $("link-list").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b) return;
    await navigator.clipboard.writeText(msgs[+b.dataset.i].text);
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy message"), 1500);
  });
  $("download").onclick = () => {
    const txt = `TAG//OPS logins — keep private\nSite: ${site}\n\n` + PLAYERS.map((p) => `${p.name}: ${pws[p.id]}`).join("\n") + "\n";
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([txt], { type: "text/plain" })), download: "tagops-logins.txt",
    });
    a.click();
  };
  $("setup-form").hidden = true;
});
