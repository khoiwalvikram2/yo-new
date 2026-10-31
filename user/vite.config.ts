import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const port = Number(env.VITE_PORT || env.PORT || 5173)
  return {
    plugins: [
      react(),
      // Transform HTML to replace env variables with defaults
      {
        name: 'html-transform',
        transformIndexHtml(html) {
          return html.replace(
            /%VITE_API_APP_NAME%/g,
            env.VITE_API_APP_NAME || 'NOVA'
          )
        },
      },
    ],
    resolve: {
      dedupe: ['react', 'react-dom', 'react-is'],
      alias: {
        '@': '/src',
      },
    },
    server: {
      port: Number.isFinite(port) ? port : 5173,
      host: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Keep React core together to avoid multiple instances
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': ['antd', '@ant-design/icons', 'lucide-react'],
            'utils-vendor': ['axios', 'zod', 'sonner'],
            'i18n-vendor': ['i18next', 'react-i18next'],
            'socket-vendor': ['socket.io-client'],
          },
        },
      },
      chunkSizeWarningLimit: 1000, // Increase limit to 1MB for large assets
    },
    define: {
      // Provide default for VITE_API_APP_NAME if not set
      'import.meta.env.VITE_API_APP_NAME': JSON.stringify(
        env.VITE_API_APP_NAME || 'NOVA'
      ),
    },
  }
})
