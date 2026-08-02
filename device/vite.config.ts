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
  base: './',
  build: { target: 'es2017', assetsInlineLimit: 0, cssCodeSplit: false },
})
