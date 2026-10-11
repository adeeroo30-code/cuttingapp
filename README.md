# Glow — personal meal & calorie apps for Celine and Leen

Two personal apps that run offline and can be saved to the phone's home screen:

- `celine/`: Celine's app (pink/purple theme, 57 → 51.5 kg)
- `leen/`: Leen's app (teal/blue theme, 54 → 48.5 kg)
- `sarah/`: Sarah's app (orange/pink theme, 55 → 48.5 kg)
- `src/`: the shared source code. Edit files here, then run `./build.sh` to rebuild all three apps.

## Deploy on GitHub Pages (about 5 minutes)

1. Create a new **public** repo on github.com, for example `glow`.
2. Upload the contents of this folder (drag and drop works: **Add file → Upload files**).
3. In the repo, go to **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
4. After about a minute, the apps are live at:
   - `https://<your-username>.github.io/glow/celine/`
   - `https://<your-username>.github.io/glow/leen/`
   - `https://<your-username>.github.io/glow/sarah/`

Send each girl only her own link.

## Saving it to the phone

- **iPhone:** open the link in **Safari**, tap Share ⬆️, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap ⋮, then **Install app** (or "Add to Home screen").

## Meal reminders

- **📅 Calendar reminders (most reliable):** Settings ⚙️ → "Add daily reminders to my phone calendar". This downloads a file that adds 5 daily repeating events with alerts. If it doesn't open from the home-screen app on iPhone, open the same link in Safari and tap the button there.
- **🔔 App notifications:** Settings ⚙️ → "Turn on app notifications". On iPhone this only works after adding the app to the Home Screen (iOS 16.4+). These fire while the app is open or was used recently. Notifications that fire with the app fully closed would need a push server.

## Good to know

- All data stays **on the phone** (no accounts and no server). Use ⚙️ → **Backup** now and then.
- The daily calorie goal is calculated with the Mifflin–St Jeor formula with a gentle deficit. It **never goes below 1500 kcal** (they're 17–18 and still growing). The goal weight can't be set below a healthy BMI of 18.5.
- The coach 💬 is a built-in offline helper (no AI API and no cost). It answers common questions in English or Hebrew.
