// 홈·순위추적·리뷰·광고분석·코칭·내 작업·구독 탭. node scenes-tabs.mjs [tab ...]
import { record } from './harness.mjs';
import { fakeToken, TOKEN_KEY } from './mocks.mjs';
import { tabMocks } from './mocks-tabs.mjs';

const wait = (h, ms) => h.sleep(ms);
// 광고분석 화면은 창이 아니라 안쪽 영역이 스크롤된다
const innerScroll = (h, sel, offset = 90) => h.page.locator(sel).first().evaluate((el, off) => {
  let p = el.parentElement; while (p && getComputedStyle(p).overflowY !== 'auto' && getComputedStyle(p).overflowY !== 'scroll') p = p.parentElement;
  if (!p) return; const top = el.getBoundingClientRect().top - p.getBoundingClientRect().top + p.scrollTop - off; p.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}, offset).catch(() => {});

const scenes = {
  home: { title: '홈', subtitle: '오늘 볼 것만 한 화면에', steps: 6, async run(h) {
    await h.cap('홈은 <b>오늘 볼 것</b>만 모아 둔 화면입니다. 처음이면 위에 시작 안내가 뜹니다');
    await h.spot('h3:has-text("훈프로 시작하기")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>관심 상품 순위</b> — 순위 추적에 등록한 상품의 오늘 순위와 변동');
    await h.scroll('h3:has-text("관심 상품 순위")', { after: 700 }).catch(() => {});
    await wait(h, 2400);
    await h.cap('<b>이달 목표</b> — 매출 · 순이익 목표를 정해 두면 진행률과 이 속도면 얼마인지 보여줍니다');
    await h.scroll('h3:has-text("월 목표")', { after: 700 }).catch(() => {});
    await h.spot('button:has-text("목표 수정")', 2200, 8).catch(() => wait(h, 2200));
    await h.cap('<b>이번 주 매출 변화</b> — 지난주보다 눈에 띄게 빠지거나 오른 옵션과 그 이유');
    await h.scroll('h3:has-text("이번 주 매출 변화")', { after: 700 }).catch(() => {});
    await wait(h, 2400);
    await h.cap('<b>관심 키워드</b>에서 리뷰가 빠르게 느는 상품과 <b>이번 주 추천 소싱 키워드</b>');
    await h.scroll('h3:has-text("관심 키워드")', { after: 700 }).catch(() => {});
    await wait(h, 2400);
    await h.cap('<b>오늘 남은 사용량</b> — 기능별 하루 한도와 남은 횟수입니다. 자정에 초기화됩니다');
    await h.scroll('h3:has-text("오늘 남은 사용량")', { after: 700 }).catch(() => {});
    await wait(h, 2400);
  } },
  ranktracker: { title: '순위추적AI', subtitle: '내 상품이 몇 위인지 매일 자동 기록', steps: 6, async run(h) {
    await h.cap('키워드와 <b>상품 URL(또는 상품번호)</b>을 넣고 [등록]하면 바로 순위를 확인하고 매일 새벽 기록합니다');
    await h.type('input[placeholder^="추적 키워드"]', '캠핑의자', { delay: 80 });
    await h.type('input[placeholder^="상품 URL"]', 'https://www.coupang.com/vp/products/1002', { delay: 25 });
    await h.click('button:has-text("등록")', { after: 1400 });
    await wait(h, 1600);
    await h.cap('<b>경쟁 상품 변동</b> — 관심 키워드의 상위 상품 중 가격이 내리거나 리뷰가 급증한 것을 7일 전과 견줍니다');
    await h.scroll('h3:has-text("경쟁 상품 변동")', { after: 700 }).catch(() => {});
    await wait(h, 2600);
    await h.cap('<b>추적 중인 상품</b> 카드마다 현재 순위, 변동, 최고 · 최저 순위와 스파크라인이 있습니다');
    await h.scroll('h3:has-text("추적 중인 상품")', { after: 700 }).catch(() => {});
    await wait(h, 2400);
    await h.cap('순위는 <b>광고를 뺀 실제 순위</b>입니다. 광고 포함 순서는 따로 표시됩니다');
    await h.spot('text=/현재 11위|11위/', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>지금 확인</b>은 순위를 즉시 다시 봅니다. 최근 3시간 안에 수집이 없으면 사용 1회가 듭니다');
    await h.spot('button:has-text("지금 확인") >> nth=0', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>이 키워드 경쟁 상품 보기</b>를 누르면 내 위에 있는 상품의 가격 · 리뷰 · 배송이 표로 나옵니다');
    await h.click('button:has-text("이 키워드 경쟁 상품 보기") >> nth=0', { after: 1200 }).catch(() => {});
    await wait(h, 2600);
  } },
  review: { title: '리뷰 분석AI', subtitle: '실제 리뷰에서 불만과 공략 포인트를 뽑습니다', steps: 6, async run(h) {
    await h.cap('쿠팡 <b>상품 URL</b>을 붙여 넣고 [분석]을 누릅니다. 상품명은 넣으면 정확도가 올라갑니다');
    await h.type('input[placeholder^="쿠팡 상품 URL"]', 'https://www.coupang.com/vp/products/1001', { delay: 25 });
    await h.type('input[placeholder^="상품명"]', '초경량 접이식 캠핑의자 릴렉스체어', { delay: 60 });
    await h.click('button:text-is("분석")', { after: 1600 });
    await h.cap('먼저 실제 리뷰를 모으고, 그다음 훈프로AI가 요약합니다. 리뷰가 많으면 30초쯤 걸립니다');
    await wait(h, 2400);
    await h.cap('맨 위 <b>한 줄 요약</b>이 결론입니다');
    await h.spot('text=/공략 지점/', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>만족 포인트</b>는 상세페이지에 그대로 쓰고, <b>불만 포인트</b>는 내 상품에서 없앨 것입니다');
    await h.scroll('text=고객 불만 포인트', { after: 700 }).catch(() => {});
    await wait(h, 2600);
    await h.cap('<b>숨은 니즈</b>와 <b>내가 공략할 포인트</b> — 경쟁 상품이 못 채운 자리입니다');
    await h.scroll('text=내가 공략할 포인트', { after: 700 }).catch(() => {});
    await wait(h, 2600);
    await h.cap('<b>내 작업에 저장</b>하면 나중에 [내 작업]에서 다시 볼 수 있습니다');
    await h.spot('button:has-text("내 작업에 저장")', 2400, 8).catch(() => wait(h, 2400));
  } },
  analyzer: { title: '광고분석AI', subtitle: '광고 보고서로 키워드마다 판정합니다', steps: 7, async run(h) {
    await h.cap('왼쪽 <b>마진 계산 설정</b> — [쿠팡 연동에서 불러오기]를 누르면 판매가 · 쿠폰 · 원가가 자동으로 들어옵니다');
    await h.spot('button:has-text("쿠팡 연동에서 불러오기")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('그 아래 <b>손익분기 ROAS</b>가 판정 기준입니다. 이 값보다 낮은 키워드는 돈을 잃는 키워드입니다');
    await h.spot('text=손익분기 ROAS', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('광고 보고서는 <b>광고센터 연결</b> 버튼으로 가져오거나 파일로 올립니다. 이미 가져온 보고서가 표시됩니다');
    await h.spot('text=/선택된 파일/', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>핵심 성과 지표</b> — 순이익 · 전환매출 · 광고비 · ROAS · 판매수량 · 전환율');
    await innerScroll(h, 'h3:has-text("핵심 성과 지표")');
    await wait(h, 2600);
    await h.cap('<b>캠페인별 판정</b>과 <b>종합 등급</b>이 이어집니다');
    await innerScroll(h, 'h3:has-text("캠페인별 성과 판정")');
    await wait(h, 2600);
    await h.cap('<b>키워드 정밀 진단</b> — 스타 · 효율 · 저효율 · 제외 후보 · 판단 보류로 나눕니다');
    await innerScroll(h, 'h3:has-text("키워드 정밀 진단")');
    await wait(h, 2800);
    await h.cap('<b>제외 후보</b>는 광고센터에 그대로 붙여 넣고, <b>스타</b>는 관심 등록하면 소싱AI가 매일 추적합니다');
    await innerScroll(h, 'h4:has-text("스타 키워드")');
    await wait(h, 2600);
  } },
  qa: { title: '훈프로 코칭AI', subtitle: '막히는 지점을 물어보세요', steps: 5, async run(h) {
    await h.cap('훈프로가 직접 답한 것이 있으면 위에 먼저 뜹니다');
    await h.spot('text=훈프로가 직접 답변드립니다', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('질문을 적거나 아래 <b>자주 묻는 질문</b> 칩을 누릅니다');
    await h.click('button:has-text("쿠팡 상품명은 어떻게 지어야")', { after: 1400 }).catch(() => {});
    await h.cap('훈프로가 강의 · 자료 기준으로 답합니다. 단계별로 정리되어 나옵니다');
    await wait(h, 3200);
    await h.cap('답이 도움이 됐는지 <b>도움됨 · 아쉬움</b>으로 알려주시면 답변이 좋아집니다');
    await h.spot('button:has-text("도움됨")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('자료에 없는 질문은 훈프로가 확인해 <b>직접 답변</b>으로 돌아옵니다');
    await wait(h, 2200);
  } },
  works: { title: '내 작업', subtitle: '저장한 분석을 다시 봅니다', steps: 5, async run(h) {
    await h.cap('소싱AI · 리뷰 분석 · 광고분석에서 저장한 결과가 카드로 모입니다. 탭으로 종류를 고릅니다');
    await h.spot('button:has-text("소싱AI")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('카드를 누르면 저장 당시 내용이 열립니다');
    await h.click('button:has-text("상품 2개")', { after: 1200 }).catch(() => {});
    await wait(h, 2200);
    await h.cap('소싱 저장본은 <b>그 뒤로 어떻게 됐는지 보기</b>로 저장 당시와 지금의 순위 · 가격 · 리뷰를 견줍니다');
    await h.click('button:has-text("그 뒤로 어떻게 됐는지 보기")', { after: 1200 }).catch(() => {});
    await wait(h, 2600);
    await h.cap('광고 보고서 저장본은 <b>광고분석AI에서 열기</b>로 바로 다시 분석합니다');
    await wait(h, 2000);
    await h.page.keyboard.press('Escape').catch(() => {});
    await h.cap('필요 없는 것은 열어서 <b>삭제</b>합니다');
    await wait(h, 2000);
  } },
  billing: { title: '구독 관리', subtitle: '플랜 · 결제 · 추천 코드', steps: 5, async run(h) {
    await h.cap('<b>내 구독</b> — 플랜, 등록 카드, 다음 결제일, 이용 기간이 보입니다');
    await h.spot('h2:has-text("내 구독")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>카드 변경</b>은 새 카드를 등록하고, <b>해지</b>는 남은 기간까지 쓰고 자동 결제만 멈춥니다');
    await h.spot('button:has-text("해지")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>결제 이력</b>에서 영수증을 봅니다');
    await h.scroll('h3:has-text("결제 이력")', { after: 700 }).catch(() => {});
    await wait(h, 2200);
    await h.cap('<b>친구 추천</b> 코드를 공유하면 친구는 할인을, 나는 다음 결제에 보상을 받습니다');
    await h.scroll('text=친구 추천', { after: 700 }).catch(() => {});
    await h.spot('button:has-text("코드 복사")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>알림 이메일</b>을 끄면 브리핑 · 리포트 메일이 멈춥니다. 결제 안내는 계속 옵니다');
    await h.scroll('text=알림 이메일', { after: 700 }).catch(() => {});
    await wait(h, 2200);
  } },
};

const only = process.argv.slice(2);
for (const [tab, sc] of Object.entries(scenes)) {
  if (only.length && !only.includes(tab)) continue;
  await record({
    name: `${tab}-guide`, title: sc.title, subtitle: sc.subtitle,
    token: fakeToken(), tokenKey: TOKEN_KEY, mocks: tabMocks,
    local: { 'hoonpro_product_ranks': JSON.stringify({ '900': { keyword: '여자 니트티', checked: true, rank: 11, page: 1, at: Date.now() } }) },
    async run(h) {
      h.steps(sc.steps);
      await h.goto(tab === 'home' || tab === 'billing' ? '/' : `/?tab=${tab}`);
      await h.sleep(900);
      if (tab === 'billing') { await h.page.locator('button:has-text("구독 관리")').first().click().catch(() => {}); await h.sleep(1200); await h.overlay(); }
      await h.titleCard();
      await sc.run(h);
      await h.sleep(600);
    },
  });
}
