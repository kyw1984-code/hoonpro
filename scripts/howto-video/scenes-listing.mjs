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
    if (q.action === 'listing-notices') return { notices: { '제품 소재': '아크릴 70% 면 30%', '치수': 'M 가슴 54 총장 68 / L 가슴 57 총장 70 / XL 가슴 60 총장 72', '제조국': '중국', '세탁방법 및 취급시 주의사항': '손세탁 또는 울코스, 표백제 금지, 뉘어서 건조' }, options: { colors: ['블랙', '그레이'], sizes: ['M', 'L', 'XL'] }, summary: '', filled: 4, total: 9 };
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
    h.steps(11);
    await h.goto('/?tab=listing');
    await h.sleep(1200);
    await h.titleCard();

    await h.cap('<b>기본 설정</b>은 한 번만 — 윙 로그인 ID, 출고지 · 반품지(윙에서 불러옴), 택배사, A/S 연락처');
    await h.spot('p:has-text("기본 설정")', 2600, 8).catch(() => wait(h, 2600));

    await h.cap('<b>대표 이미지</b>를 올리면 사진을 분석해 <b>상품명 → 카테고리 → 검색필터 → 검색 태그</b>까지 한 번에 자동으로 채웁니다');
    await h.page.locator('input[type=file]').first().setInputFiles([svgFile('맨투맨 니트', 215, 'knit-black.svg'), svgFile('니트 그레이', 30, 'knit-gray.svg')]);
    await wait(h, 2600);
    await h.spot('input[placeholder^="예: 하루한잔"], input[value^="남자 가을"]', 2400, 8).catch(() => wait(h, 2400));

    await h.cap('순서는 <b>브랜드 → 성별 → 계절 → 제품명 2개 → 소구점 → N종세트</b>, 35자 이하. 다른 후보를 눌러 바꿀 수 있습니다');
    await h.spot('button:has-text("간절기 라운드 니트")', 2600, 8).catch(() => wait(h, 2600));

    await h.cap('<b>카테고리</b>는 상품명으로 쿠팡이 추천한 것이 자동으로 들어갑니다. 바꾸려면 [카테고리 찾기]나 코드 직접 지정');
    await h.spot('button:has-text("카테고리 찾기")', 2400, 8).catch(() => wait(h, 2400));
    await wait(h, 800);

    await h.cap('<b>상세페이지 이미지</b>를 올리면 상세페이지를 읽어 <b>옵션(색상 · 사이즈)</b>과 <b>제공고시</b>까지 자동으로 채웁니다');
    await h.scroll('p:has-text("상세페이지 이미지")', { after: 700 }).catch(() => {});
    await h.page.locator('input[type=file]').nth(1).setInputFiles([svgFile('상세 1', 215, 'd1.svg'), svgFile('상세 2', 200, 'd2.svg'), svgFile('상세 3', 230, 'd3.svg')]).catch(() => {});
    await wait(h, 2600);

    await h.cap('<b>옵션 · 판매가 · 재고</b> — 색상 × 사이즈 조합이 들어와 있으니 판매가와 재고만 적습니다');
    await h.scroll('p:has-text("옵션 · 판매가 · 재고")', { after: 700 }).catch(() => {});
    const price = h.page.locator('table input[inputmode="numeric"]').nth(0);
    await price.click({ force: true }).catch(() => {}); await price.fill('').catch(() => {}); await price.type('29800', { delay: 60 }).catch(() => {});
    await wait(h, 1600);

    await h.cap('<b>검색필터</b>는 사진으로 확인되는 값(핏 · 소매기장 · 넥라인 · 패턴 · 시즌)을 자동으로 채웁니다. 나머지는 직접 입력합니다');
    await h.scroll('p:has-text("검색필터")', { after: 700 }).catch(() => {});
    await wait(h, 2600);

    await h.cap('<b>상품 주요 정보</b> — 제조사 · 인증 · 병행수입 · 구매 연령 · 구매수량 · 판매기간 · 부가세 · 배송비. 윙 기본값이 미리 선택돼 있습니다');
    await h.scroll('p:has-text("상품 주요 정보")', { after: 700 }).catch(() => {});
    await wait(h, 2800);

    await h.cap('<b>상품정보 제공고시</b> — 소재 · 치수 · 제조국 · 세탁법은 상세페이지에서 읽어 넣고, 나머지는 의류 기본값입니다');
    await h.scroll('p:has-text("상품정보 제공고시")', { after: 700 }).catch(() => {});
    await wait(h, 2600);

    await h.cap('<b>검색 태그</b> 20개는 쿠팡 연관 검색어로 이미 채워져 있습니다. 고치고 싶으면 직접 수정하거나 다시 채우기');
    await h.scroll('label:has-text("검색 태그")', { after: 700 }).catch(() => {});
    await wait(h, 2400);

    await h.cap('<b>쿠팡에 등록 요청</b> — 승인에는 보통 몇 시간~하루. 결과는 아래 <b>등록 내역</b>에서 확인합니다');
    await h.click('button:has-text("쿠팡에 등록 요청")', { after: 1600 });
    await wait(h, 1400);
    await h.scroll('p:has-text("등록 내역")', { after: 700 }).catch(() => {});
    await h.spot('text=승인대기중', 2600, 8).catch(() => wait(h, 2600));
  },
});
