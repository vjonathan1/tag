# TAG//OPS — a tag tracker for the squad

A static web app (works on GitHub Pages) for an ongoing game of tag. Everyone uses the same link and signs in with their own password. The app shows:

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
| **Authentication** (Email/Password) | One login per agent. Each device stays signed in after the first password entry. |

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
2. Type a password for each agent (6+ characters, all different), or click **Generate all** for readable ones like `kite-amber-74`. Tick **Admin** for anyone who should get the command console (Jonny is ticked by default). Pick who starts as IT, then click **Initialize operation**.
3. Copy or download the list. **Passwords are shown only once.** Nobody, including you, can look them up later.
4. Use **Copy message** to send each friend **only their own** login message privately. Each message has the site link and their password.

### 5. Lock it down (recommended)
- **Leave Email/Password sign-up turned on.** The admin password reset creates a new login from the browser, which needs it. That's safe: a stranger who makes an account still can't read or write anything, because the rules only allow rostered logins.
- You can delete `setup.html` and `js/setup.js` from the repo. Re-running setup can't overwrite the game, because the rules only allow writing the roster once (after that, only admins can change it).

## Admin console

Admins see a **Command console** panel at the bottom of the main screen. It's collapsed until clicked, and other players never see it.

| Tool | What it does |
|---|---|
| **Reset a password** | Pick a player, type or generate a new password. They're signed out on every device and must sign in with the new one. **Copy message** gives you a ready-to-send note. |
| **Pending tag** | **Force confirm** or **Void** a stuck pending tag or audit, skipping the normal accept/vote process. |
| **Undo last tag** | Removes the most recent confirmed tag. IT goes back to the previous person, and their timer continues from when they were originally tagged. Undone tags are kept in `game/undone` for the record. |

**How the reset works:** a web page can't change someone else's Firebase password (that needs a paid server plan). Instead, the app creates a fresh login for that player with the new password, points the roster at it, and removes the old login from the roster. The old account then has no access. It still shows in Firebase → Authentication → Users, and you can delete it there to tidy up, but you don't have to.

**Admins can't reset their own password from the console.** Use **Change password** in the footer, or have a second admin do it. If the only admin forgets their password, use the console steps below to add a different player as admin.

### Adding an admin after setup (or if you ran setup before admins existed)
1. Publish the latest `database.rules.json` in Firebase → Realtime Database → **Rules**.
2. Firebase → **Authentication → Users**: find the player's login (e.g. `jonny@agents.tagops.example.com`, or `jonny.r…@` after a reset) and copy its **User UID**.
3. Firebase → **Realtime Database → Data**: hover over `meta`, click **+**, and add a child named `admins`. Under `admins`, add a child whose **key** is that UID and whose **value** is `true`.
4. Reload the app. The Command console appears for that player.

## How sign-in works

- Everyone opens the same site link. On the first visit on a device, they pick their name and type their password.
- After that, the device stays signed in, even after closing the browser. **Sign out** in the footer ends the session on that device.
- Players can change their own password from the footer (**Change password**). They need their current password to do it.
- **Forgotten passwords:** an admin resets them from the Command console (see "Admin console"). Firebase's own "reset password" email can't be used, because the logins use placeholder email addresses.
- Because the link is shared, the passwords are the only lock. Use real passwords (the generated ones are fine), not names or birthdays. Firebase slows down repeated wrong guesses automatically.

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
3. Run `setup.html` again and send out the new passwords.

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
