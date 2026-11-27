# 쇼크트리AI (크롬 확장 프로그램)

소싱AI 상품 목록에서 [윙에서 바로 가져오기]를 누르면, 같은 브라우저의 쿠팡 윙 로그인으로
경쟁 상품의 최근 28일 클릭수·판매량·카테고리를 읽어 훈프로에 저장한다.
정산AI·광고분석AI에서 [광고센터에서 바로 가져오기]를 누르면 광고센터 탭 안에서 보고서를 만들어 광고비를 저장한다 (`adCollect.js`).

- `content.js` — hoonproai.com 페이지와 확장 사이의 다리 (같은 출처 메시지만 받는다)
- `background.js` — 윙 검색 호출. 직접 호출이 막히면 윙 탭 안에서 다시 시도
- `wingSearch.js` — 검색·매칭 본체 (src/lib/wingStats.ts 즐겨찾기와 같은 로직)

## 배포용 zip 만들기

```
cd extension && rm -f ../public/hoonpro-extension.zip && zip -r ../public/hoonpro-extension.zip . -x README.md
```

고친 뒤에는 manifest.json의 version을 올리고 zip을 다시 만든다.
크롬 웹스토어 등록 전까지는 사용자가 chrome://extensions → 개발자 모드 →
"압축해제된 확장 프로그램을 로드합니다"로 설치한다.
