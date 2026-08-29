import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  server: {
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/dev-dist/**', '**/.chrome-test-profiles/**']
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      manifest: false, // manifest inject dynamically per-tenant in TenantContext
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
})
