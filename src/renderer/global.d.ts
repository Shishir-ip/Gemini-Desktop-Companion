import type { GdcApi } from '../preload/index'

declare global {
  interface Window {
    gdc: GdcApi
  }
}

export {}
