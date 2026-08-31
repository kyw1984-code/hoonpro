import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  // tailwindcss 플러그인이 소스를 스캔해 유틸리티 CSS를 빌드에 포함시킨다.
  // (예전에는 이 등록이 빠져 있어 index.html의 Tailwind CDN이 런타임에 대신 처리했다)
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  }
})
