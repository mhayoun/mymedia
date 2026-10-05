# MyMedia – Setup guide (click by click)

You do this **once**. It takes about 30–40 minutes. After that, you and your
family only open a link.

What you will create:

| What | Why | Cost |
|---|---|---|
| A GitHub account + Vercel | Stores the code / hosts the app | Free |
| A Google Cloud project | Lets the app ask Google for access to *each user's own* Drive | Free |
| (Phase 2) a Claude API key | AI classification of difficult photos | Pay per use |

> Screens on Google and GitHub change from time to time. If a button has a
> slightly different name, look for the closest one. The order of the steps
> stays the same.

---

## Part A – GitHub account (stores the code)

Done: account **mhayoun**, repository **https://github.com/mhayoun/mymedia**.

## Part B – Hosting on Vercel

Done: the app is published at **https://mymedia-keep.vercel.app**
(Vercel account `m0583212851-1839`, project `mymedia`). Vercel only serves
the program files; no code runs on a server and no data goes through Vercel.

Vercel is connected to the GitHub repository: every change saved to
`mhayoun/mymedia` (branch `main`) is published automatically in about a minute.

## Part C – Google Cloud project

### C1. Create the project
1. Open **https://console.cloud.google.com** and sign in with your Google account.
2. If asked, choose your country, tick the Terms of Service box → **Agree and continue**.
3. At the top of the page, click the **project selector** (next to "Google Cloud",
   it may say "Select a project") → **New project** (top right of the window).
4. **Project name**: `MyMedia` → **Create**.
5. Wait for the notification (bell icon), then click **Select project**.
   Make sure the top bar now shows **MyMedia**.

### C2. Turn on the Google Drive API
1. In the search bar at the top, type **Google Drive API** and click the
   result with the Drive logo ("Marketplace" / "API").
2. Click **Enable**. Wait until the page shows "API enabled".

### C3. Configure the consent screen (what users see when signing in)
1. In the search bar type **Google Auth Platform** and open it
   (in older menus: ☰ → **APIs & Services** → **OAuth consent screen**).
2. Click **Get started**.
3. **App information**:
   - App name: `MyMedia`
   - User support email: choose your email
   → **Next**.
4. **Audience**: choose **External** → **Next**.
5. **Contact information**: type your email → **Next**.
6. Tick **I agree to the Google API Services: User Data Policy** → **Continue** → **Create**.

### C4. Add the Drive permission
1. In the left menu of Google Auth Platform click **Data access**.
2. Click **Add or remove scopes**.
3. In the filter box type `auth/drive` and press Enter.
4. Tick the line **`.../auth/drive`** – *"See, edit, create, and delete all of
   your Google Drive files"*. (Not `drive.file`, not `drive.readonly`.)
5. Click **Update** at the bottom of the panel, then **Save** at the bottom of the page.

### C5. Put the app "In production" (important!)
1. In the left menu click **Audience**.
2. Under **Publishing status** click **Publish app** → **Confirm**.
3. The status now shows **In production**. Google may show a message that
   verification is needed – **ignore it**: MyMedia is for you and your family
   (fewer than 100 users), so no verification is required.

> ⚠️ Why this matters: in "Testing" mode Google disconnects everyone **every 7 days**.

### C6. Create the client ID
1. In the left menu click **Clients** → **Create client**.
2. **Application type**: **Web application**.
3. **Name**: `MyMedia web`.
4. Under **Authorized JavaScript origins** click **Add URI** and type exactly
   (exactly, no slash at the end):
   ```
   https://mymedia-keep.vercel.app
   ```
   Click **Add URI** again and add (only needed to test on this computer):
   ```
   http://localhost:5173
   ```
5. Leave **Authorized redirect URIs** empty → **Create**.
6. A window shows the **Client ID** (it ends with `.apps.googleusercontent.com`).
   Click the **copy** icon next to it. You can always find it again under **Clients**.

## Part D – Give the client ID to the app

Paste the client ID to Claude and say **"set the client ID and publish"**.
Claude puts it in `public/config.json`, saves it to GitHub and publishes the
new version (about 1 minute). The client ID is not a secret: it is visible to
anyone who opens the app, and only works from the address in Part C6.

## Part E – First sign-in

1. Open `https://mymedia-keep.vercel.app`.
2. Click **כניסה עם Google** (Sign in with Google) and choose your account.
3. Google shows **"Google hasn't verified this app"**. This is expected (it
   is your own app). Click **Advanced** → **Go to MyMedia (unsafe)**.
4. On the next screen **tick the box** for Google Drive access
   ("See, edit, create, and delete all of your Google Drive files") → **Continue**.
5. If you have no `MyMedia` folder yet, the app proposes to create it with the
   categories Family / Birds / Work / Other (you can change them) → **Create the folders**.
   If the folder already exists, the app reads it.

If the Google window does not open: allow pop-ups for the site
(Chrome: icon at the right of the address bar → **Always allow pop-ups**).

## Part F – Install the app

**Android (Chrome)**
1. Open the app address in **Chrome**.
2. Tap **⋮** (top right) → **Add to home screen** → **Install**.
3. The MyMedia icon appears on the home screen; open it from there.

**iPhone / iPad (Safari)**
1. Open the app address in **Safari** (not Chrome).
2. Tap the **Share** button (square with an arrow) → scroll → **Add to Home Screen** → **Add**.
3. Open MyMedia from the home screen and sign in once inside it
   (the installed app has its own storage, separate from Safari).

**Windows / Mac (Chrome or Edge)**
1. Open the app address.
2. Click the **install icon** at the right end of the address bar
   (a screen with a down arrow) → **Install**.
   (Edge: **…** → **Apps** → **Install this site as an app**.)
3. MyMedia opens in its own window and appears in the Start menu / Applications.

**Updates** install themselves: the next time the app opens after a change, the new version loads.

## Part G – Family and friends

Send them the link `https://mymedia-keep.vercel.app`. Each person signs
in with **their own** Google account and sees **their own** Drive. They see
the same "unverified app" warning once (Part E, step 3).
Limit: 100 different Google accounts in total.

## Part H – Claude API key (needed from Phase 2)

Will be completed in Phase 2 (classification).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "The Google client ID is missing" | Part D not done yet. |
| Google error `redirect_uri_mismatch` or `origin_mismatch` | The origin in Part C6 must be exactly `https://mymedia-keep.vercel.app` (no final `/`). Changes take up to 5 minutes. |
| Google error "access blocked: app in testing" | Part C5 not done. |
| The Drive box was not ticked | The app asks again; sign in and tick the box. |
| "Reconnect" banner | Click **Reconnect**. On iPhone this can happen about once a day; your work is kept. |
| `mymedia.json cannot be read` | Someone edited the file by hand. In Drive: right-click it → **File information** → **Manage versions** → download/restore the previous version. |
