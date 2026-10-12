# Glow — personal meal & calorie apps for Celine and Leen

Two personal apps that run offline and can be saved to the phone's home screen:

- `celine/`: Celine's app (pink/purple theme)
- `leen/`: Leen's app (teal/blue theme)
- `sarah/`: Sarah's app (orange/pink theme)
- `natal/`: Natal's app (lilac theme, "lose fat & build muscle" mode)

Nobody's age, height or weight is in this code. Each girl types her numbers on first open, and they stay only on her phone.
- `src/`: the shared source code. Edit files here, then run `./build.sh` to rebuild all four apps.

## Deploy on GitHub Pages (about 5 minutes)

1. Create a new **public** repo on github.com, for example `cuttingapp`.
2. Upload the contents of this folder (drag and drop works: **Add file → Upload files**).
3. In the repo, go to **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
4. After about a minute, the apps are live at:
   - `https://adeeroo30-code.github.io/cuttingapp/celine/`
   - `https://adeeroo30-code.github.io/cuttingapp/leen/`
   - `https://adeeroo30-code.github.io/cuttingapp/sarah/`
   - `https://adeeroo30-code.github.io/cuttingapp/natal/`

Send each girl only her own link.

## Saving it to the phone

- **iPhone:** open the link in **Safari**, tap Share ⬆️, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap ⋮, then **Install app** (or "Add to Home screen").

## Meal reminders

- **📅 Calendar reminders (most reliable):** Settings ⚙️ → "Add daily reminders to my phone calendar". This downloads a file that adds 5 daily repeating events with alerts. If it doesn't open from the home-screen app on iPhone, open the same link in Safari and tap the button there.
- **🔔 App notifications:** Settings ⚙️ → "Turn on app notifications". On iPhone this only works after adding the app to the Home Screen (iOS 16.4+). These fire while the app is open or was used recently. Notifications that fire with the app fully closed would need a push server.

## ⌚ Watch sync (iPhone + Apple Health)

Web apps can't read the Health app directly, so a small Shortcut copies the day's **Active Energy** and the app imports it with one tap. This works with Apple Watch and any watch that writes to Health (Garmin, Oura…).

**One-time setup (Shortcuts app → ＋, name it "Glow Sync"):**
1. **Find Health Samples**: Type `Active Energy`, Add Filter `Start Date is today`
2. **Calculate Statistics**: `Sum` of Health Samples
3. **Text**: `GLOW;burn=`[Statistics]`;date=`[Current Date]. Tap Current Date → Date Format → Custom → `yyyy-MM-dd`
4. **Copy to Clipboard**
5. **Show Notification**: "Copied ✓ Open Glow → tap ⌚ Watch"
6. Run it once and allow Health access. Share → Add to Home Screen puts it next to Glow.

Build it once on one iPhone, then share it to the others (Share → Copy iCloud Link). The same Shortcut works for every girl's app.

**Daily use:** tap Glow Sync → open Glow → Movement → **⌚ Watch**. Syncing again later the same day updates the number instead of adding it twice.

**How it counts:** 80% of the watch number (watches run high), minus a small allowance for everyday moving that the base goal already covers. Workouts she also logged by hand are not added on top: the app uses whichever is bigger, the watch or the logged workouts.

**Bad data is caught, and nothing changes until it's sorted out:** empty or zero readings (watch off, no Health permission), tiny readings (< 40 kcal), kilojoules instead of calories (converted), unrealistic totals (double-counting devices, with a fix explained), very big days (asks to confirm, or offers a safe cap), data from the future or more than a week old, and unreadable dates (uses today and says so). Yesterday's data goes to yesterday.

## Versions & updates

The version is shown at the bottom of the Today screen ("Glow v1.5 · up to date ✓") and in ⚙️ Settings, which also has a 🔄 Check button.
Each time the app opens, it checks the server. If a newer version is there, it updates on the spot, shows "✨ Updated v1.5 → v1.6", and keeps all her data.

**To release an update:** change `src/VERSION` (e.g. 1.5 → 1.6), run `./build.sh`, commit and push.

## Good to know

- All data stays **on the phone** (no accounts and no server). Use ⚙️ → **Backup** now and then.
- The daily calorie goal is calculated with the Mifflin–St Jeor formula with a gentle deficit. It **never goes below 1500 kcal** (they're 17–18 and still growing). The goal weight can't be set below a healthy BMI of 18.5.
- **🧮 Manual calories** (＋ → Manual): type a number, calculate from a nutrition label (per 100 g × grams, or per unit), or build a homemade dish from its ingredients ÷ servings. Results can be saved to "My foods".
- **🏋️‍♀️ Workout calculator** (Today → Movement → ＋ Add): step-by-step questions for cardio (speed + incline use the ACSM equations), weights (style, muscles, rest), pilates (mat / reformer / jumpboard / wall), yoga, dance, classes and sports. Optional heart rate or watch calories make it more accurate. Only calories above resting are counted, and they're added to that day's food budget.
- The coach 💬 is a built-in offline helper (no AI API and no cost). It answers common questions in English or Hebrew.
