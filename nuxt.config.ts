import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  srcDir: 'src/',
  devtools: { enabled: true },
  app: {
    head: {
      title: 'TBC - FnB',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },
  css: ['~/assets/main.css'],
})

