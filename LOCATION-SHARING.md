# TAG//OPS location check-ins

Each player's phone posts its location to the game roughly once an hour. The **Field map** on the main screen shows everyone's latest check-in.

Browsers can't track location in the background, so the phone's own automation tool does the posting:

| Platform | Tool | Trigger |
|---|---|---|
| iPhone / iPad | **Shortcuts** app (built in) | One "Time of Day" automation per hour you want covered |
| Android | An automation app such as **MacroDroid**, **Tasker**, or **HTTP Shortcuts** | A true "every 60 minutes" timer *(guide to come)* |

Both send the same single web request, so the game doesn't care which one a player uses.

## Ground rules (privacy)

- **Opt-in only.** Each player turns it on themselves in the app (footer → **Location sharing**) and builds the automation on their own phone. Nobody can turn it on for someone else, admins included.
- **Only the latest point is stored.** Each check-in overwrites the previous one, so there's no location history.
- **Only the 7 signed-in players can see it.** The secret key that sends check-ins is never shown to anyone except its owner.
- **Stopping is instant.** **Stop sharing** in the app deletes your location and disables your key. Then delete the automation on your phone. An admin can also remove anyone's location.
- Get everyone's agreement before using this. It's a precise location, and it updates while people are at home, school, or work.

## How it works

```
Phone automation ──PUT──▶  https://<your-db>.firebaseio.com/locations/<id>.json
                          body: {"k":"<your secret key>","pos":{"lat":..,"lng":..,"at":{".sv":"timestamp"},"src":".."}}
```

The database rules accept the write only if `k` matches that player's key. `{".sv":"timestamp"}` tells Firebase to stamp the time itself. No Firebase login or API key is needed, so this isn't affected by the API key's website restriction.

---

## iPad / iPhone: build the test Shortcut

**Before you start**
1. Publish the latest `database.rules.json` in Firebase (Realtime Database → Rules → paste → **Publish**). Check-ins are rejected without it.
2. Upload the updated site files to GitHub and confirm the app footer shows **v6**.
3. On the iPad, open the site, sign in, and tap **Location sharing** in the footer, then **Turn on sharing**.
4. Tap **Test from this device** and allow location. If you appear on the Field map, the server side works. Keep this screen open; you'll copy two things from it.

### Part A: the Shortcut

1. Open the **Shortcuts** app. Tap **+** (top right) to make a new shortcut. Tap the name at the top and call it `TAG Check-in`.
2. **Add the location step.** Tap **Add Action** (or the search bar), search for **Get Current Location**, and tap it.
3. **Add the message.** Search for **Text** and add it under the location step.
   - In TAG//OPS, tap **Copy** next to **2 · Request body**, then paste it into the Text box. It looks like this:
     `{"k":"Ab3…","pos":{"lat":LAT,"lng":LNG,"at":{".sv":"timestamp"},"src":"ios-shortcut"}}`
   - Delete the letters `LAT`, leaving the cursor in that spot. Above the keyboard, tap **Current Location** to insert it as a blue "variable" bubble.
   - Tap that **Current Location** bubble and choose **Latitude** from the list. The bubble should now read *Latitude*.
   - Do the same for `LNG`: delete it, insert **Current Location**, tap it, and choose **Longitude**.
   - Leave everything else exactly as pasted, including the quotes, braces, and `".sv"`.
4. **Add the send step.** Search for **Get Contents of URL** and add it at the bottom.
   - Tap the blue **URL** placeholder. In TAG//OPS, tap **Copy** next to **1 · URL** and paste it.
     It looks like `https://…-default-rtdb.firebaseio.com/locations/jonny.json`.
   - Tap the **›** arrow (or **Show More**) on the action.
   - **Method:** change `GET` to **PUT**.
   - **Request Body:** change it to **File**, then tap the **File** field and choose the **Text** variable from step 3.
5. Tap **▶ Play** (bottom right) to run it once.
   - When asked about location, choose **Allow** (preferably *Always* or *While Using*).
   - When asked whether `TAG Check-in` can connect to `firebaseio.com`, choose **Always Allow**. This is important: otherwise every automatic run stops to ask.
   - If it worked, the result shows `{"k":"…","pos":{…}}` with a large number for `at`.
6. Back in TAG//OPS, your marker should jump to the new position with the source updated, and the Field map should show "just now."

**If it fails:**
- `Permission denied`: the key in the Text doesn't match. It changes every time you tap **New key**, so copy the body again. Or the rules aren't published yet.
- `Invalid data; couldn't parse JSON`: a quote or brace got deleted, or Latitude/Longitude didn't come through as numbers. Re-paste the body and redo the two variables.
- Nothing happens: check **Settings → Privacy & Security → Location Services → Shortcuts** is not set to *Never*.

### Part B: make it run every hour

The Shortcuts app's time trigger runs once a day, not every hour, so you make one automation per hour you want covered. For testing, set up **2–3**; add the rest once it's proven.

1. In Shortcuts, open the **Automation** tab and tap **+** (or **New Automation**).
   On iPad, if there's no Automation tab, your iPadOS version doesn't support personal automations. Test the Shortcut by hand with ▶, and use an iPhone for the hourly part.
2. Choose **Time of Day**, set the time (e.g. **9:00 AM**), and set **Repeat** to **Daily**.
3. Choose **Run Immediately** (not "Run After Confirmation"). Turn **Notify When Run** off if you don't want a banner each hour.
4. Tap **Next**, then pick **TAG Check-in**. Done.
5. Repeat for 10:00, 11:00, and so on. A common choice is every hour from 8 AM to 11 PM (16 automations).

**Check it worked:** after the next scheduled time passes, look at the Field map. Your check-in time should match. The Shortcuts app doesn't show a history of automation runs, so the map is the easiest check.

**Things that can stop a run:**
- **Low Power Mode** or **Focus modes** can delay or skip it.
- iOS sometimes waits until the device is unlocked.
- **Wi-Fi-only iPads** get a rougher location (from Wi-Fi networks rather than GPS), often within a block or two.
- Treat the times as "about hourly."

### Part C: sharing the Shortcut with iPhone friends (later)

Once yours works, you can share it instead of having everyone build from scratch:
1. Duplicate `TAG Check-in`, open the copy, and **replace** your key and URL with placeholders such as `PASTE-KEY` and `PASTE-URL`. **Never share a copy containing your own key**, or that person could post locations as you.
2. Tap the **(i)** / settings icon, open **Setup** (Import Questions), and add questions for the URL field and the Text field. On import, iOS asks each friend to paste their own URL and body.
3. Tap **Share → Copy iCloud Link** and send it. Each friend turns on sharing in TAG//OPS, copies their own URL and body, imports the shortcut, then does Part B.

---

## Android (preview of the plan)

This is the same request with a different app. With **MacroDroid** (free tier is enough for one macro):
- **Trigger:** Regular Interval → every 60 minutes.
- **Action 1:** Force Location Update, or "Get Location", to capture latitude and longitude into variables.
- **Action 2:** HTTP Request:
  - **Method:** PUT
  - **URL:** the same URL from the app
  - **Body:** the same JSON, with the latitude and longitude variables in place of `LAT` and `LNG`
- Turn off battery optimization for the app so Android doesn't kill the timer.

Android can run on a true hourly timer, which makes it simpler than iOS. We'll write and test exact steps when you have an Android device to try.

## Troubleshooting quick reference

| Symptom | Likely cause |
|---|---|
| "Couldn't check your sharing status" in the app | Latest `database.rules.json` not published |
| Test from this device works, Shortcut doesn't | Key or URL copied wrong, or Method isn't PUT, or Request Body isn't File |
| Marker greyed out | Last check-in was more than 3 hours ago |
| Map area blank, list works | Map tiles or Leaflet couldn't load (offline or blocked network) |
