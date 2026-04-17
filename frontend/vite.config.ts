import fs from 'fs'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:3001';

/** Dev-only plugin: lets the theme editor write tokens.css via POST /__theme-write */
function themeWritePlugin(): Plugin {
  const tokensPath = path.resolve(__dirname, 'src/styles/tokens.css');
  return {
    name: 'theme-write',
    apply: 'serve', // dev only
    configureServer(server) {
      server.middlewares.use('/__theme-write', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            fs.writeFileSync(tokensPath, body, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), themeWritePlugin()],
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
      '/credentials':{ target: BACKEND, changeOrigin: true },
      '/health':  { target: BACKEND, changeOrigin: true },
      '/news':    { target: BACKEND, changeOrigin: true },
      '/holidays':{ target: BACKEND, changeOrigin: true },
      '/database':{ target: BACKEND, changeOrigin: true },
      '/drawings':  { target: BACKEND, changeOrigin: true },
      '/blacklist': { target: BACKEND, changeOrigin: true },
      '/hubs':    { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
})
