// One-time admin setup: creates a Firebase Auth user per player, writes the roster + game start,
// and prints each player's private link. Each login's password = <random link key>::<passphrase>,
// so signing in needs BOTH the personal link and the shared passphrase.
import { firebaseConfig, PLAYERS, isConfigured } from "./config.js";
import { emailFor, passwordFor } from "./backend-firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const log = (msg) => { $("log").textContent += msg + "\n"; };

$("start").innerHTML = PLAYERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
if (!isConfigured()) { $("unconfigured").hidden = false; $("setup-form").querySelector("button").disabled = true; }

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(18)); // 144 bits
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("pw").value, startIt = $("start").value;
  if (pw !== $("pw2").value) { log("✗ Passphrases don't match."); return; }
  const btn = e.target.querySelector("button");
  btn.disabled = true; $("log").textContent = "";

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app), db = getDatabase(app);
  const uids = {}, results = [];

  for (const p of PLAYERS) {
    const key = randomKey();
    try {
      const cred = await createUserWithEmailAndPassword(auth, emailFor(p.id), passwordFor(key, pw));
      uids[cred.user.uid] = p.id;
      results.push({ ...p, key });
      log(`✓ Login created for ${p.name}`);
    } catch (err) {
      log(`✗ ${p.name}: ${err.code || err.message}`);
      if (err.code === "auth/email-already-in-use") {
        log("  Setup was already run. To start over: delete all users in Firebase → Authentication, delete the database data, then reload this page.");
      } else if (err.code === "auth/operation-not-allowed") {
        log("  Enable the Email/Password provider in Firebase → Authentication → Sign-in method.");
      }
      if (results.length) log("  Some logins were created before this error — delete them in the console before retrying.");
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
        createdAt: serverTimestamp(),
      },
      game: { start: { it: startIt, at: serverTimestamp() } },
    });
    log("✓ Roster and game clock written.");
  } catch (err) {
    log(`✗ Database write failed: ${err.code || err.message}`);
    log("  Check that database.rules.json is published and the database already exists. Logins were created; delete them before retrying.");
    btn.disabled = false;
    return;
  }
  await signOut(auth);
  log("✓ Done. Signed out of the admin session.");

  const base = new URL("./", location.href).href;
  const links = results.map((r) => ({ ...r, url: `${base}#agent=${encodeURIComponent(r.id)}&key=${encodeURIComponent(r.key)}` }));
  $("link-list").innerHTML = links.map((l, i) => `
    <div class="link-row">
      <div class="link-head"><b>${esc(l.name)}</b><button class="btn btn-sm" data-i="${i}">Copy</button></div>
      <code>${esc(l.url)}</code>
    </div>`).join("");
  $("links").hidden = false;
  $("link-list").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b) return;
    await navigator.clipboard.writeText(links[+b.dataset.i].url);
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = "Copy"), 1500);
  });
  $("download").onclick = () => {
    const txt = "TAG//OPS agent links — keep private\n\n" + links.map((l) => `${l.name}\n${l.url}\n`).join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([txt], { type: "text/plain" })), download: "tagops-links.txt",
    });
    a.click();
  };
  $("setup-form").hidden = true;
});
