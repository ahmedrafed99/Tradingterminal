import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/auth':    { target: BACKEND, changeOrigin: true },
      '/accounts':{ target: BACKEND, changeOrigin: true },
      '/market':  { target: BACKEND, changeOrigin: true },
      '/orders':  { target: BACKEND, changeOrigin: true },
      '/trades':  { target: BACKEND, changeOrigin: true },
      '/settings':{ target: BACKEND, changeOrigin: true },
      '/health':  { target: BACKEND, changeOrigin: true },
      '/hubs':    { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
})
