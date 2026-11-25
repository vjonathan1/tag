// Firebase backend: Auth (one login per player) + Realtime Database (shared game state).
import { firebaseConfig, EMAIL_DOMAIN } from "./config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, runTransaction, get, update, set,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// A player's login is `<loginId>@<EMAIL_DOMAIN>`. loginId starts as the player id ("eli").
// After an admin password reset it becomes a fresh one ("eli.r1a2b3"), published at /logins/<id>.
export const emailFor = (loginId) => `${loginId}@${EMAIL_DOMAIN}`;
const agentFromEmail = (email) => (email || "").split("@")[0].split(".")[0];

export function createBackend() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app); // default persistence = local → stays signed in on this device
  const db = getDatabase(app);

  // Correct for device clock drift using the server's clock.
  let offset = 0;
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });

  return {
    watchAuth(cb) {
      return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, agent: agentFromEmail(u.email) } : null));
    },
    async signIn(agent, password) {
      let loginId = agent;
      try { const s = await get(ref(db, `logins/${agent}`)); if (s.exists()) loginId = s.val(); } catch {}
      return signInWithEmailAndPassword(auth, emailFor(loginId), password);
    },
    // Firebase requires proof of the current password before changing it.
    async changePassword(current, next) {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
      await updatePassword(u, next);
    },
    // Admin-only. Browsers can't change another user's password, so instead we create a fresh
    // login for that player (in a throwaway app instance, so the admin stays signed in), point the
    // roster at it, and drop the old login from the roster. The old account then has no access.
    async resetPassword(pid, newPassword, meta) {
      const loginId = `${pid}.r${Date.now().toString(36)}`;
      const tmp = initializeApp(firebaseConfig, "provision-" + Date.now());
      let newUid;
      try {
        const tmpAuth = getAuth(tmp);
        newUid = (await createUserWithEmailAndPassword(tmpAuth, emailFor(loginId), newPassword)).user.uid;
        await signOut(tmpAuth);
      } finally {
        await deleteApp(tmp);
      }
      const changes = { [`meta/uids/${newUid}`]: pid, [`logins/${pid}`]: loginId };
      for (const [uid, id] of Object.entries(meta.uids || {})) {
        if (id === pid) {
          changes[`meta/uids/${uid}`] = null;
          if (meta.admins?.[uid]) { changes[`meta/admins/${uid}`] = null; changes[`meta/admins/${newUid}`] = true; }
        }
      }
      await update(ref(db), changes);
    },
    signOut() { return signOut(auth); },
    watchMeta(cb, onErr) { return onValue(ref(db, "meta"), (s) => cb(s.val()), onErr); },
    watchGame(cb, onErr) { return onValue(ref(db, "game"), (s) => cb(s.val()), onErr); },
    // fn(game) returns the new game object, or undefined to abort. Atomic across all players.
    async transact(fn) {
      const res = await runTransaction(ref(db, "game"), fn);
      return res.committed;
    },
    now() { return Date.now() + offset; },

    // ── Location check-ins ──
    // Each sharing player has a secret key at /locationKeys/<id> (readable only by them).
    // Phones post to /locations/<id> over plain HTTPS with that key in the body, so a
    // Shortcut / Android automation needs no Firebase login. Only `pos` is readable by the squad.
    watchLocations(ids, cb) {
      const offs = ids.map((id) => onValue(ref(db, `locations/${id}/pos`), (s) => cb(id, s.val()), () => cb(id, null)));
      return () => offs.forEach((off) => off());
    },
    async getLocationKey(pid) { return (await get(ref(db, `locationKeys/${pid}`))).val(); },
    setLocationKey(pid, key) { return set(ref(db, `locationKeys/${pid}`), key); },
    // Admin-only (enforced by the rules).
    setSetting(key, value) { return set(ref(db, `meta/settings/${key}`), value); },
    clearLocations(ids) { return update(ref(db), Object.fromEntries(ids.map((id) => [`locations/${id}`, null]))); },
    stopSharing(pid) { return update(ref(db), { [`locationKeys/${pid}`]: null, [`locations/${pid}`]: null }); },
    pingEndpoint(pid) { return `${firebaseConfig.databaseURL.replace(/\/+$/, "")}/locations/${pid}.json`; },
    // Sends exactly what the Shortcut sends — used by the in-app "test from this device" button.
    async sendPing(pid, key, lat, lng, src) {
      const res = await fetch(this.pingEndpoint(pid), {
        method: "PUT",
        body: JSON.stringify({ k: key, pos: { lat, lng, at: { ".sv": "timestamp" }, src } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    },
  };
}
