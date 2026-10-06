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
- [ ] Videos show a ▶ badge with their duration **and a picture from the video** (Drive's thumbnail, or else a frame taken about 1 second into the video – also for videos Drive shows without a preview).
- [ ] Click a photo → large view; arrows, keyboard ← →, swipe on the phone; **Esc** closes.
- [ ] **Load full quality** downloads the original (HEIC: may say "cannot be shown in full quality" on Windows/Android; the large preview still works).
- [ ] Video → ▶ → download progress → plays (if the format is not supported, the "Open in Google Drive" link works).
- [ ] Info panel: date, size, dimensions, category, album, origin, description.
- [ ] 🗑 **Delete** in the large view → confirmation → the next photo is shown; the file is in the Google Drive **trash** (restorable 30 days) and gone from the app on all devices.
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

## Phase 2a – Classification by folder, file name and learning (§4, §4b)

Preparation: in Drive, have a few albums with **at least 3 photos each** (your
birds), then put a few new bird photos **directly in `MyMedia`** or directly in
`Birds` (not in an album).

### Learning (§4b)
- [ ] After **Load new files**, the top bar shows "Learning x / y" (first time on 5,000 photos: about 25 minutes on a computer, longer on a phone). The app stays usable meanwhile.
- [ ] The ⏸ button next to it pauses the learning; it continues at the next load.
- [ ] `mymedia-index.json` and `mymedia-index.bin` appear in the `MyMedia` folder.
- [ ] On a second device, learning is much faster (it reuses those files).
- [ ] Settings → **Learning statistics**: number of media learned, overall accuracy, albums with fewer than 3 photos, accuracy per album and "confused with".
- [ ] Settings → **Rebuild learning** starts again from zero (progress visible).

### Classification
- [ ] A new photo named like an album (e.g. `נחליאלי לבן.jpg` at the root) goes straight into that album (Classified by: **File name**).
- [ ] A new photo with a meaningful name that matches no album (e.g. `mom_birthday.jpg`) gets that text as description.
- [ ] Automatic names (`IMG_1234`, `IMG-20260105-WA0001`, `PXL_…`, `Screenshot_…`) are ignored.
- [ ] A recognised photo (≥ 85 %, album with ≥ 3 photos) is moved by itself → menu **Classified automatically**: card "Moved to …"; **Correct** or **Correct to…** (check in drive.google.com that the file really moved).
- [ ] A less certain photo appears in **To classify** with the suggested album and %, plus 3 alternatives: tap the suggestion → moved; or **Other album…**; or **Keep here** (no more suggestions).
- [ ] Below 60 % the card shows **To check**.
- [ ] **Accept N suggestions ≥ 60 %** moves them all.
- [ ] Settings → untick "Move files automatically…" → new photos only get suggestions.
- [ ] Settings → change the two thresholds → the next classification uses them.
- [ ] Large view → information panel: "Classified by" (Folder / File name / Learning / You, with %), and **Move to** any album.
- [ ] A correction is learned: after correcting a few photos of a species, similar new photos are suggested correctly.
- [ ] Videos are classified too (from 3 frames: start, middle, end).
- [ ] Files in folders starting with `_` are never used nor classified.

## Phase 3 – Compression (§6)

### New files found in Drive
- [ ] Add 2 big photos (e.g. 10 MB) to an album in Drive → **Load new files** → a window **"New files to compress"** lists them: name, size now → estimated size after, % saved, each with a tick box, and the total for the selection.
- [ ] Untick one → **Compress 1 file** → the row shows the real new size (✓ 1.4 MB); the unticked file is not proposed again at the next load.
- [ ] **Later** → the window closes; the files are proposed again the next time the app is opened.
- [ ] In Drive the compressed file is now about 1–2 MB, **same name, same place**; File information still shows date taken and camera; the photo is upright.
- [ ] A WhatsApp photo (`IMG-…-WA…`) or a photo under 3 MB is not proposed. Files you had before Phase 3 are not proposed.
- [ ] Settings → Compression → "When big new files are found in Drive": **Compress them automatically** → no window, a message "N new files compressed automatically"; **Do nothing** → no window.
- [ ] A big video (> 50 MB) is proposed **on a computer only**.

### Manual
- [ ] Select an album or category → **Compress** icon (two arrows) → the same list with tick boxes (size now → estimated after), and below it what is skipped and why (already compressed, too small…).
- [ ] **Compress** → progress (also at the top of the screen, with × to cancel) → "Done: N files compressed, X saved".
- [ ] Large view → information panel → Compression status ("Compressed: 9.7 MB → 1.5 MB") and a **Compress** button for one file.
- [ ] iPhone HEIC photo → becomes a `.jpg`, with date / camera / GPS kept.
- [ ] Video (computer, Chrome or Edge) → becomes 1080p MP4, **with its sound**.
- [ ] Compressing again the same album → "already compressed by MyMedia" (never compressed twice, even after moving or renaming the file).
- [ ] Album, description, classification of a compressed file are unchanged.

### Originals (Settings → Compression → The original)
- [ ] **Replace** (default): in Drive, right-click the file → File information → **Manage versions**: the original version is there (about 30 days).
- [ ] **Copy to _Originals**: the original appears in `MyMedia/_Originals/<category>/<album>/`; that folder never appears as a category in MyMedia.
- [ ] **Keep forever in version history**: Manage versions → the original is marked "Keep forever".

### Settings
- [ ] Quality 70/80/85/90 %, maximum size 2048/3000/4000 px/unchanged, HEIC/PNG → JPEG, video 720p/1080p and quality, origins for automatic compression, minimum size, minimum gain, "Restore default settings".
- [ ] A file that would not shrink by at least 15 % is left unchanged ("Kept unchanged (not enough gain)").

## Upload from the app, with the real date (§3, brought forward from Phase 5)

- [ ] Open an album (e.g. Family / David) → **Add** → **Choose photos / videos** (on a phone: the gallery opens; select several).
- [ ] The list shows each file with **its real date** and where it comes from: "photo date" (EXIF), "recording date" (video), "date from name" (`IMG-20240501-WA0003.jpg`), or "file date".
- [ ] A file already in Drive (same content) is marked **already in Drive** and unticked.
- [ ] Size now → ≈ size after compression; "Compress before upload" can be unticked.
- [ ] **Upload N files** → each row shows compression / upload progress, then ✓ and the final size.
- [ ] In MyMedia, the new files are sorted at their **real date** (not today). In Drive, File information → "Created" shows that date.
- [ ] Computer: **Choose a whole folder** (also from a USB stick / SD card) → sub-folders become albums under the destination ("Keep the sub-folders as albums").
- [ ] **Another folder…** changes the destination before uploading.
- [ ] Videos already copied into Drive earlier: after **Load new files**, they move to their real recording date in the gallery (sort "Newest first").

## Phase 4 – Faces (§5)

- [ ] First opening after the update: a window **"Face recognition is on"** explains what it does, that everything stays on the device and in your Drive, with a switch to turn it off and **Delete all face data**. It is shown only once.
- [ ] After **Load new files**, the top bar shows "Learning x / y": faces are searched for at the same time (first time: one-off download of the face models, 38 MB per device).
- [ ] Side menu → **People → All people**: **Faces to name** shows one picture per group of faces of the same person, with the number of photos.
- [ ] Open a group → type a name (e.g. "Noa") → **Save** → the person appears in the side menu with their photo count.
- [ ] Click the name in the side menu (or **See the N photos**) → only their photos are shown.
- [ ] A new photo of that person (after Load new files) is named automatically.
- [ ] **Is it Noa?** cards (uncertain faces): **Yes** adds the face to Noa, **No** never asks again for that face.
- [ ] Two groups of the same person: open one → **Same person as…** → choose the other (or type the same name) → merged.
- [ ] A wrong face in a group: tick it → **Not Noa** (leaves the group) or **Another person** (new group) or **Move to…** another person.
- [ ] Large view → information panel → **People in this photo**: faces with names; click one → that person's window.
- [ ] `mymedia-faces.json` appears in the `MyMedia` folder; on a second device the people and names are already there (faces are not searched again).
- [ ] Settings → Faces → untick **Face recognition** → the People section disappears and no more faces are searched; tick again → back.
- [ ] Settings → Faces → **Delete all face data** → confirmation → people and names are gone, `mymedia-faces.json` is deleted from Drive; photos untouched.
- [ ] Compressing a photo keeps its faces and names.

## Phase 5 – Selection, search, filters, export, Share menu (§3, §8)

### Search & filters
- [ ] Search box: a file name, a word of a description, an album or species name (Hebrew with or without vowel points), a person's name → only matching media. Accents and capitals are ignored.
- [ ] **Filters**: origin (camera / WhatsApp / web / import / unknown), classification (classified / not classified / to check / classified automatically), compression (compressed / already compressed / not compressed), person. Each active filter shows as a chip with × to remove it.
- [ ] Filters combine with the category / album chosen in the side menu, and with Photos / Videos.

### Multi-select
- [ ] **Select** (or long press on a photo on the phone, Ctrl/⌘-click on a computer) → tick marks; Shift-click selects a range; **Select all**; **×** or Esc leaves.
- [ ] **Move to…** an album: the files move in Drive.
- [ ] **New album** with the selection: the album is created in the current category and the files move into it.
- [ ] **Description**: the same description on all selected files.
- [ ] **Person**: a name added by hand (photos where the face is not visible); then searchable and shown in the export.
- [ ] **Compress** the selection (list with sizes, as in Phase 3).
- [ ] **Export** the selection; **Delete** (Drive trash, after confirmation).

### Export
- [ ] **Export** (toolbar) → Excel or CSV of the media shown (current album / filters / search), headers in the interface language: file name, date, category, album, description, people, species, origin, size, Drive link.
- [ ] Excel file in Hebrew: the sheet is right-to-left and Hebrew is readable. CSV opens correctly in Excel (UTF-8; ";" separator in French).

### Share menu (Android, installed app)
- [ ] After installing the update (if MyMedia does not appear in the Share menu, uninstall and reinstall the app from Chrome), Gallery / WhatsApp → select photos → **Share** → **MyMedia**.
- [ ] MyMedia opens on **Add photos and videos** with the shared files, their real dates and the duplicates detected; tap a recent destination (e.g. Family / David) or **Another folder…**, then **Upload**.
- [ ] iPhone: not available (Apple does not allow it for web apps) — use **Add** inside MyMedia.
