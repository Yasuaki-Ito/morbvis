import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        benchmark: resolve(__dirname, 'benchmark.html'),
        benchmark_simple: resolve(__dirname, 'benchmark_simple.html'),
      },
    },
  },
  server: {
    strictPort: true,
  },
  cacheDir: `${process.env.USERPROFILE || process.env.HOME}/.cache/vite/morbvis`,
})
