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
  ['안경김서림 방지 냉감 귀걸이 마스크', '스포츠', 16900, 2500, 82, 82400, 67, 1430, 18, 70, 30, '아마추어'],
  ['차박용 자석 암막 사이드 햇빛가리개', '자동차', 15900, 3300, 96, 76200, 58, 1210, 24, 38, 22, '아마추어'],
  ['장마철 운동화 살균 휴대용 신발건조기', '생활', 34900, 9800, 144, 54200, 49, 730, 31, 44, 26, '준프로'],
  ['반려견 털붙음 방지 냉감 침대패드', '생활', 42900, 14500, 238, 69800, 41, 850, 42, 62, 35, '준프로'],
  ['골프 운전 겸용 손등커버 팔토시 2종', '스포츠', 12900, 2100, 61, 48800, 72, 980, 17, 48, 18, '아마추어'],
  ['전자레인지용 늘어나는 실리콘 음식덮개', '주방', 11900, 1800, 44, 36200, 35, 640, 22, 24, 20, '아마추어'],
  ['차박 트렁크 접이식 2단 캠핑 선반', '스포츠', 29900, 9200, 312, 31500, 28, 410, 46, 36, 31, '준프로'],
  ['대형견 물림방지 젤 쿨매트', '반려동물', 21900, 5900, 104, 40700, 63, 690, 27, 52, 26, '아마추어'],
  ['원형 테이블 전용 유아 모서리 보호대', '육아', 13900, 2600, 68, 29600, 32, 530, 26, 29, 19, '아마추어'],
  ['샤워부스 코너 무타공 욕실 선반', '생활', 18900, 4300, 352, 45200, 24, 600, 55, 58, 42, '준프로'],
  ['독서실용 무드등 겸 저소음 탁상 선풍기', '생활', 24900, 7300, 211, 88200, 46, 1220, 48, 68, 44, '준프로'],
  ['목뒤 밀착형 PCM 아이스 넥쿨러', '스포츠', 17900, 4100, 58, 61100, 75, 1040, 20, 56, 24, '아마추어'],
  ['카니발 2열 전용 틈새 수납함', '자동차', 14900, 3600, 173, 34200, 19, 430, 39, 31, 28, '아마추어'],
  ['아기옷 정전기 방지 양모 빨래 건조볼', '생활', 10900, 1900, 92, 22700, 27, 360, 33, 12, 16, '아마추어'],
  ['계단산행용 좌우분리 등산 무릎보호대', '스포츠', 19900, 5100, 131, 37800, 44, 560, 29, 35, 21, '아마추어'],
  ['음식물 냄새차단 싱크대 배수망', '주방', 8900, 950, 38, 31800, 31, 720, 19, 18, 16, '아마추어'],
  ['소형견 원터치 누수방지 산책 물병', '반려동물', 15900, 3400, 88, 28600, 39, 480, 24, 26, 18, '아마추어'],
  ['책상하부 부착형 멀티 케이블 정리함', 'DIY', 12900, 2300, 75, 25100, 22, 370, 28, 16, 20, '아마추어'],
  ['모니터받침대용 데스크 정리 트레이', '문구', 13900, 2900, 53, 18400, 18, 260, 21, 11, 14, '아마추어'],
  ['계단 이동형 접이식 장바구니 캐리어', '생활', 32900, 11800, 422, 39800, 29, 390, 61, 55, 37, '프로'],
  ['얼굴작아보이는 와이어 자외선 차단 모자', '패션', 18900, 4200, 126, 51600, 54, 820, 32, 46, 29, '아마추어'],
  ['초기 이유식 15ml 실리콘 큐브 트레이', '육아', 14900, 3100, 73, 26400, 37, 410, 25, 22, 18, '아마추어'],
  ['디베아 호환 차량용 무선 청소기 필터', '자동차', 9900, 1600, 45, 21900, 26, 300, 23, 13, 15, '아마추어'],
  ['미니멀 캠핑 행잉 식기 건조망', '스포츠', 15900, 3700, 117, 29300, 43, 440, 35, 31, 24, '아마추어'],
  ['어린이집 낮잠이불 방수 네임스티커 세트', '문구', 7900, 900, 39, 17800, 21, 310, 18, 9, 12, '아마추어'],
  ['방충망 고정 고양이 창문 해먹', '반려동물', 24900, 7900, 286, 33600, 34, 360, 49, 42, 30, '준프로'],
  ['종이호일 대체 사각 실리콘 에어프라이어 용기', '주방', 13900, 2400, 64, 44700, 52, 770, 23, 33, 24, '아마추어'],
  ['줄눈 틈새용 욕실 곰팡이 제거젤', '생활', 9900, 1500, 185, 38100, 16, 610, 43, 37, 32, '준프로'],
  ['원룸 셀프이사용 가구 이동 패드', 'DIY', 11900, 2100, 58, 20600, 25, 290, 27, 14, 17, '아마추어'],
  ['스노쿨링 터치가능 스마트폰 방수팩', '스포츠', 10900, 1700, 91, 58800, 61, 980, 26, 49, 27, '아마추어'],
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

const nicheCompetitorNames: Record<string, string[]> = {
  스포츠: [
    '안경착용자 콧등밀착 김서림방지 페이스커버',
    '헬멧착용자 귀눌림방지 냉감 페이스가드',
    '골프 라운딩 목뒤커버 일체형 페이스가드',
    '작업모 안쪽 착용 초박형 쿨링 페이스커버',
    '러닝용 숨쉬기 편한 메쉬 입체 페이스커버',
    '자전거 고글 김서림방지 코받침 페이스가드',
    '등산 땀흘림 방지 귀걸이형 냉감 페이스커버',
    '여성 골프 화장묻음 방지 안감 페이스가드',
    '야외근무용 목뒤 차광 일체형 쿨링 커버',
    '운전 겸용 귀안아픈 초경량 페이스커버',
  ],
  자동차: [
    '차박 2열 전용 자석 암막 사이드커튼',
    '카니발 슬라이딩도어 맞춤 햇빛가리개',
    '유아 카시트 옆창 흡착식 암막커버',
    '반려견 동승석 창문 메시 햇빛가리개',
    '캠핑카 뒷유리 접이식 차광커버',
    '운전석 팔타는방지 측면 차광패드',
    'SUV 트렁크 창문 암막 차박커튼',
    '택시기사 낮잠용 앞좌석 암막커버',
    '유리흡착 자국방지 실리콘 햇빛가리개',
    '차박 환기구 겸용 메시 차광커튼',
  ],
  생활: [
    '원룸 침대틈새 접착식 먼지차단 패드',
    '건조기 사용가능 양모 정전기 방지볼',
    '장마철 운동화 살균 탈취 미니건조기',
    '샤워부스 코너 전용 무타공 물빠짐 선반',
    '독서실 책상용 무드등 일체형 저소음팬',
    '반려견 털붙음 방지 여름 침대패드',
    '줄눈 틈새 집중도포 곰팡이 제거젤',
    '원룸 셀프이사 바닥보호 가구 이동패드',
    '아이옷 정전기 방지 소형 건조볼',
    '욕실문 뒤 부착형 물때방지 수납선반',
  ],
  주방: [
    '종이호일 대체 사각 실리콘 에어프라이어 그릇',
    '전자레인지 국그릇 전용 실리콘 덮개',
    '음식물 냄새차단 촘촘망 싱크대 거름망',
    '1인가구 소분용 냉동밥 실리콘 트레이',
    '에어프라이어 생선전용 냄새차단 용기',
    '캠핑 설거지 접이식 식기 건조망',
    '아기 이유식 15ml 소분 큐브 트레이',
    '반찬통 냄새배임 방지 실리콘 패킹덮개',
    '싱크대 배수구 벌레차단 미세망 필터',
    '도시락 컵과일 누수방지 실리콘 캡',
  ],
  반려동물: [
    '대형견 물림방지 젤 쿨매트',
    '소형견 원터치 누수방지 산책 물병',
    '방충망 고정 고양이 창문 해먹',
    '장모견 털엉킴 방지 쿨링 빗장갑',
    '노령견 미끄럼방지 계단 매트',
    '고양이 모래삽 거치형 냄새차단 케이스',
    '차량 뒷좌석 반려견 안전 메시커버',
    '산책가방 부착형 배변봉투 물병홀더',
    '소형묘 창틀 고정 햇빛차단 해먹',
    '대형견 턱받침 방수 쿨매트',
  ],
  육아: [
    '원형 테이블 전용 말랑 모서리 보호대',
    '초기 이유식 15ml 실리콘 큐브 트레이',
    '어린이집 낮잠이불 방수 이름스티커',
    '유모차 컵홀더 옆 간식 방수파우치',
    '아기 의자 발받침 미끄럼방지 패드',
    '문닫힘 방지 손끼임 투명 보호캡',
    '기저귀가방 젖병 세로수납 보냉파우치',
    '아기옷 얼룩전용 휴대 세탁패드',
    '욕조 장난감 물빠짐 흡착망',
    '카시트 목꺾임 방지 미니 쿠션',
  ],
  문구: [
    '모니터받침대용 얇은 데스크 정리 트레이',
    '어린이집 낮잠이불 방수 네임스티커',
    '책상하부 부착형 투명 케이블 라벨',
    '노트북 거치대 옆 펜홀더 클립',
    '영수증 분류용 접착식 미니 파일포켓',
    '다이어리 모서리 보호 투명 라벨탭',
    '학생 책상 가림막 부착 메모트레이',
    '택배 송장 가림 방수 개인정보 스티커',
    '키보드 밑 슬라이딩 메모 수납판',
    '회의실 네임카드 접이식 정리함',
  ],
  DIY: [
    '책상하부 부착형 멀티 케이블 정리함',
    '원룸 셀프이사용 가구 이동 패드',
    '벽지손상 방지 액자 고정 젤패드',
    '침대프레임 소음방지 실리콘 완충패드',
    '싱크대문 안쪽 접착식 공구 클립',
    '서랍장 흔들림 방지 높이조절 받침',
    '전선 몰딩 끝단 마감 보호캡',
    '캠핑테이블 미끄럼방지 다리패드',
    '방문 손잡이 충격방지 투명 스토퍼',
    '수납장 틈새 먼지차단 실리콘 가드',
  ],
  패션: [
    '얼굴작아보이는 와이어 차광 벙거지',
    '메이크업 묻음 방지 안감 차광모자',
    '장시간 운전용 목뒤커버 와이어 모자',
    '두상 작은 여성용 깊은챙 차광모자',
    '등산용 땀받이 탈부착 메쉬 모자',
    '골프 마스크 결합형 차광 버킷햇',
    '유모차 산책용 접이식 차광모자',
    '중년 여성 헤어눌림 적은 차광모자',
    '비오는날 겸용 방수챙 차광모자',
    '여행 캐리어 수납 초경량 차광모자',
  ],
};

const productNouns = [
  '마스크', '햇빛가리개', '신발건조기', '침대패드', '팔토시', '음식덮개', '접이식 선반', '쿨매트', '모서리 보호대',
  '욕실 선반', '탁상 선풍기', '넥쿨러', '틈새 수납함', '빨래 건조볼', '무릎보호대', '배수망', '산책 물병',
  '케이블 정리함', '데스크 정리 트레이', '장바구니 캐리어', '자외선 차단 모자', '이유식 큐브 트레이',
  '무선 청소기 필터', '식기 건조망', '네임스티커', '창문 해먹', '에어프라이어 용기', '곰팡이 제거젤', '가구 이동 패드', '방수팩',
];

const getProductCore = (productName: string) => {
  const noun = productNouns.find((item) => productName.includes(item));
  return noun || productName.split(' ').slice(-2).join(' ');
};

const getCompetitorName = (category: string, productName: string, rank: number) => {
  const nicheNames = nicheCompetitorNames[category] || nicheCompetitorNames.생활;
  return nicheNames[(rank + productName.length) % nicheNames.length];
};

const getGeneratedKeywords = (name: string, category: string, types: KeywordType[]) => {
  const core = getProductCore(name).replace(/\s/g, '');
  const byType: Partial<Record<KeywordType, string>> = {
    블루오션: `${core}블루오션`,
    급상승: `${core}급상승`,
    시즌상품: `${core}시즌`,
    신규시장: `${core}신규상품`,
    고마진: `${core}고마진`,
    저경쟁: `${core}저경쟁`,
    '리뷰장벽 낮음': `${core}리뷰낮음`,
  };
  return Array.from(new Set([
    name.replace(/\s/g, ''),
    `${category}${core}`,
    `${core}추천`,
    ...types.map((type) => byType[type]).filter((keyword): keyword is string => Boolean(keyword)),
  ])).slice(0, 6);
};

const getCoupangProductCount = (competitionLevel: number, searchVolume: number, index: number) => {
  const demandPressure = Math.round(searchVolume / 3800);
  const competitionWeight = competitionLevel * 4;
  const variance = (index % 9) * 3;
  return Math.min(98, Math.max(18, demandPressure + competitionWeight + variance));
};

const getOpportunityScore = (estimatedSales: number, coupangProductCount: number, growth30d: number) => {
  const salesScore = Math.min(50, Math.round(estimatedSales / 32));
  const scarcityScore = coupangProductCount <= 100 ? Math.min(40, Math.round((110 - coupangProductCount) / 2.2)) : 0;
  const growthScore = Math.min(10, Math.round(growth30d / 8));
  return Math.min(100, salesScore + scarcityScore + growthScore);
};

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
  const productKeywordTypes = getKeywordTypes(score.grade, growth30d, margin, competitionLevel, category);
  const coupangProductCount = getCoupangProductCount(competitionLevel, searchVolume, index);
  const opportunityScore = getOpportunityScore(estimatedSales, coupangProductCount, growth30d);

  return {
    id: `hp-${index + 1}`,
    keyword: name,
    name,
    category,
    keywordTypes: productKeywordTypes,
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
    coupangProductCount,
    opportunityScore,
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
        productUrl: undefined,
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
    generatedNames: [`${name} 자외선차단 실사용 세트`, `${name} 검색 인기형 가성비 구성`, `${name} 초보 셀러 추천 소싱템`],
    generatedKeywords: getGeneratedKeywords(name, category, productKeywordTypes),
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
