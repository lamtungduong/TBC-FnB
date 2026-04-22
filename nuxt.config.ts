import { defineNuxtConfig } from 'nuxt/config'
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  srcDir: 'src/',
  devtools: { enabled: true },
  runtimeConfig: {
    public: {
      /** Build id thay đổi mỗi lần build/deploy — dùng để reset cookie trên client khi có bản cập nhật (trừ cookie đăng nhập admin). */
      buildId: process.env.BUILD_ID || String(Date.now()),
      appVersion: '1.1.0'
    }
  },
  app: {
    head: {
      title: 'TBC - FnB',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },
  css: ['~/assets/main.css'],
  vite: {
    resolve: {
      alias: {
        '#app-manifest': fileURLToPath(
          new URL('./src/app-manifest.stub.ts', import.meta.url)
        )
      }
    }
  }
})

