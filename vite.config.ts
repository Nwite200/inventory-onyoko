import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// onnxruntime-web references its own copy of the .wasm file, which Vite then duplicates into dist/assets (15 MB).
// The app never uses it (the runtime is loaded from public/ort and cached on the device), so drop the duplicate.
const dropDuplicateOrtWasm = {
  name: 'drop-duplicate-ort-wasm',
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const key of Object.keys(bundle)) if (/^assets\/ort-wasm.*\.wasm$/.test(key)) delete bundle[key];
  },
};

export default defineConfig({
  plugins: [
    react(),
    dropDuplicateOrtWasm,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'OpenPOS',
        short_name: 'OpenPOS',
        description: 'Offline-first point of sale with a voice inventory assistant',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f766e',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        // white-label config is fetched fresh when online, cached copy used offline
        runtimeCaching: [
          { urlPattern: /\/config\.json$/, handler: 'NetworkFirst', options: { cacheName: 'openpos-config' } },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
