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
    rollupOptions: {
      output: {
        /**
         * 라이브러리를 앱 코드와 나눈다.
         *
         * 전부 한 덩어리면 화면 한 줄만 고쳐도 1.3MB를 통째로 다시 받는다.
         * 라이브러리는 거의 안 바뀌므로 따로 두면 브라우저 캐시에 남는다.
         *
         * 엑셀(xlsx)은 특히 크고, 쓰는 곳이 순이익 내려받기·원가 올리기·광고
         * 보고서 읽기뿐이다. 대부분의 방문은 한 번도 안 쓴다.
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-xlsx': ['xlsx'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
    // 청크를 나눴으니 경고 기준도 현실에 맞춘다
    chunkSizeWarningLimit: 700,
  }
})
