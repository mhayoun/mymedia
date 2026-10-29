import type { CapacitorConfig } from '@capacitor/cli'

// The Android app: the same web app (dist/, built with `npm run build:android`)
// inside a native shell that adds Google sign-in without clicks and the Share menu.
const config: CapacitorConfig = {
  appId: 'com.mediakeep.app',
  appName: 'MyMedia',
  webDir: 'dist',
  android: {
    // Served as https://localhost inside the app.
    path: 'android',
  },
}

export default config
