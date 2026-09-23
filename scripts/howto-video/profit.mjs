import { record } from './harness.mjs';
import { profitMocks, fakeToken, TOKEN_KEY } from './mocks.mjs';

await record({
  name: 'coupang-profit-guide',
  title: '정산AI · 순이익',
  subtitle: '매출에서 수수료 · 원가 · 광고비를 뺀 진짜 이익',
  token: fakeToken(), tokenKey: TOKEN_KEY,
  mocks: profitMocks,
  async run(h) {
    h.steps(10);
    await h.goto('/?tab=coupang');
    await h.titleCard();

    await h.cap('쿠팡 연동을 마쳤다면 <b>지금 수집</b>으로 주문 · 매출 · 반품을 가져옵니다');
    await h.spot('button:has-text("지금 수집")', 2400, 8);
    await h.sleep(300);

    await h.cap('기간은 <b>7일 · 30일 · 90일</b> 버튼이나 날짜 입력으로 바꿉니다');
    await h.spot('button:has-text("최근 90일")', 2200, 8);
    await h.sleep(300);

    await h.cap('원가가 빈 상품이 있으면 먼저 알려줍니다. 원가가 없으면 순이익이 실제보다 크게 나옵니다');
    await h.spot('text=/원가가 비어 있습니다/', 2400, 8).catch(async () => { await h.sleep(2400); });
    await h.sleep(300);

    await h.cap('요약 카드 — <b>매출 · 수수료 · 원가 · 광고비 · 순이익 · 이익률</b>. 직전 기간 대비 증감도 붙습니다');
    await h.scroll('p:text-is("쿠팡 수수료")', { after: 700 }).catch(async () => { await h.scroll(700, { after: 700 }); });
    await h.spot('div:has(> p:text-is("순이익"))', 2600, 10).catch(async () => { await h.sleep(2600); });
    await h.sleep(300);

    await h.cap('<b>일별 추이</b> 그래프로 매출과 순이익이 어느 날 움직였는지 봅니다');
    await h.scroll('h3:has-text("일별 추이")', { after: 700 });
    await h.spot('h3:has-text("일별 추이")', 1800, 8);
    await h.sleep(1200);

    await h.cap('그 아래 <b>광고비 대비 순이익</b> 차트 — 광고를 늘렸을 때 이익이 따라왔는지 확인합니다');
    await h.scroll('text=/광고비 대비 순이익/', { after: 800 }).catch(async () => { await h.scroll(420, { after: 800 }); });
    await h.spot('text=/광고비 대비 순이익/', 2000, 8).catch(() => {});
    await h.sleep(1000);

    await h.cap('<b>상품별 순이익</b> 표 — 옵션마다 매출 · 원가 · 광고비 · 반품을 뺀 이익과 이익률입니다');
    await h.scroll('h3:has-text("상품별 순이익")', { after: 700 });
    await h.spot('h3:has-text("상품별 순이익")', 1800, 8);
    await h.sleep(1200);

    await h.cap('원가가 빈 줄에는 <b>원가 미입력</b> 표시가 붙습니다. [원가 입력]에 넣어야 순이익이 맞습니다');
    await h.spot('text=/원가 미입력/', 2600, 8).catch(async () => { await h.sleep(2600); });
    await h.sleep(300);

    await h.cap('<b>엑셀 내려받기</b> — 요약 · 상품별 · 일별 시트로 받아 세무 자료로 넘길 수 있습니다');
    await h.spot('button:has-text("엑셀 내려받기")', 2400, 8);
    await h.sleep(300);

    await h.cap('아래로 내리면 <b>월별 순이익</b>과 <b>쿠폰 효과 비교</b>가 이어집니다');
    await h.scroll('h3:has-text("월별 순이익")', { after: 800 });
    await h.spot('h3:has-text("월별 순이익")', 1800, 8);
    await h.sleep(1200);
  },
});
