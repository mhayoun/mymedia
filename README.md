# MyMedia

Photo & video organizer for Google Drive. Installable app (PWA) for Android,
iPhone, Windows and Mac. Hebrew (default, right-to-left), French, English.

- No server: each user signs in with Google and the app works directly with
  **their own** Drive. Data: `MyMedia/mymedia.json` in the user's Drive.
- Setup (click by click): [docs/SETUP.md](docs/SETUP.md)
- Test checklist: [docs/TESTING.md](docs/TESTING.md)

## Development

```
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # production build in dist/
```

`public/config.json` holds the Google OAuth client ID (read at runtime).
Hosted on Vercel (static files only): https://mymedia-keep.vercel.app — `vercel deploy --prod`.

## Structure

| Path | Role |
|---|---|
| `src/auth/google.ts` | Google sign-in (token model), silent renewal, Reconnect |
| `src/drive/api.ts` | Drive v3 REST client with retries |
| `src/sync/engine.ts` | Full scan once, then Drive Changes API |
| `src/sync/metaStore.ts` | `mymedia.json` load / merge / save |
| `src/sync/thumbs.ts` | Thumbnails cached in IndexedDB (offline) |
| `src/lib/` | Pure logic (tested): media types, origin, tree, changes, metadata |
| `src/i18n/` | Translations (`locales/*.json`) and locale formatting |
| `src/ui/` | React screens |
