// Firebase backend: Auth (one login per player) + Realtime Database (shared game state).
import { firebaseConfig, EMAIL_DOMAIN } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, onValue, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const emailFor = (agent) => `${agent}@${EMAIL_DOMAIN}`;
export const passwordFor = (key, passphrase) => `${key}::${passphrase}`;

export function createBackend() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app); // default persistence = local → stays signed in on this device
  const db = getDatabase(app);

  // Correct for device clock drift using the server's clock.
  let offset = 0;
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });

  return {
    watchAuth(cb) {
      return onAuthStateChanged(auth, (u) =>
        cb(u ? { uid: u.uid, agent: (u.email || "").split("@")[0] } : null));
    },
    signIn(agent, key, passphrase) {
      return signInWithEmailAndPassword(auth, emailFor(agent), passwordFor(key, passphrase));
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
  };
}
