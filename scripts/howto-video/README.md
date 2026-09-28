# 사용 방법 자막 영상 만들기

화면을 실제로 클릭해 가며 녹화하고, 가짜 커서·강조 링·하단 자막을 얹어 mp4로 만든다.
API는 전부 가짜 응답(mocks*.mjs)으로 채우므로 실제 계정이나 외부 호출이 필요 없다.

```bash
npm run build && npx vite preview --port 4173 &        # 로컬 미리보기
export FFMPEG_PATH=/path/to/ffmpeg                       # H.264 인코더가 있는 ffmpeg
node scripts/howto-video/sourcing.mjs                    # 소싱AI
node scripts/howto-video/profit.mjs                      # 정산AI › 순이익
node scripts/howto-video/scenes-coupang.mjs [view ...]   # 정산AI 하위 화면 13개 (예: costs price)
node scripts/howto-video/scenes-tabs.mjs [tab ...]       # 홈·순위추적·리뷰·광고분석·코칭·내 작업·구독
# → scripts/howto-video/out/*.mp4 를 public/howto/ 로 옮기고 src/lib/howto.ts 의 video: 에 연결
```

- 크로미움 경로를 지정하려면 `CHROME_PATH=/path/to/chrome`.
- 한글 서체: 시스템에 Pretendard가 없으면 자막이 깨진다. `npm i pretendard` 후 `dist/public/static/*.otf`를 `~/.fonts`에 넣고 `fc-cache -f`.
- 화면 문구를 바꾸면 시나리오의 선택자(`h.spot`·`h.click`)도 맞춰야 한다. 실행 로그의 `!! no box` 줄이 놓친 선택자다.
- 새 화면 영상은 시나리오 하나를 복사해 자막(`h.cap`)과 동작만 바꾸면 된다. 필요한 API 응답은 mocks 파일에 추가한다.
