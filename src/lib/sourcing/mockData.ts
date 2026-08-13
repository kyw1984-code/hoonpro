import { calculateProductScore } from '../scoring/calculateProductScore';
import type { KeywordType, ProviderStatus, SourcingProduct } from './types';

const categoryCustomers: Record<string, string[]> = {
  생활: ['초보 셀러', '생활 편의 구매자', '1인 가구'],
  주방: ['주방 정리 관심 고객', '신혼 가구', '실용 구매자'],
  패션: ['야외 활동 고객', '여름 시즌 구매자', '가성비 패션 고객'],
  스포츠: ['러닝', '골프', '등산', '자전거', '야외근무'],
  자동차: ['출퇴근 운전자', '차박/여행 고객', '차량 관리 고객'],
  반려동물: ['강아지 보호자', '고양이 보호자', '여름 케어 고객'],
  육아: ['영유아 부모', '안전용품 구매자', '선물 구매자'],
  문구: ['학생', '사무직', '정리용품 구매자'],
  DIY: ['셀프 인테리어 고객', '수납/정리 고객', '공구 입문자'],
};

const seeds = [
  ['냉감 스포츠 마스크', '스포츠', 16900, 2500, 82, 82400, 67, 1430, 18, 70, 30, '초보'],
  ['차량 햇빛가리개', '자동차', 15900, 3300, 96, 76200, 58, 1210, 24, 38, 22, '초보'],
  ['휴대용 신발건조기', '생활', 34900, 9800, 144, 54200, 49, 730, 31, 44, 26, '중수'],
  ['냉감 침대패드', '생활', 42900, 14500, 238, 69800, 41, 850, 42, 62, 35, '중수'],
  ['스포츠 팔토시 2종', '스포츠', 12900, 2100, 61, 48800, 72, 980, 17, 48, 18, '초보'],
  ['실리콘 음식덮개', '주방', 11900, 1800, 44, 36200, 35, 640, 22, 24, 20, '초보'],
  ['캠핑 접이식 선반', '스포츠', 29900, 9200, 312, 31500, 28, 410, 46, 36, 31, '중수'],
  ['반려동물 쿨매트', '반려동물', 21900, 5900, 104, 40700, 63, 690, 27, 52, 26, '초보'],
  ['유아 모서리 보호대', '육아', 13900, 2600, 68, 29600, 32, 530, 26, 29, 19, '초보'],
  ['무타공 욕실 선반', '생활', 18900, 4300, 352, 45200, 24, 600, 55, 58, 42, '중수'],
  ['저소음 탁상 선풍기', '생활', 24900, 7300, 211, 88200, 46, 1220, 48, 68, 44, '중수'],
  ['아이스 넥쿨러', '스포츠', 17900, 4100, 58, 61100, 75, 1040, 20, 56, 24, '초보'],
  ['차량용 틈새 수납함', '자동차', 14900, 3600, 173, 34200, 19, 430, 39, 31, 28, '초보'],
  ['프리미엄 빨래 건조볼', '생활', 10900, 1900, 92, 22700, 27, 360, 33, 12, 16, '초보'],
  ['초경량 등산 무릎보호대', '스포츠', 19900, 5100, 131, 37800, 44, 560, 29, 35, 21, '초보'],
  ['주방 싱크대 배수망', '주방', 8900, 950, 38, 31800, 31, 720, 19, 18, 16, '초보'],
  ['강아지 산책 물병', '반려동물', 15900, 3400, 88, 28600, 39, 480, 24, 26, 18, '초보'],
  ['멀티 케이블 정리함', 'DIY', 12900, 2300, 75, 25100, 22, 370, 28, 16, 20, '초보'],
  ['문구 데스크 정리 트레이', '문구', 13900, 2900, 53, 18400, 18, 260, 21, 11, 14, '초보'],
  ['접이식 장바구니 캐리어', '생활', 32900, 11800, 422, 39800, 29, 390, 61, 55, 37, '고수'],
  ['여름 자외선 차단 모자', '패션', 18900, 4200, 126, 51600, 54, 820, 32, 46, 29, '초보'],
  ['아기 이유식 큐브 트레이', '육아', 14900, 3100, 73, 26400, 37, 410, 25, 22, 18, '초보'],
  ['차량용 무선 청소기 필터', '자동차', 9900, 1600, 45, 21900, 26, 300, 23, 13, 15, '초보'],
  ['캠핑 식기 건조망', '스포츠', 15900, 3700, 117, 29300, 43, 440, 35, 31, 24, '초보'],
  ['방수 네임스티커 세트', '문구', 7900, 900, 39, 17800, 21, 310, 18, 9, 12, '초보'],
  ['고양이 창문 해먹', '반려동물', 24900, 7900, 286, 33600, 34, 360, 49, 42, 30, '중수'],
  ['실리콘 에어프라이어 용기', '주방', 13900, 2400, 64, 44700, 52, 770, 23, 33, 24, '초보'],
  ['욕실 곰팡이 제거젤', '생활', 9900, 1500, 185, 38100, 16, 610, 43, 37, 32, '중수'],
  ['DIY 가구 이동 패드', 'DIY', 11900, 2100, 58, 20600, 25, 290, 27, 14, 17, '초보'],
  ['스마트폰 방수팩', '스포츠', 10900, 1700, 91, 58800, 61, 980, 26, 49, 27, '초보'],
] as const;

const getKeywordTypes = (grade: string, growth: number, margin: number, competition: number, category: string): KeywordType[] => {
  const types: KeywordType[] = [];
  if (grade === 'S' || competition <= 25) types.push('블루오션');
  if (growth >= 45) types.push('급상승');
  if (['스포츠', '생활', '자동차', '패션'].includes(category)) types.push('시즌상품');
  if (growth >= 20 && competition <= 40) types.push('신규시장');
  if (margin >= 30) types.push('고마진');
  if (competition <= 35) types.push('저경쟁');
  types.push('리뷰장벽 낮음');
  return Array.from(new Set(types));
};

const competitorNamePools: Record<string, string[]> = {
  스포츠: [
    '나이키 드라이핏 UV 페이스커버 스포츠 마스크',
    '아르메데스 자외선차단 쿨링 스포츠 마스크',
    '락브로스 라이딩 냉감 바라클라바 마스크',
    '아디다스 러닝 자외선 차단 스포츠 마스크',
    'K2 아이스 멀티 스카프 쿨링 마스크',
    '블랙야크 냉감 팔토시 자외선 차단 토시',
    '프로스펙스 스포츠 쿨 팔토시 2p',
    '밀레 UV 차단 등산 쿨토시',
    '캠핑문 접이식 캠핑 선반 우드쉘프',
    '코멧 아웃도어 캠핑 식기 건조망',
  ],
  자동차: [
    '메이튼 차량용 자석 햇빛가리개',
    '불스원 자동차 앞유리 햇빛가리개',
    '카템 차량용 접이식 햇빛가리개',
    '훠링 차량용 틈새 수납 포켓',
    '벤딕트 자동차 시트 틈새 수납함',
    '차싹 차량용 무선 청소기 필터',
    '오토반 차량용 컵홀더 틈새 수납함',
    '카템 자동차 사이드 햇빛가리개',
    '코멧 차량용 무선 충전 거치대',
    '불스원 차량용 방향제 리필 세트',
  ],
  생활: [
    '코멧 홈 냉감 침대패드',
    '듀라론 여름 냉감 패드',
    '홈플래닛 저소음 탁상용 선풍기',
    '신일 저소음 탁상 선풍기',
    '오아 휴대용 신발건조기',
    '한경희생활과학 신발 건조 살균기',
    '코멧 무타공 욕실 선반',
    '생활공식 욕실 곰팡이 제거젤',
    '탐사 프리미엄 빨래 건조볼',
    '홈앤하우스 접이식 장바구니 캐리어',
  ],
  주방: [
    '코멧 키친 실리콘 음식덮개',
    '락앤락 실리콘 에어프라이어 용기',
    '모던하우스 실리콘 주방 조리도구 세트',
    '키친아트 싱크대 배수구 거름망',
    '리빙공감 싱크대 배수망 세트',
    '네이쳐리빙 실리콘 밀폐 덮개',
    '바겐슈타이거 에어프라이어 종이호일 대체 용기',
    '코멧 키친 다용도 채반 트레이',
    '벨라쿠진 실리콘 조리도구 세트',
    '홈플래닛 주방 싱크대 배수구 캡',
  ],
  반려동물: [
    '딩동펫 반려동물 쿨매트',
    '리스펫 강아지 쿨방석',
    '페스룸 산책 물병',
    '딩동펫 강아지 휴대용 물병',
    '펫츠맘 고양이 창문 해먹',
    '딩동펫 고양이 창문 해먹',
    '탐사 반려동물 쿨매트',
    '리스펫 강아지 산책 물통',
    '펫트리움 고양이 창문 침대',
    '펫초이스 반려동물 여름 쿨패드',
  ],
  육아: [
    '아가드 모서리 보호대',
    '아이끌레 유아 안전 모서리 보호대',
    '퍼기 이유식 큐브 트레이',
    '락앤락 바로한끼 이유식 큐브',
    '마더케이 실리콘 이유식 보관용기',
    '베베락 이유식 냉동 보관용기',
    '아가드 코너 보호대 투명',
    '일상공감 아이 안전 모서리 가드',
    '릿첼 이유식 냉동 큐브',
    '돗투돗 실리콘 이유식 큐브',
  ],
  문구: [
    '시스맥스 데스크 정리 트레이',
    '카파맥스 데스크 오거나이저',
    '네임코코 방수 네임스티커',
    '쁘띠팬시 방수 네임스티커',
    '모닝글로리 데스크 정리함',
    '아트박스 책상 정리 트레이',
    '오피스존 데스크 서류 트레이',
    '꼬모네임 방수 이름 스티커',
    '델리 데스크 오거나이저',
    '아이코닉 라벨 네임스티커',
  ],
  DIY: [
    '생활공식 케이블 정리함',
    '탐사 멀티탭 케이블 정리함',
    '코멧 가구 이동 슬라이더 패드',
    '생활공작소 가구 이동 패드',
    '3M 케이블 클립 정리 홀더',
    '다이소형 멀티탭 정리 박스',
    '홈앤하우스 가구 이동 바퀴 패드',
    '리빙듀오 케이블 정리함',
    '이지앤프리 가구 이동 패드',
    '아이정 멀티탭 케이블 정리함',
  ],
  패션: [
    '나이키 UV 차단 러닝 캡',
    '아디다스 자외선 차단 스포츠 모자',
    'K2 여름 등산 햇빛차단 모자',
    '블랙야크 냉감 자외선 차단 모자',
    '네파 여성 UV 차단 썬캡',
    '휠라 스포츠 메쉬 볼캡',
    '밀레 여름 등산 모자',
    '프로스펙스 러닝 메쉬 캡',
    '코오롱스포츠 햇빛차단 모자',
    '아이더 냉감 썬캡',
  ],
};

const getCompetitorName = (category: string, productName: string, rank: number) => {
  const pool = competitorNamePools[category] || competitorNamePools.생활;
  return pool[(rank + productName.length) % pool.length];
};

const getCoupangSearchUrl = (keyword: string) => `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}`;

export const sourcingProducts: SourcingProduct[] = seeds.map((seed, index) => {
  const [name, category, price, supplierCost, avgReview, searchVolume, growth30d, estimatedSales, competitionLevel, rocketRatio, adRatio, difficulty] = seed;
  const shippingCost = 3000;
  const margin = Math.round(((price - supplierCost - shippingCost - price * 0.12) / price) * 100);
  const score = calculateProductScore({
    searchVolume,
    competitionLevel,
    avgReview,
    growth30d,
    expectedMargin: margin,
    priceStability: index % 4 === 0 ? 4 : 5,
    seasonality: ['스포츠', '생활', '자동차', '패션'].includes(category) ? 5 : 3,
    supplierReliability: supplierCost < price * 0.35 ? 5 : 4,
  });
  const baseSeason = [12, 14, 20, 34, 58, 83, 100, 92, 46, 24, 14, 11];

  return {
    id: `hp-${index + 1}`,
    keyword: name,
    name,
    category,
    keywordTypes: getKeywordTypes(score.grade, growth30d, margin, competitionLevel, category),
    price,
    supplierCost,
    shippingCost,
    avgReview,
    rating: Number((4.2 + (index % 7) * 0.1).toFixed(1)),
    searchVolume,
    growth7d: Math.round(growth30d * 0.38),
    growth30d,
    growth90d: Math.round(growth30d * 1.8),
    estimatedSales,
    estimatedRevenue: price * estimatedSales,
    competitionLevel,
    rocketRatio,
    adRatio,
    brandRatio: 8 + (index % 5) * 7,
    topConcentration: 24 + (index % 6) * 8,
    moq: index % 5 === 0 ? 100 : index % 3 === 0 ? 50 : 20,
    difficulty,
    score,
    status: index < 8 ? '발견' : index < 14 ? '분석중' : index < 20 ? '보류' : '샘플 주문',
    competitors: Array.from({ length: 10 }, (_, rank) => {
      const competitorName = getCompetitorName(category, name, rank);
      return {
        rank: rank + 1,
        name: competitorName,
        productUrl: getCoupangSearchUrl(competitorName),
        price: Math.round(price * (0.88 + rank * 0.025) / 100) * 100,
        reviews: Math.max(12, avgReview + (rank - 4) * 18),
        estimatedSales: Math.max(80, estimatedSales - rank * 75),
        delivery: rank % 4 === 0 ? '판매자로켓' : rank % 3 === 0 ? '로켓' : '일반',
      };
    }),
    suppliers: [
      {
        id: `sp-${index + 1}-1`,
        productName: `${name} 도매 후보 A`,
        supplier: index % 2 === 0 ? '1688 도매 후보' : '국내 도매 후보',
        cost: supplierCost,
        shippingCost,
        moq: index % 3 === 0 ? 50 : 20,
        url: 'https://example.com/supplier-a',
        imageUrl: '',
        textSimilarity: 84 + (index % 9),
        imageSimilarity: 88 + (index % 7),
        totalSimilarity: 87 + (index % 8),
      },
      {
        id: `sp-${index + 1}-2`,
        productName: `${name} OEM 가능 상품`,
        supplier: 'OEM 공장 후보',
        cost: Math.round(supplierCost * 1.08),
        shippingCost: shippingCost + 400,
        moq: 100,
        url: 'https://example.com/supplier-b',
        imageUrl: '',
        textSimilarity: 78 + (index % 8),
        imageSimilarity: 82 + (index % 6),
        totalSimilarity: 81 + (index % 7),
      },
    ],
    seasonality: baseSeason.map((value, monthIndex) => ({
      month: monthIndex + 1,
      value: Math.max(8, value - (index % 5) * 4 + (category === '생활' ? 6 : 0)),
    })),
    peakInDays: 25 + (index % 6) * 10,
    targetCustomers: categoryCustomers[category] || ['쿠팡 검색 구매자', '가격 비교 고객', '초보 셀러'],
    competitorWeaknesses: ['색상 선택 부족', '세트 구성 부족', '사이즈/사용 안내 부족', '기능성 근거 부족'],
    strategies: ['2개 세트 구성', '전용 보관 파우치 또는 사은품', '기능성 테스트 문구 강조', '러닝/골프/출퇴근 등 사용 장면 이미지'],
    generatedNames: [`${name} 자외선차단 실사용 세트`, `${name} 쿠팡 인기형 가성비 구성`, `${name} 초보 셀러 추천 소싱템`],
    generatedKeywords: [name.replace(/\s/g, ''), `${category}추천`, '쿠팡소싱', '초보셀러', '고마진상품', '저경쟁키워드'],
    differentiation: ['2개 세트', '전용 보관 파우치', '남녀 공용 컬러', '기능성 근거 강조', '실사용 비교 이미지', '초보자용 상세 안내'],
    risks: competitionLevel > 50 ? ['상위 판매 집중도가 높아 광고비가 올라갈 수 있음', '로켓 상품 비율이 높아 배송 경쟁력 필요'] : ['공급처 품질 확인 필요', '시즌 피크 전 재고 준비 필요'],
    grade: score.grade,
    recommendation: score.recommendation,
  };
});

export const providerStatuses: ProviderStatus[] = [
  { name: 'KeywordProvider', role: '키워드 검색량, 성장률, 시즌성 수집', implementation: 'Mock Provider', status: '사용중' },
  { name: 'ProductProvider', role: '쿠팡 상품, 리뷰, 가격, 배송유형 수집', implementation: 'Mock Provider', status: '사용중' },
  { name: 'SupplierProvider', role: '도매상품, MOQ, 공급가, 이미지 URL 매칭', implementation: 'Mock Provider', status: '사용중' },
  { name: 'TrendProvider', role: '급상승/시즌 예측 데이터 제공', implementation: 'Mock Provider', status: '사용중' },
  { name: 'Supabase PostgreSQL', role: 'products, keywords, analysis, favorites 저장', implementation: 'Supabase Ready', status: '연결 준비' },
  { name: 'OpenAI API', role: '판매전략, 상품명, 키워드, 차별화 생성', implementation: 'OpenAI Ready', status: '연결 준비' },
];
