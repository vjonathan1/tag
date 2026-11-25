// Demo backend: no Firebase needed. State lives in this browser's localStorage and syncs
// across tabs, so you can open several tabs as different agents to try the full flow.
import { PLAYERS } from "./config.js";

const KEY = "tagops-demo-state";
const SESSION = "tagops-demo-session";

function seed() {
  const H = 3600e3, n = Date.now();
  return {
    start: { it: "deuce", at: n - 75 * H },
    log: [
      { from: "deuce", to: "eli", at: n - 61 * H, confirmedAt: n - 61 * H, via: "accepted" },
      { from: "eli", to: "oscar", at: n - 49 * H, confirmedAt: n - 48 * H, via: "audit" },
      { from: "oscar", to: "jacob", at: n - 30 * H, confirmedAt: n - 30 * H, via: "accepted" },
      { from: "jacob", to: "rece", at: n - 22 * H, confirmedAt: n - 22 * H, via: "accepted" },
      { from: "rece", to: "ryan", at: n - 9 * H, confirmedAt: n - 9 * H, via: "accepted" },
      { from: "ryan", to: "jonny", at: n - 2.3 * H, confirmedAt: n - 2.3 * H, via: "accepted" },
    ],
  };
}

export function createBackend() {
  const meta = {
    players: Object.fromEntries(PLAYERS.map((p, i) => [p.id, { name: p.name, order: i }])),
    uids: Object.fromEntries(PLAYERS.map((p) => ["demo-" + p.id, p.id])),
    admins: { "demo-jonny": true },
  };
  const load = () => { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {} return seed(); };
  let game = load();
  const gameCbs = new Set();
  let authCb = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(game)); } catch {} };
  const emit = () => gameCbs.forEach((cb) => cb(structuredClone(game)));
  const session = () => { try { return sessionStorage.getItem(SESSION); } catch { return null; } };
  const userFor = (agent) => (agent ? { uid: "demo-" + agent, agent } : null);

  // Demo locations: made-up points around a sample city (Atlanta), not real people.
  const LOCS = "tagops-demo-locs";
  const seedLocs = () => {
    const n = Date.now(), M = 60e3;
    const at = (lat, lng, ago) => ({ lat, lng, at: n - ago * M, src: "demo" });
    return {
      keys: { deuce: "demo-key-deuce-000000000", eli: "demo-key-eli-00000000000", oscar: "demo-key-oscar-000000000", ryan: "demo-key-ryan-0000000000", rece: "demo-key-rece-0000000000" },
      locs: { deuce: at(33.7756, -84.3963, 22), eli: at(33.7490, -84.3880, 48), oscar: at(33.8463, -84.3621, 75), ryan: at(33.7710, -84.3653, 12), rece: at(33.7001, -84.4195, 260) },
    };
  };
  const loadLocs = () => { try { const s = localStorage.getItem(LOCS); if (s) return JSON.parse(s); } catch {} return seedLocs(); };
  let L = loadLocs();
  const locCbs = new Set();
  const saveLocs = () => { try { localStorage.setItem(LOCS, JSON.stringify(L)); } catch {} };
  const emitLocs = () => locCbs.forEach((cb) => PLAYERS.forEach((p) => cb(p.id, L.locs[p.id] || null)));

  window.addEventListener("storage", (e) => {
    if (e.key === KEY) { game = e.newValue ? JSON.parse(e.newValue) : seed(); emit(); }
    if (e.key === LOCS) { L = e.newValue ? JSON.parse(e.newValue) : seedLocs(); emitLocs(); }
  });

  return {
    watchAuth(cb) { authCb = cb; setTimeout(() => cb(userFor(session())), 0); return () => {}; },
    async signIn(agent) {
      if (!meta.players[agent]) throw Object.assign(new Error("Unknown agent"), { code: "auth/invalid-credential" });
      try { sessionStorage.setItem(SESSION, agent); } catch {}
      authCb?.(userFor(agent));
    },
    async changePassword() {},
    async resetPassword() {},
    async signOut() { try { sessionStorage.removeItem(SESSION); } catch {} authCb?.(null); },
    watchMeta(cb) { setTimeout(() => cb(structuredClone(meta)), 0); return () => {}; },
    watchGame(cb) { gameCbs.add(cb); setTimeout(() => cb(structuredClone(game)), 0); return () => gameCbs.delete(cb); },
    async transact(fn) {
      const next = fn(structuredClone(game));
      if (next === undefined) return false;
      game = next; save(); emit();
      return true;
    },
    now() { return Date.now(); },
    reset() {
      try { localStorage.removeItem(KEY); localStorage.removeItem(LOCS); } catch {}
      game = seed(); save(); emit(); L = seedLocs(); saveLocs(); emitLocs();
    },
    watchLocations(ids, cb) {
      const f = (id, pos) => { if (ids.includes(id)) cb(id, pos); };
      locCbs.add(f); setTimeout(() => ids.forEach((id) => cb(id, L.locs[id] || null)), 0);
      return () => locCbs.delete(f);
    },
    async getLocationKey(pid) { return L.keys[pid] || null; },
    async setLocationKey(pid, key) { L.keys[pid] = key; saveLocs(); },
    async stopSharing(pid) { delete L.keys[pid]; delete L.locs[pid]; saveLocs(); emitLocs(); },
    pingEndpoint(pid) { return `https://YOUR-PROJECT-default-rtdb.firebaseio.com/locations/${pid}.json`; },
    async sendPing(pid, key, lat, lng, src) {
      if (!key || L.keys[pid] !== key) throw new Error("HTTP 401 Permission denied (key mismatch)");
      L.locs[pid] = { lat, lng, at: Date.now(), src }; saveLocs(); emitLocs();
    },
  };
}
