# MyMedia – Setup guide (click by click)

You do this **once**. It takes about 30–40 minutes. After that, you and your
family only open a link.

What you will create:

| What | Why | Cost |
|---|---|---|
| A GitHub account | Free hosting of the app (GitHub Pages) | Free |
| A Google Cloud project | Lets the app ask Google for access to *each user's own* Drive | Free |
| (Phase 2) a Claude API key | AI classification of difficult photos | Pay per use |

> Screens on Google and GitHub change from time to time. If a button has a
> slightly different name, look for the closest one. The order of the steps
> stays the same.

---

## Part A – Create a GitHub account

1. Open **https://github.com/signup**.
2. Type your **email** → **Continue**.
3. Choose a **password** → **Continue**.
4. Choose a **username** (for example `moshe-media`). Write it down: your app
   address will be `https://USERNAME.github.io/mymedia/`.
   → **Continue**.
5. Answer the email-preferences question (either answer is fine) → **Continue**.
6. Solve the puzzle → **Create account**.
7. Open your mailbox, find the code from GitHub, and type it on the page.
8. If GitHub asks questions about how you will use it, click **Skip personalization**.

## Part B – Publish the app on GitHub Pages

The easiest way: let Claude do it.

1. In the terminal where Claude Code runs, type (one line at a time; the `!`
   runs the command for you):
   ```
   ! sudo apt install -y gh
   ! gh auth login
   ```
2. `gh auth login` asks questions. Answer with the arrow keys and **Enter**:
   - *Where do you use GitHub?* → **GitHub.com**
   - *Preferred protocol?* → **HTTPS**
   - *Authenticate Git with your GitHub credentials?* → **Yes**
   - *How would you like to authenticate?* → **Login with a web browser**
   - It shows an **8-character code**. Press **Enter**, the browser opens,
     type the code → **Continue** → **Authorize github**.
3. Tell Claude: **"publish the app on GitHub"**. Claude creates the
   repository `mymedia`, uploads the code and switches on GitHub Pages.
4. After about 2 minutes the app is at `https://USERNAME.github.io/mymedia/`.
   It shows *"the Google client ID is missing"* – that is normal, Part C fixes it.

> The repository is **public** (required for free GitHub Pages). It contains
> only the program, never your photos or data. The Google client ID you add
> in Part D is not a secret.

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
   (replace USERNAME, no `/mymedia` at the end, no slash at the end):
   ```
   https://USERNAME.github.io
   ```
   Click **Add URI** again and add (only needed to test on this computer):
   ```
   http://localhost:5173
   ```
5. Leave **Authorized redirect URIs** empty → **Create**.
6. A window shows the **Client ID** (it ends with `.apps.googleusercontent.com`).
   Click the **copy** icon next to it. You can always find it again under **Clients**.

## Part D – Give the client ID to the app

1. Open `https://github.com/USERNAME/mymedia`.
2. Click the folder **public**, then the file **config.json**.
3. Click the **pencil** icon (Edit this file), top right of the file.
4. Replace `PASTE-YOUR-CLIENT-ID.apps.googleusercontent.com` with the client ID
   you copied. Keep the quotes:
   ```json
   {
     "googleClientId": "123456789012-abcdefg.apps.googleusercontent.com"
   }
   ```
5. Click **Commit changes…** → **Commit changes**.
6. Wait 2 minutes (the **Actions** tab shows a green check when done).

(Or simply paste the client ID to Claude and ask it to do this step.)

## Part E – First sign-in

1. Open `https://USERNAME.github.io/mymedia/`.
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

Send them the link `https://USERNAME.github.io/mymedia/`. Each person signs
in with **their own** Google account and sees **their own** Drive. They see
the same "unverified app" warning once (Part E, step 3).
Limit: 100 different Google accounts in total.

## Part H – Claude API key (needed from Phase 2)

Will be completed in Phase 2 (classification).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "The Google client ID is missing" | Part D not done, or not finished deploying (wait 2 min, reload). |
| Google error `redirect_uri_mismatch` or `origin_mismatch` | The origin in Part C6 must be exactly `https://USERNAME.github.io` (no path, no final `/`). Changes take up to 5 minutes. |
| Google error "access blocked: app in testing" | Part C5 not done. |
| The Drive box was not ticked | The app asks again; sign in and tick the box. |
| "Reconnect" banner | Click **Reconnect**. On iPhone this can happen about once a day; your work is kept. |
| `mymedia.json cannot be read` | Someone edited the file by hand. In Drive: right-click it → **File information** → **Manage versions** → download/restore the previous version. |
