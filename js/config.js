// ─────────────────────────────────────────────────────────────
//  TAG//OPS configuration
// ─────────────────────────────────────────────────────────────

// 1) Paste your Firebase web-app config here
//    (Firebase console → Project settings → General → Your apps → SDK setup and configuration → "Config").
//    These values are NOT secrets; access is protected by Firebase Auth + database.rules.json.
export const firebaseConfig = {
  /* apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  appId: "PASTE_YOUR_APP_ID", */
  apiKey: "AIzaSyAIR5QgmlLmPq4QiGlHu0i1N6vD9H2cI00",
  authDomain: "tag-ops-9a4cd.firebaseapp.com",
  databaseURL: "https://tag-ops-9a4cd-default-rtdb.firebaseio.com",
  projectId: "tag-ops-9a4cd",
  appId: "1:791101315216:web:e542a41ee8e257c4dbe015"
};

// 2) The roster. `id` is used in logins — keep it lowercase, no spaces.
//    This file is PUBLIC (anyone can open it on GitHub Pages), so it holds first names only;
//    they're what the login picker shows. Full names live in the database (meta/players),
//    which only signed-in players can read. Changing ids after running setup.html requires re-running setup.
export const PLAYERS = [
  { id: "deuce", name: "Deuce" },
  { id: "eli", name: "Eli" },
  { id: "jacob", name: "Jacob" },
  { id: "oscar", name: "Oscar" },
  { id: "rece", name: "Rece" },
  { id: "ryan", name: "Ryan" },
  { id: "jonny", name: "Jonny" },
];

// 3) Minutes a tagged player has to accept before the tag automatically goes to a squad audit.
export const RESPONSE_TIMEOUT_MIN = 60;

// Internal: each player's Firebase Auth login is `<id>@<EMAIL_DOMAIN>`. No email is ever sent.
// (example.com is a reserved domain, so these addresses can never belong to a real person.)
export const EMAIL_DOMAIN = "agents.tagops.example.com";

export const isConfigured = () => !String(firebaseConfig.apiKey).startsWith("PASTE_");
