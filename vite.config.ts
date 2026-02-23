import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    strictPort: true,
  },
  cacheDir: `${process.env.USERPROFILE || process.env.HOME}/.cache/vite/morbvis`,
})
