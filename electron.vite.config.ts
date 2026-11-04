import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          circle: resolve(__dirname, 'src/renderer/circle/index.html'),
          gemini: resolve(__dirname, 'src/renderer/gemini/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          home: resolve(__dirname, 'src/renderer/home/index.html'),
          results: resolve(__dirname, 'src/renderer/results/index.html')
        }
      }
    }
  }
})
