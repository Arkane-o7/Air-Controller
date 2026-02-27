import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['ws', 'bonjour-service', 'qrcode', 'vigemclient']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: []
      }
    }
  },
  renderer: {
    plugins: [react()]
  }
})
