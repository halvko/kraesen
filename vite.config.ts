import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets the same build run at a custom domain's root ("/", the default)
// or under a project path such as "/kraesen/" before a domain is attached.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Kraesen',
        short_name: 'Kraesen',
        description: 'Plan meals around your macro goals and what you have at home.',
        theme_color: '#3d7a3a',
        background_color: '#f6f4ee',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API calls (Claude, Open Food Facts) must always go to the network.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
