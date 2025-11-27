// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import FullReload from 'vite-plugin-full-reload'

export default defineConfig({
  plugins: [
    vue(),
    FullReload(['public/timeline/dist/**'])
  ],
})