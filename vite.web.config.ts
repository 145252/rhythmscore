import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// 纯浏览器预览/调试用配置(不经 Electron),构建输出到 dist-web
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
  },
  server: { port: 5173, open: false }
})
