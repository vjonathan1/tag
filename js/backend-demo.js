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
  };
  const load = () => { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {} return seed(); };
  let game = load();
  const gameCbs = new Set();
  let authCb = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(game)); } catch {} };
  const emit = () => gameCbs.forEach((cb) => cb(structuredClone(game)));
  const session = () => { try { return sessionStorage.getItem(SESSION); } catch { return null; } };
  const userFor = (agent) => (agent ? { uid: "demo-" + agent, agent } : null);

  window.addEventListener("storage", (e) => {
    if (e.key === KEY) { game = e.newValue ? JSON.parse(e.newValue) : seed(); emit(); }
  });

  return {
    watchAuth(cb) { authCb = cb; setTimeout(() => cb(userFor(session())), 0); return () => {}; },
    async signIn(agent) {
      if (!meta.players[agent]) throw Object.assign(new Error("Unknown agent"), { code: "auth/invalid-credential" });
      try { sessionStorage.setItem(SESSION, agent); } catch {}
      authCb?.(userFor(agent));
    },
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
    reset() { try { localStorage.removeItem(KEY); } catch {} game = seed(); save(); emit(); },
  };
}
