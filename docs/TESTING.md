# MyMedia – Test checklist

Tick each line on a phone **and** on a computer. Sections follow the
requirements document. Each phase adds its own section.

## Phase 1 – Base

### Sign-in (§1)
- [ ] First sign-in shows the Google window, the "unverified app" warning, and the Drive checkbox.
- [ ] Untick the Drive box → the app explains that Drive access is needed.
- [ ] Close and reopen the app within an hour → no sign-in needed.
- [ ] Reopen after more than an hour → the gallery shows immediately; at most a **Reconnect** banner (no "session expired" page). After **Reconnect** the loading continues by itself.
- [ ] Settings → **Use another account** → a different account sees its own Drive.
- [ ] Settings → **Sign out on this device** → back to the sign-in screen; other devices stay signed in.

### Folders (§2)
- [ ] With no `MyMedia` folder, the app proposes to create it with 4 categories (names in the current language), editable.
- [ ] With an existing `MyMedia` folder (e.g. your birds), the app uses it and shows its sub-folders as categories and albums.
- [ ] **+ New category** creates a folder in Drive (check in drive.google.com).
- [ ] Select a category → **new album** icon creates a sub-folder.
- [ ] **Rename** a category / album → the name changes in Drive.
- [ ] **Delete** a category → confirmation with the number of files → the folder is in the Drive **trash** (not deleted for good).
- [ ] Create a folder inside `MyMedia` directly in drive.google.com → after **Load new files** it appears as a category.
- [ ] Nested albums (`Birds/נחליאלי לבן/young`) appear nested in the side menu.
- [ ] A folder whose name starts with `_` (e.g. `_Originals`) is not shown as a category.
- [ ] Settings → Main folder → **Rename** changes the folder name in Drive.

### Loading (§3, Drive part)
- [ ] First load shows "Reading your Drive folders… N files found", then the gallery.
- [ ] Add a photo to an album in drive.google.com → **Load new files** → it appears in the right album (only changes are loaded: the progress shows "Loading changes x / y").
- [ ] Move a photo between albums in Drive → it moves in the app.
- [ ] Delete a photo in Drive → it disappears from the app.
- [ ] Files that are not JPG/PNG/HEIC/WEBP/MP4/MOV (e.g. PDF) are ignored.
- [ ] Settings → **Automatic**, interval 1 minute → a file added in Drive appears by itself within ~1–2 minutes while the app is open.
- [ ] Settings → **Manual** → nothing loads by itself; the button works.
- [ ] The **×** next to the progress cancels a load.

### Gallery (§8, base)
- [ ] Grid view and **By album** view (headers "Category / Album" with counts).
- [ ] Sort newest / oldest / name.
- [ ] Filter photos / videos.
- [ ] Videos show a ▶ badge with their duration.
- [ ] Click a photo → large view; arrows, keyboard ← →, swipe on the phone; **Esc** closes.
- [ ] **Load full quality** downloads the original (HEIC: may say "cannot be shown in full quality" on Windows/Android; the large preview still works).
- [ ] Video → ▶ → download progress → plays (if the format is not supported, the "Open in Google Drive" link works).
- [ ] Info panel: date, size, dimensions, category, album, origin, description.
- [ ] Change the **origin** and type a **description** → reload the app on another device → both are kept (saved in `mymedia.json`).
- [ ] `mymedia.json` exists in the `MyMedia` folder and contains your media.
- [ ] Scroll through a large folder (1,000+ files) → no freezing.

### Languages (§9)
- [ ] First start is in **Hebrew**, right-to-left: menu on the right, grid starts on the right, back/next arrows mirrored.
- [ ] Settings → **Français** / **English** → switches immediately, without restarting, left-to-right; reopen the app → the choice is kept.
- [ ] Dates: Hebrew `05.10.2026`, French `05/10/2026`, English `10/05/2026`.
- [ ] Sizes formatted in the language: French `2,4 Mo`, English and Hebrew `2.4 MB`.
- [ ] Hebrew album names display correctly in the French/English interface, and Latin names in the Hebrew interface (e.g. "Work" category, `IMG_1234.jpg`).

### Offline & install (§10)
- [ ] Install the app (phone and computer) – see the setup guide, Part F.
- [ ] Browse a few albums, then switch on airplane mode and reopen the app → the gallery and already-seen thumbnails are shown, with the offline icon.
- [ ] Back online → loading resumes by itself.
