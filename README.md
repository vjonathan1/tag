# TAG//OPS — a tag tracker for the squad

A static web app (works on GitHub Pages) for an ongoing game of tag. Each agent gets a private link. The app shows:

- Who is **IT** right now, with a live count-up timer.
- The **3 most recent tags**.
- A **leaderboard** of total time spent IT across all stints.
- When you're IT, a red alert screen with a **Tag** button for each other player.

When someone taps **Tag**, the target gets a prompt to **Accept** or **Dispute**. If they dispute it, or don't answer within 1 hour, the tag goes to an **audit**: the other 5 players vote, and 3 matching votes decide it.

**Try it first, no setup needed:** open `index.html?demo` (see "Local preview" below). Demo data stays in your browser. Use the agent picker at the bottom to switch players. Open two tabs as different agents to watch a tag go through.

---

## Why Firebase?

GitHub Pages only hosts static files. It can't store the shared game state. The app uses Google **Firebase** (free Spark plan) for two things:

| Piece | Purpose |
|---|---|
| **Realtime Database** | Shared game state. Every open screen updates instantly. |
| **Authentication** (Email/Password) | One login per agent. Each device stays signed in after the first passphrase entry. |

The Firebase config values in `js/config.js` are meant to be public. Security comes from `database.rules.json`.

## Setup (about 15 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and click **Add project**. Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password**. Leave "Email link" off.
3. **Build → Realtime Database → Create database**. Pick a location and start in **locked mode**.
4. In the database's **Rules** tab, paste the contents of `database.rules.json` and click **Publish**.

### 2. Connect the app
1. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app; you can skip Hosting.
2. Copy the `firebaseConfig` values into `js/config.js`. Make sure `databaseURL` is included. If the console omits it, copy the URL from the Realtime Database page.

### 3. Publish on GitHub Pages
1. Create a GitHub repo, for example `tag-ops`, and push this folder to it.
2. **Repo → Settings → Pages**: set Source to *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. After a minute the site is live at `https://<your-username>.github.io/tag-ops/`.
4. Optional: add `<your-username>.github.io` under Firebase **Authentication → Settings → Authorized domains**.

> A public repo means anyone can read the *code*, but that's fine: the game data is protected by the auth rules, not by hiding the code. A private repo needs a paid GitHub plan to use Pages.

### 4. Run the one-time setup
1. Open `https://<your-username>.github.io/tag-ops/setup.html`.
2. Choose a squad **passphrase** and who starts as IT, then click **Initialize**.
3. Copy or download the 7 links. **They are shown only once.**
4. Send each friend **only their own link** by private message, plus the passphrase (ideally through a different channel).

### 5. Lock it down (recommended)
- If your Firebase console shows **Authentication → Settings → User actions → Enable create (sign-up)**, turn it off. Even if you can't, a stranger who makes an account still can't read or write anything, because the rules only allow the 7 rostered logins.
- You can delete `setup.html` and `js/setup.js` from the repo. Re-running setup can't overwrite the game, because the rules only allow writing the roster once.

## How sign-in works

- Each link looks like `…/#agent=eli&key=<random 24-char key>`. The part after `#` is never sent to any server. The app saves it on the device and then removes it from the address bar.
- First visit on a device: enter the passphrase once. The Firebase login password is `key + passphrase`, so getting in needs **both the link and the passphrase**.
- After that, the device stays signed in, even after closing the browser. **Disconnect device** in the footer signs out.
- Lost a link? Re-run setup from scratch (see "Reset" below). Links can't be recovered.

## Security model and limits

- Only the 7 rostered logins can read or write game data. Everyone else is denied by the database rules.
- Tag history entries and the game start can't be **edited** by the rules. But any rostered player who uses developer tools could still delete entries or forge a "confirmed" tag. The app itself enforces the game rules, such as only IT can tag and voters can't be the tagger or target. This is a trust-among-friends design. Making those rules tamper-proof would need server code (Firebase Cloud Functions, which requires the paid Blaze plan).
- **Notifications:** players get prompts and audit requests in the app whenever it's open, plus a browser notification if they tapped **Enable alerts** and the tab is open in the background. Real push notifications to a closed browser or phone would need a service worker and Firebase Cloud Messaging (not included).
- Times use the Firebase server clock, so a device with the wrong time won't skew the timers.

## Game rules in the app

| Situation | What happens |
|---|---|
| IT taps **Tag** on someone | A pending tag is created. Only one can be pending at a time. |
| Target taps **Accept** | Confirmed. IT passes to the target, backdated to the moment of the tag. |
| Target taps **Dispute**, or 1 hour passes with no answer | Audit. The 5 other players vote Yes or No. |
| 3 Yes votes | Confirmed ("Audit verified"). |
| 3 No votes | Voided and recorded in `game/voided`. The tagger stays IT. |
| During an audit | The target can concede. The tagger can withdraw. |

Change the 1-hour window (set in minutes) with `RESPONSE_TIMEOUT_MIN` in `js/config.js`.

## Local preview

ES modules don't load from `file://`, so serve the folder with any static server, for example:

```bash
npx serve .
```

Then open `http://localhost:3000/?demo`.

## Reset / start over
1. Firebase → Authentication → Users: delete all 7 users.
2. Firebase → Realtime Database → Data: delete the root data.
3. Run `setup.html` again and send out the new links.

## Files

```
index.html             player app
setup.html             one-time admin setup
css/styles.css         theme
js/config.js           Firebase config, roster, timeout   ← edit this
js/app.js              UI and game logic
js/backend-firebase.js Firebase auth and database adapter
js/backend-demo.js     offline demo adapter (?demo)
js/setup.js            setup logic
database.rules.json    paste into Firebase → Realtime Database → Rules
```
