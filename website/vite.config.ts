import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // 官网部署在 爱买买.com/aimaimia/ 下
  // 落地页（app.爱买买.com）部署时需将 base 改为 '/'
  base: '/aimaimia/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5175,
  },
})
