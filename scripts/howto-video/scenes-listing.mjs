// 상품등록AI. node scripts/howto-video/scenes-listing.mjs
import { record } from './harness.mjs';
import { fakeToken, TOKEN_KEY } from './mocks.mjs';
import { tabMocks } from './mocks-tabs.mjs';

const wait = (h, ms) => h.sleep(ms);

// 업로드할 가짜 제품 사진 — 외부 이미지를 못 받으므로 SVG를 파일처럼 넘긴다
const svgFile = (label, hue, name) => ({
  name, mimeType: 'image/svg+xml',
  buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},40%,30%)"/><stop offset="1" stop-color="hsl(${hue + 30},50%,16%)"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><rect x="230" y="150" width="340" height="500" rx="60" fill="rgba(255,255,255,.14)"/><text x="400" y="420" font-family="Pretendard,sans-serif" font-size="54" font-weight="700" fill="rgba(255,255,255,.9)" text-anchor="middle">${label}</text></svg>`),
});

const META = {
  allowSingleItem: false,
  attributes: [
    { name: '색상', required: true, dataType: 'STRING', basicUnit: '', exposed: true },
    { name: '사이즈', required: true, dataType: 'STRING', basicUnit: '', exposed: true },
    { name: '핏', required: false, dataType: 'STRING', basicUnit: '', exposed: false },
    { name: '소매기장', required: false, dataType: 'STRING', basicUnit: '', exposed: false },
    { name: '넥라인', required: false, dataType: 'STRING', basicUnit: '', exposed: false },
    { name: '패턴', required: false, dataType: 'STRING', basicUnit: '', exposed: false },
    { name: '시즌', required: false, dataType: 'STRING', basicUnit: '', exposed: false },
    { name: '소재', required: false, dataType: 'STRING', basicUnit: '', exposed: false },
    { name: '총기장', required: false, dataType: 'NUMBER', basicUnit: 'cm', exposed: false },
  ],
  notices: [{ name: '의류', details: [
    { name: '제품 소재', required: true }, { name: '색상', required: true }, { name: '치수', required: true }, { name: '제조자(수입자)', required: true },
    { name: '제조국', required: true }, { name: '세탁방법 및 취급시 주의사항', required: true }, { name: '제조연월', required: true }, { name: '품질보증기준', required: true }, { name: 'A/S 책임자와 전화번호', required: true },
  ] }],
  requiredDocuments: [], certifications: [],
};

const listings = [];
const listingMocks = (r) => {
  const { path, q, body } = r;
  if (path === '/api/coupang') {
    if (q.action === 'listing-settings') return {
      settings: { wingUserId: 'hoonpro_seller', outboundCode: '20001', returnCenterCode: '30001', deliveryCompany: 'CJGLS', afterServicePhone: '010-1234-5678', afterServiceInfo: '고객센터 평일 10~17시' },
      outbound: [{ code: '20001', name: '본사 물류창고 (경기 김포)', usable: true }],
      returns: [{ code: '30001', name: '본사 반품센터', zip: '10101', address: '경기 김포시 양촌읍 황금로 100', addressDetail: '2동', phone: '010-1234-5678', usable: true }],
      errors: [],
    };
    if (q.action === 'listing-settings-save') return { ok: true };
    if (q.action === 'listing-category') return { code: '63956', name: '패션의류 › 남성의류 › 니트/스웨터', meta: META };
    if (q.action === 'listing-meta') return { code: q.code || '63956', meta: META };
    if (q.action === 'listing-upload') return { url: body?.image, path: 'listing/demo.jpg' };
    if (q.action === 'listing-create') {
      listings.unshift({ id: `l-${listings.length + 1}`, sellerProductId: '15430412987', productName: body?.productName || '상품', categoryCode: '63956', status: '승인대기중', statusCheckedAt: new Date().toISOString(), error: null, createdAt: new Date().toISOString() });
      return { ok: true, sellerProductId: '15430412987', listingId: listings[0].id };
    }
    if (q.action === 'listings') return { items: listings };
  }
  if (path === '/api/ai') {
    if (q.action === 'product-name') return {
      name: '남자 가을 니트 스웨터 라운드넥 루즈핏 2종세트',
      candidates: ['남자 간절기 라운드 니트 긴팔 스웨터 2종세트', '남자 가을 니트티 스웨터 루즈핏 이종세트'],
      productType: '니트 스웨터',
      attributes: ['니트 소재', '라운드넥', '루즈핏', '긴소매', '무지'],
      keywords: ['남자 니트', '남자 가을 니트', '남자 니트 스웨터', '남자 라운드 니트', '남자 루즈핏 니트', '가을 니트 남자', '남자 니트티', '남자 긴팔 니트', '남자 간절기 니트', '남자 스웨터', '니트 스웨터 남자', '남자 니트 세트', '남자 니트 2종', '남자 데일리 니트', '남자 캐주얼 니트', '남자 가을 스웨터', '남자 니트 추천', '남자 니트 라운드넥', '남자 오버핏 니트', '남자 니트 긴팔'],
      rulesSource: '훈프로 강의 자료',
    };
    if (q.action === 'listing-attrs') return { values: { '핏': '루즈핏', '소매기장': '긴소매', '넥라인': '라운드넥', '패턴': '무지', '시즌': '가을', '소재': '니트' }, filled: 6, total: 7 };
  }
  if (path === '/api/sourcing' && q.type === 'tag-suggest') return {
    tags: ['남자 니트 가을', '남자 니트 라운드', '남자 니트 추천', '남자 니트 오버핏', '남자 가을 니트 코디', '남자 니트 브이넥', '남자 니트 스웨터 코디', '남자 니트 세트', '남자 니트 긴팔', '남자 니트 간절기', '남자 니트 루즈핏', '남자 니트 라운드넥', '남자 니트 데일리', '남자 니트 캐주얼', '남자 니트 베이직', '남자 니트 무지', '남자 니트 겨울', '남자 니트 두꺼운', '남자 니트 얇은', '남자 니트 정장'],
    seeds: ['니트 스웨터', '남자 니트'], sources: { coupang: 14, naver: 6 }, cached: false,
  };
  return tabMocks(r);
};

await record({
  name: 'listing-guide', title: '상품등록AI', subtitle: '사진과 상품명만으로 쿠팡에 등록 요청', token: fakeToken(), tokenKey: TOKEN_KEY, mocks: listingMocks,
  async run(h) {
    h.steps(9);
    await h.goto('/?tab=listing');
    await h.sleep(1200);
    await h.titleCard();

    await h.cap('<b>기본 설정</b>은 한 번만 — 윙 로그인 ID, 출고지 · 반품지(윙에서 불러옴), 택배사, A/S 연락처');
    await h.spot('p:has-text("기본 설정")', 2600, 8).catch(() => wait(h, 2600));

    await h.cap('<b>대표 이미지</b>를 올리면 사진을 분석해 훈프로 기준의 <b>상품명</b>과 검색어가 자동으로 만들어집니다');
    await h.page.locator('input[type=file]').first().setInputFiles([svgFile('맨투맨 니트', 215, 'knit-black.svg'), svgFile('니트 그레이', 30, 'knit-gray.svg')]);
    await wait(h, 2600);
    await h.spot('input[placeholder^="예: 하루한잔"], input[value^="남자 가을"]', 2400, 8).catch(() => wait(h, 2400));

    await h.cap('순서는 <b>브랜드 → 성별 → 계절 → 제품명 2개 → 소구점 → N종세트</b>, 35자 이하. 다른 후보를 눌러 바꿀 수 있습니다');
    await h.spot('button:has-text("간절기 라운드 니트")', 2600, 8).catch(() => wait(h, 2600));

    await h.cap('<b>카테고리 찾기</b> — 상품명으로 쿠팡이 카테고리를 추천하고, 그 카테고리에 필요한 항목만 나타납니다');
    await h.click('button:has-text("카테고리 찾기")', { after: 1600 });
    await wait(h, 1800);

    await h.cap('<b>검색필터</b>는 사진으로 확인되는 값(핏 · 소매기장 · 넥라인 · 패턴 · 시즌)만 자동으로 채웁니다. 모르는 항목은 비워 두세요');
    await h.scroll('p:has-text("검색필터")', { after: 700 }).catch(() => {});
    await wait(h, 2800);

    await h.cap('<b>고시정보</b>는 필수 항목만 묻습니다. 모르면 [빈 칸을 전부 "상세페이지 참조"로 채우기]');
    await h.scroll('p:has-text("상품 고시정보")', { after: 700 }).catch(() => {});
    await h.click('button:has-text("상세페이지 참조\\"로 채우기")', { after: 1200 }).catch(() => wait(h, 1200));
    await wait(h, 1200);

    await h.cap('<b>옵션별 판매가 · 재고</b>를 적습니다. 색상 · 사이즈처럼 옵션으로 갈리는 값은 여기서, 상품명에는 넣지 않습니다');
    await h.scroll('p:has-text("판매가·재고")', { after: 700 }).catch(() => {});
    await h.type('input[placeholder="색상"] >> nth=0', '블랙', { delay: 70 }).catch(() => {});
    await h.type('input[placeholder="사이즈"] >> nth=0', 'L', { delay: 70 }).catch(() => {});
    const price = h.page.locator('table input[inputmode="numeric"]').nth(0);
    await price.click({ force: true }).catch(() => {}); await price.fill('').catch(() => {}); await price.type('29800', { delay: 60 }).catch(() => {});
    await wait(h, 1400);

    await h.cap('<b>상세 이미지</b>는 상세페이지 제작에서 받은 파일을 그대로. <b>검색 태그</b>는 쿠팡 연관 검색어로 20개를 채웁니다');
    await h.page.locator('input[type=file]').nth(1).setInputFiles([svgFile('상세 1', 215, 'd1.svg'), svgFile('상세 2', 200, 'd2.svg'), svgFile('상세 3', 230, 'd3.svg')]).catch(() => {});
    await wait(h, 1200);
    await h.click('button:has-text("쿠팡 연관 검색어로 20개 채우기")', { after: 1400 }).catch(() => {});
    await wait(h, 2200);

    await h.cap('<b>쿠팡에 등록 요청</b> — 승인에는 보통 몇 시간~하루. 결과는 아래 <b>등록 내역</b>에서 확인합니다');
    await h.click('button:has-text("쿠팡에 등록 요청")', { after: 1600 });
    await wait(h, 1400);
    await h.scroll('p:has-text("등록 내역")', { after: 700 }).catch(() => {});
    await h.spot('text=승인대기중', 2600, 8).catch(() => wait(h, 2600));
  },
});
