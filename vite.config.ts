import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
  },
  cacheDir: `${process.env.USERPROFILE || process.env.HOME}/.cache/vite/morbvis`,
})
