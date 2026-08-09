import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/admin-v2/',
  resolve: {
    alias: { '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src') },
  },
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5174 },
})
