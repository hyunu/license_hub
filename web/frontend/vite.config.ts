import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 서브경로에서도 동작하도록 상대 경로 사용
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
})