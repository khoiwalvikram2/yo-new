import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The CRM runs at crm.<whitelabel-domain> in production. In development it gets
// its own port so it can run beside the admin panel rather than instead of it.
const devPort = Number(process.env.VITE_CRM_PORT) || 5175

export default defineConfig({
  plugins: [react()],
  // Vite's (and Vitest's) cache lives in the workspace's shared node_modules, so crm/ keeps no node_modules.
  cacheDir: '../node_modules/.cache/vite/crm',
  server: {
    port: devPort,
    hmr: { port: devPort, host: 'localhost' },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
    // One React instance for the app and antd both.
    dedupe: ['react', 'react-dom', 'react-is'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'react-vendor'
            if (id.includes('@apollo/client') || id.includes('graphql')) return 'apollo'
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
