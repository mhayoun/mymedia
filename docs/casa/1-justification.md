# 1. Justification du scope (à coller dans le formulaire Google)

Google demande pour chaque scope restreint : à quoi il sert, et pourquoi un scope plus étroit ne suffit pas.
Le texte est en anglais (les réviseurs lisent l'anglais) ; la traduction française suit.

---

## App description (English)

> MyMedia (https://www.media-keep.com) is a photo and video organizer that works entirely inside the user's
> own Google Drive. The user's library is a folder in their Drive (by default "MyMedia"): its sub-folders are
> the categories and albums, and the photos and videos stay in the user's Drive. MyMedia shows them as a
> gallery, sorts them into albums (the user's own on-device recognition), finds duplicates and blurry photos,
> keeps their real dates, and lets the user share their library read-only with chosen people.
> The app runs in the browser (and as an Android app); photos go directly between the user's device and
> Google Drive and never pass through our server.

## Scope `https://www.googleapis.com/auth/drive` (English)

> **Why MyMedia needs it**
>
> 1. **Photos added outside MyMedia.** Users put photos into their MyMedia folder with Google Drive itself
>    (drive.google.com, the Drive app on their phone, the Drive desktop app, or a copy from another account).
>    MyMedia must list, show and organise these files. They were not created by MyMedia, so
>    `drive.file` does not give access to them.
> 2. **Libraries shared with the user.** A user can share their MyMedia library, read-only, with chosen
>    people (Google's own Drive sharing, role "reader"). The person it is shared with opens it in MyMedia:
>    MyMedia must read files that another account created. With `drive.file` the shared files are not
>    visible (we tested it: files.get returns 404, and a folder picked with the Google Picker gives access to
>    the folder only, not to the photos inside).
> 3. **Importing from other Drive folders.** The user picks a folder elsewhere in their Drive (for example an
>    old "Camera" folder) and MyMedia copies or moves its photos into their library. This needs to read the
>    folders and files the user chooses, at any depth.
> 4. **Moving albums and fixing the library.** Albums are Drive folders; moving a photo to another album
>    changes its parent folder. Photos added by Drive (point 1) must be movable too.
> 5. **Sending a library to another Google account (transfer).** The user gives their library (or some albums)
>    to another of their accounts: MyMedia shares and copies files the other account must then read and
>    organise.
>
> **Why a narrower scope is not enough**
>
> - `drive.file` only covers files created by MyMedia or opened one by one with the Picker. We offer it:
>   MyMedia has a second, free Google project that uses only `drive.file` for users who only add photos
>   through MyMedia. The full `drive` scope is asked only by users who need points 1 to 5, and only after
>   they choose it.
> - `drive.readonly` is not enough: organising means moving files between album folders, renaming albums,
>   creating folders and writing the photo's date and labels (file properties).
> - `drive.appdata` is not where the photos are: they must stay visible and usable in the user's own Drive.
>
> **What MyMedia does not do**
>
> - It works only inside the library folder the user chose and the folders the user picks to import from.
>   It does not scan or change the rest of the Drive.
> - Google user data is not sold, not used for advertising, not read by humans, and not used to train
>   generalized AI models. On-device recognition runs in the user's browser; its fingerprints are stored in
>   the user's own Drive.
> - Our server never receives photos or Drive contents. It only checks the Google access token (to know the
>   account) for MyMedia Pro and the model shop, and keeps the account's address and purchases, never the token.

---

## Traduction (pour toi)

**Pourquoi MyMedia en a besoin :**
1. les photos ajoutées dans le dossier MyMedia par Drive lui-même (site, appli téléphone, ordinateur) ne sont pas créées par MyMedia, donc invisibles avec `drive.file` ;
2. une bibliothèque partagée avec quelqu'un : il faut lire des fichiers créés par un autre compte. Nos tests 2 et 3 l'ont montré : 404, et le Picker donne le dossier mais pas les photos ;
3. l'import depuis d'autres dossiers du Drive ;
4. déplacer les photos entre albums, y compris celles ajoutées par Drive ;
5. le transfert vers un autre compte.

**Pourquoi un scope plus étroit ne suffit pas :**
- `drive.file` est déjà proposé par la porte gratuite ; `drive` n'est demandé qu'à ceux qui en ont besoin ;
- `drive.readonly` ne permet pas de ranger ;
- `drive.appdata` n'est pas là où sont les photos.

**Ce que MyMedia ne fait pas :** il ne fouille pas le reste du Drive, ne vend rien, ne fait pas de publicité, et le serveur ne voit jamais les photos ni les jetons.
