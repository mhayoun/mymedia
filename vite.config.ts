/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from the domain root (Vercel). BASE_PATH allows hosting under a sub-path.
const base = process.env.BASE_PATH ?? '/'
// Raised at each release (commit, push, deploy) by `npm version patch`; shown in the menu and Settings.
const version = (JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string }).version

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // HEIC decoder (3 MB): downloaded only when an iPhone photo is compressed.
        globIgnores: ['**/heic-to-*.js', '**/mediabunny-aac-encoder-*.js'],
      },
      manifest: {
        name: 'MyMedia',
        short_name: 'MyMedia',
        description: 'Photo & video organizer for Google Drive',
        lang: 'he',
        dir: 'rtl',
        start_url: base,
        scope: base,
        display: 'standalone',
        // Android: MyMedia appears in the Share menu of the gallery, WhatsApp…
        share_target: {
          action: `${base}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'media', accept: ['image/*', 'video/*'] }] },
        },
        background_color: '#101418',
        theme_color: '#1f6feb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The service worker only runs in the production build (npm run build / preview).
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
  },
})
