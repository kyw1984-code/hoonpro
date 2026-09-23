import { record } from './harness.mjs';
import { sourcingMocks, fakeToken, TOKEN_KEY, SEED } from './mocks.mjs';

await record({
  name: 'sourcing-guide',
  title: '훈프로 소싱AI',
  subtitle: '키워드 발굴부터 쿠팡 시장 분석까지',
  token: fakeToken(), tokenKey: TOKEN_KEY,
  mocks: sourcingMocks,
  async run(h) {
    h.steps(10);
    await h.goto('/?tab=sourcing');
    await h.titleCard();

    await h.cap('검색창에 <b>시드 키워드</b>를 넣고 [키워드 발굴]을 누릅니다', 900);
    await h.type('input[placeholder^="시드 키워드"]', SEED, { delay: 90 });
    await h.click('button:has(svg.lucide-sparkles)', { after: 1400 });
    await h.sleep(600);

    await h.cap('검색어의 <b>월간 검색량 · 클릭 · 경쟁강도 · 기회점수</b>가 맨 위에 나옵니다');
    await h.spot(`text="${SEED}" 월간 검색량`, 2400, 10).catch(async () => { await h.sleep(2400); });
    await h.sleep(400);

    await h.cap('연관 키워드 표는 <b>검색어 관련도순</b>이 기본입니다. 검색어와 가까운 것이 위에 옵니다');
    await h.scroll('table', { after: 700 });
    await h.spot('select:has(option[value="relevance"])', 2200, 8);
    await h.sleep(300);

    await h.cap('<b>등급 · 경쟁강도 · 검색량</b> 필터로 원하는 줄만 남깁니다');
    await h.spot('select:has(option[value="Great"])', 2200, 8);
    await h.sleep(300);

    await h.cap('기회점수는 <b>검색량은 많고 경쟁은 적을수록</b> 높습니다. Great · Good부터 보세요');
    await h.spot('tbody tr:nth-child(2) td:nth-child(5)', 2400, 6);
    await h.sleep(300);

    await h.cap('키워드를 골랐으면 <b>쿠팡 분석</b>을 누릅니다. 실제 검색결과 상위 상품을 분석합니다');
    await h.click('tbody tr:nth-child(2) button:has-text("쿠팡 분석")', { after: 1800 });
    await h.sleep(800);

    await h.cap('<b>시장 요약</b> — 로켓 비율, 리뷰 중앙값, 가격대와 진입 판정이 한눈에 보입니다');
    await h.scroll('span:has-text("쿠팡 시장 분석")', { after: 800 }).catch(() => {});
    await h.sleep(2600);

    await h.cap('상품마다 <b>기회점수와 근거</b>가 붙습니다. 리뷰 증가 속도가 판매 속도의 힌트입니다');
    await h.scroll(700, { after: 900 });
    await h.spot('h3.line-clamp-2', 2200, 10).catch(async () => { await h.sleep(2200); });

    await h.cap('관심 상품은 <b>순위 추적</b>에 올려 두면 매일 순위를 자동으로 기록합니다');
    await h.spot('button[title*="순위를 매일 자동 기록"]', 2400, 8).catch(async () => { await h.sleep(2400); });

    await h.cap('<b>리뷰 분석</b>은 실제 리뷰에서 불만 · 니즈 · 공략 포인트를 뽑고, <b>마진 분석</b>은 손익을 미리 계산합니다');
    await h.spot('button[title^="실제 리뷰를 수집해"]', 1800, 8).catch(() => {});
    await h.spot('button:has-text("마진 분석")', 1600, 8).catch(() => {});
    await h.sleep(600);

    await h.cap('막히는 것이 있으면 화면 위 <b>사용 방법</b> 버튼으로 이 안내를 다시 볼 수 있습니다');
    await h.spot('button:has-text("사용 방법")', 2200, 8).catch(async () => { await h.sleep(2200); });
    await h.sleep(400);
  },
});
