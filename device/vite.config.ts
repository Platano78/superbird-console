import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    react(),
    /**
     * REQUIRED, not an optimisation. The app is loaded from file:// in the
     * device's Chromium kiosk, and browsers refuse `<script type="module">`
     * over file:// — "non-JavaScript MIME type of ''". Only the classic-script
     * (nomodule) output this plugin emits will execute. The stock Spotify
     * webapp ships the same legacy pair for the same reason.
     */
    legacy({ targets: ['chrome >= 69'], renderLegacyChunks: true }),
  ],
  /**
   * DEMO MODE build flag: `SUPERBIRD_DEMO=1 npm run build` bakes demo on.
   * Always defined as a literal boolean, so an ordinary build folds every
   * `__SUPERBIRD_DEMO__` branch away to `false` at compile time -- the
   * fixtures cost nothing (and ship nothing) when the flag is off.
   */
  define: { __SUPERBIRD_DEMO__: JSON.stringify(process.env.SUPERBIRD_DEMO === '1') },
  base: './',
  build: { target: 'es2017', assetsInlineLimit: 0, cssCodeSplit: false },
})
