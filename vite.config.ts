import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 使用相对路径，方便部署到任意子目录 / 静态托管
  base: './',
  server: {
    port: 5173
  }
})
