import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
const devPort = Number(process.env.VITE_PORT) || 5174
export default defineConfig({
  plugins: [react()],
  // Vite's (and Vitest's) cache lives in the workspace's shared node_modules, so admin/ keeps no node_modules.
  cacheDir: '../node_modules/.cache/vite/admin',
  server: {
    port: devPort,
    proxy: {
      // Forward /dev/* (e.g. /dev/gmag-game-data) to admin-backend so browser can open same origin
      '/dev': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    // Keep one React instance across the application and linked workspace packages.
    dedupe: ['react', 'react-dom', 'react-is'],
  },
  define: {
    'import.meta.env.VITE_WS_URL': JSON.stringify(process.env.VITE_WS_URL || 'ws://localhost:4000/graphql'),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Keep React and router dependencies in the shared vendor chunk.
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'react-vendor'
            if (id.includes('recharts')) return 'recharts'
            if (id.includes('@apollo/client') || id.includes('graphql-ws') || id.includes('zen-observable')) return 'apollo'
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
