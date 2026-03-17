import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import dotenv from 'dotenv'

// Carrega o .env do projeto raiz para ler DASHBOARD_PORT
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const backendPort = process.env.DASHBOARD_PORT || '3000'
const backendUrl = `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../src/dashboard/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backendUrl,
      '/ws': { target: backendUrl.replace('http', 'ws'), ws: true },
    },
  },
})
