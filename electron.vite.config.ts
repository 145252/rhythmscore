import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// 测试解锁开关:RS_TEST_UNLOCK=1 打包时,编译进"开发者测试解锁"逻辑;正式打包(默认)该逻辑被剔除
const TEST_UNLOCK = process.env.RS_TEST_UNLOCK === '1'

export default defineConfig({
  main: {
    build: { outDir: 'out/main' },
    define: { __TEST_UNLOCK__: JSON.stringify(TEST_UNLOCK) }
  },
  preload: {
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    },
    plugins: [react()]
  }
})
