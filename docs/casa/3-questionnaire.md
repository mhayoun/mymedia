# 3. Questionnaire du laboratoire CASA (réponses préparées)

Le laboratoire envoie un questionnaire (basé sur l'ASVS de l'OWASP). Voici les réponses factuelles, en anglais,
tirées du code actuel. À adapter aux questions exactes.

## Architecture

- **Type**: single-page web app (React, built with Vite) served as static files by Vercel at
  https://www.media-keep.com, plus an Android app (WebView of the same app). One serverless function:
  `/api/models` (Vercel Functions, Node.js).
- **Where user data lives**: in the user's own Google Drive (photos, videos, albums as folders, MyMedia's
  JSON files with dates, labels and on-device recognition fingerprints). A working copy (file list, small
  thumbnails) is cached in the browser's IndexedDB on the user's device, one database per account.
- **Data flow**: browser ⇄ Google APIs directly (www.googleapis.com, with the user's access token).
  Photos and Drive contents never go through our server.

## Authentication and tokens

- Google Identity Services (token model, OAuth 2.0 implicit grant for browsers). Access token only, no
  refresh token, lifetime 1 hour; renewed by GIS when needed.
- The access token is kept in the browser's localStorage on the user's device so the app reopens without a new
  sign-in during the hour; it is removed on sign-out. The app has no third-party scripts except Google's
  `accounts.google.com/gsi/client`, and a Content-Security-Policy limits where scripts can come from.
- **Server**: receives the access token in the `Authorization` header only for MyMedia Pro and the model shop.
  It checks it with Google (`oauth2.googleapis.com/tokeninfo`, sent by POST, never in a URL; the audience must be one of MyMedia's client IDs)
  and reads the account's address (`drive/v3/about?fields=user(emailAddress)`). The token is never written to
  storage or logs; the result is kept in the function's memory for at most 10 minutes.

## Data stored on our side (Vercel Blob, private store)

| Path | Content | Personal data |
|---|---|---|
| `pro/<hash>.json` | Pro status: the account's address, until when, purchases (PayPal order id, plan, price) | email address (file named by its SHA-256 hash) |
| `full/<hash>.json` | that the account chose the full Drive access | hash only |
| `licences/<id>/<hash>.json` | a bought recognition model's licence: the account's address, date, price, order | email address |
| `orders/…`, `sales/…` | PayPal order ids, amounts, seller's share | seller's PayPal address (to pay them) |
| `models/<id>/…` | models published by a seller: album names and numeric fingerprints (no photos) | seller's account, by their choice |

- Only what is needed for Pro and the shop (email address, purchases). No photos, no file names, no Drive contents, no tokens.
- Payments are made on PayPal's pages; we never see card details.
- Access to the store: the Vercel project's owner only (2-factor sign-in on Vercel and Google).

## Encryption

- HTTPS everywhere (Vercel, HSTS `max-age=63072000`). Google APIs over HTTPS.
- Vercel Blob is encrypted at rest by the provider.

## Deletion

- The user removes MyMedia's access in their Google account; their library stays in their Drive (it is
  theirs). Local data: sign-out, or clearing the site's data in the browser.
- On request (contact address in the privacy policy) we delete the account's `pro/`, `full/` and `licences/`
  records.

## Development and dependencies

- Source in a private Git repository; every change is type-checked (`tsc`) and tested (`vitest`) before release.
- `npm audit` before each release; dependencies kept up to date.
- Secrets (PayPal, admin list) are Vercel environment variables, never in the code. The Google client IDs
  and the public API key (restricted to the Drive API and to MyMedia's sites) are public by design.

## Incident response

- Owner contact: the support address shown on the consent screen. On a suspected leak: rotate the PayPal
  secret and Vercel tokens, revoke and recreate the API key, inform affected users and Google within 72 hours.
