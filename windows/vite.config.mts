import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(projectDirectory, 'renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(projectDirectory, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
