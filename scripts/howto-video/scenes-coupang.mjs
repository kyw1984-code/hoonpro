// 정산AI 하위 화면 13개. node scenes-coupang.mjs [view ...]
import { record } from './harness.mjs';
import { fakeToken, TOKEN_KEY } from './mocks.mjs';
import { coupangMocks } from './mocks-coupang.mjs';

const wait = (h, ms) => h.sleep(ms);
const scenes = {
  health: { title: '훈프로 상품 진단 카드', subtitle: '옵션마다 손볼 것만 모아 보여줍니다', steps: 6, async run(h) {
    await h.cap('진단 카드는 <b>원가 미입력 · 마진 · 재고 · 반품률 · 무판매 · 판매중지</b> 여섯 가지를 점검합니다');
    await h.spot('h2:has-text("훈프로 상품 진단 카드")', 2400, 8);
    await h.cap('위 칩으로 종류별로 걸러 봅니다. <b>급함</b>이 붙은 것이 먼저입니다');
    await h.spot('button:has-text("재고 임박·품절")', 2200, 8);
    await h.click('button:has-text("원가 미입력")', { after: 900 });
    await wait(h, 1200);
    await h.click('button:has-text("손볼 것")', { after: 900 });
    await h.cap('묶음마다 무엇이 문제인지 <b>한 줄로</b> 적혀 있습니다. 숫자까지 같이 보세요');
    await h.spot('text=/품절 · 최근 14일/', 2600, 8).catch(() => wait(h, 2600));
    await h.cap('묶음의 버튼을 누르면 <b>원가 입력 · 가격 관리 · 재고 예측 · 반품 분석</b>으로 바로 갑니다');
    await h.spot('button:has-text("재고 예측")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>다시 점검</b>은 지금 데이터로 다시 봅니다. 수집 직후에 누르면 오늘 값입니다');
    await h.spot('button:has-text("다시 점검")', 2200, 8).catch(() => wait(h, 2200));
    await h.cap('매일 아침 이 카드만 훑어도 급한 일은 놓치지 않습니다');
    await wait(h, 2200);
  } },
  hours: { title: '주문 시간대 · 요일 패턴', subtitle: '손님이 언제 주문하는지 봅니다', steps: 5, async run(h) {
    await h.cap('윙과 로켓그로스 주문을 합쳐 <b>한국 시간</b>으로 시간대별 주문을 봅니다');
    await h.spot('h2:has-text("주문 시간대")', 2200, 8);
    await h.cap('가장 많이 팔리는 <b>세 시간</b>이 밝게 표시됩니다. 광고 시간대와 쿠폰 시작 시각을 여기에 맞추세요');
    await h.scroll('h3:has-text("시간대별 주문")', { after: 700 });
    await wait(h, 2600);
    await h.cap('<b>요일별 주문</b> — 주말형인지 평일형인지 보입니다');
    await h.scroll('h3:has-text("요일별 주문")', { after: 700 });
    await wait(h, 2200);
    await h.cap('<b>요일 × 시간대</b> 표는 진한 칸이 주문이 몰리는 때입니다');
    await h.scroll('h3:has-text("요일 × 시간대")', { after: 700 });
    await wait(h, 2600);
    await h.cap('기간은 <b>14 · 28 · 56 · 90일</b>로 바꿉니다. 시즌이 바뀌면 패턴도 바뀝니다');
    await h.scroll(-2000, { after: 600 });
    await h.spot('select:has(option[value="90"])', 2200, 8).catch(() => wait(h, 2200));
  } },
  experiments: { title: '변경 효과 측정', subtitle: '바꾼 날 한 줄 적으면 전후를 견줘 줍니다', steps: 6, async run(h) {
    await h.cap('가격 · 썸네일 · 쿠폰을 바꿨다면 <b>변경 기록 추가</b>로 한 줄 적어 둡니다');
    await h.click('button:has-text("변경 기록 추가")', { after: 900 });
    await h.cap('상품, 무엇을 바꿨는지, 바꾼 날, 전후 며칠씩 볼지를 고르고 메모를 적습니다');
    await h.spot('select:has(option:has-text("상품을 고르세요"))', 1600, 8).catch(() => {});
    await h.spot('input[placeholder^="예: 29,900"]', 1600, 8).catch(() => {});
    await h.click('button:has-text("닫기")', { after: 700 });
    await h.cap('기록마다 전후 기간의 <b>판매 · 매출 · 광고비 · 추정 순이익</b>을 하루 평균으로 견줍니다');
    await h.scroll('h3:has-text("데일리 라운드넥")', { after: 700 });
    await wait(h, 2400);
    await h.cap('판정은 <b>순이익</b>이 답입니다. 판매가 늘어도 순이익이 줄면 나쁜 변경입니다');
    await h.scroll('h3:has-text("롱원피스 3종세트")', { after: 700 });
    await h.spot('text=/판매는 늘었지만 순이익은 줄었습니다/', 2600, 8).catch(() => wait(h, 2600));
    await h.cap('순위 추적에 등록한 상품이면 <b>키워드별 순위 변화</b>도 같이 나옵니다');
    await h.spot('text=/순위 · 롱원피스 세트/', 2200, 8).catch(() => wait(h, 2200));
    await h.cap('바꾼 지 <b>3일</b>은 지나야 판정이 나옵니다. 하루 이틀은 요일과 우연에 흔들립니다');
    await h.scroll('h3:has-text("경량 패딩 조끼")', { after: 700 });
    await wait(h, 2400);
  } },
  purchases: { title: '1688 매입 원가 계산', subtitle: '위안 단가와 배송비만 적으면 개당 원가가 나옵니다', steps: 6, async run(h) {
    await h.cap('<b>매입 기록</b>을 누르면 입력 창이 열립니다. 환율은 오늘 값이 자동으로 들어갑니다');
    await h.click('button:has-text("매입 기록")', { after: 900 });
    await h.cap('상품을 고르면 옵션은 <b>전체</b>가 기본입니다. 사이즈 · 색상 옵션은 원가가 같으니 한 번만 적습니다');
    await h.type('input[placeholder="상품명으로 찾기"]', '니트', { delay: 80 });
    await h.page.selectOption('select:has(option:has-text("상품을 고르세요"))', { index: 1 }).catch(() => {});
    await wait(h, 900);
    await h.spot('select:has(option:has-text("전체 옵션"))', 1800, 8).catch(() => {});
    await h.cap('수량 · 위안 단가 · 중국 내 배송비 · 배대지비 · 관세를 적으면 <b>개당 입고 원가</b>가 바로 계산됩니다');
    await h.type('input[placeholder="예: 100"]', '300', { delay: 60 });
    await h.type('input[placeholder="예: 20"]', '38', { delay: 60 });
    await h.type('input[placeholder="예: 50"]', '60', { delay: 60 });
    await h.type('input[placeholder="예: 120000"]', '360000', { delay: 40 });
    await h.spot('p:text-is("개당 입고 원가")', 2200, 10).catch(() => wait(h, 2200));
    await h.cap('<b>저장</b>하면 그 상품의 옵션 전체 매입원가가 [원가 입력]에 가중평균으로 들어갑니다');
    await h.spot('button:has-text("저장")', 1800, 8).catch(() => {});
    await h.click('button[aria-label="닫기"]', { after: 600 }).catch(() => {});
    await h.cap('<b>상품별 평균 원가</b> — 원가 현황과 다르면 [원가에 반영]이 뜹니다');
    await h.scroll('h3:has-text("상품별 평균 원가")', { after: 700 });
    await h.spot('button:has-text("원가에 반영")', 2200, 8).catch(() => wait(h, 2200));
    await h.cap('수입부가세는 일반과세자면 돌려받는 돈이라 기본은 원가에서 뺍니다. 못 돌려받는 경우에만 포함을 켜세요');
    await h.scroll('h3:has-text("매입 기록")', { after: 700 });
    await wait(h, 2600);
  } },
  settlement: { title: '정산 캘린더', subtitle: '언제 얼마가 들어오는지 봅니다', steps: 5, async run(h) {
    await h.cap('위 카드는 <b>앞으로 7일 · 30일 입금</b>과 주간 평균입니다. 자금 계획의 기준이 됩니다');
    await h.spot('text=앞으로 7일 입금', 2400, 10).catch(() => wait(h, 2400));
    await h.cap('달력에는 <b>윙 주정산</b>과 <b>로켓그로스 월정산</b>이 날짜별로 찍힙니다');
    await h.scroll('h3:has-text("2026년 10월")', { after: 700 });
    await wait(h, 2600);
    await h.cap('<b>입금 일정</b> 표는 오늘 이후 지급 예정만 모아 보여줍니다');
    await h.scroll('h3:has-text("입금 일정")', { after: 700 });
    await wait(h, 2400);
    await h.cap('<b>정산서 대조</b> — 우리가 계산한 정산액과 쿠팡 정산서를 달마다 견줍니다');
    await h.scroll('h3:has-text("정산서 대조")', { after: 700 });
    await wait(h, 2400);
    await h.cap('[정산서 입력]에 윙+그로스 합계를 넣으면 차이와 <b>역산 수수료율</b>이 나옵니다. 어긋나면 표시됩니다');
    await h.spot('button:has-text("정산서 입력")', 2600, 8).catch(() => wait(h, 2600));
  } },
  inventory: { title: '재고 예측', subtitle: '며칠치 남았는지, 얼마나 들여올지', steps: 5, async run(h) {
    await h.cap('위 버튼은 필터입니다. <b>품절 · 7일 이내 소진 · 14일 이내 · 과잉 재고</b> 개수가 보입니다');
    await h.spot('button:has-text("7일 이내 소진")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>입고 리드타임</b>과 <b>목표 재고 기간</b>을 내 상황에 맞게 바꾸면 입고 권장 수량이 다시 계산됩니다');
    await h.spot('text=입고 리드타임', 2400, 10).catch(() => wait(h, 2400));
    await h.cap('표는 최근 판매 속도로 <b>남은 일수</b>를 계산하고 <b>입고 권장</b> 수량을 제안합니다');
    await h.scroll('table', { after: 700 });
    await h.spot('th:has-text("입고 권장")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('시즌이 지난 상품은 <b>발주 알림에서 제외</b>할 수 있습니다. 행의 알림 버튼을 누르면 자동 → 제외 → 항상으로 바뀝니다');
    await h.spot('button[title^="자동 판단"]', 2600, 8).catch(() => wait(h, 2600));
    await h.cap('부족한 것만 보기를 끄면 여유 · 과잉 재고까지 전부 보입니다');
    await h.click('text=부족한 것만 보기', { after: 900 }).catch(() => {});
    await wait(h, 1800);
  } },
  reconcile: { title: '재고 대조', subtitle: '사입 · 입고 기록 대비 쿠팡 재고', steps: 5, async run(h) {
    await h.cap('기준 재고에 사입 주문과 입고를 더하고 판매를 빼면 <b>예상 재고</b>입니다. 쿠팡 재고와 견줍니다');
    await h.spot('text=쿠팡 재고가 부족', 2400, 10).catch(() => wait(h, 2400));
    await h.cap('표의 <b>차이</b>가 마이너스면 쿠팡에 덜 들어갔거나 분실 · 불량입니다. 플러스면 반품 재입고 등입니다');
    await h.scroll('table', { after: 700 });
    await h.spot('th:has-text("차이")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>N건</b> 버튼을 누르면 그 옵션의 사입 · 입고 기록이 펼쳐집니다');
    await h.click('tbody tr:first-child button:has-text("건")', { after: 1000 }).catch(() => {});
    await wait(h, 1600);
    await h.cap('아래 폼에 <b>주문일 · 주문수량 · 입고일 · 입고수량</b>을 적고 [기록]을 누르면 됩니다');
    await h.spot('button:has-text("기록")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('처음 시작할 때는 <b>지금 재고를 기준으로 시작</b>을 누르면 오늘 쿠팡 재고가 기준이 됩니다');
    await h.spot('button:has-text("지금 재고를 기준으로 시작")', 2400, 8).catch(() => wait(h, 2400));
  } },
  returns: { title: '반품 분석', subtitle: '왜 돌아오는지, 어디를 고칠지', steps: 5, async run(h) {
    await h.cap('<b>반품 사유 분석</b>은 최근 90일 사유를 일곱 가지로 묶습니다. 상세페이지와 검수로 줄일 수 있는 유형이 먼저입니다');
    await h.spot('h3:has-text("반품 사유 분석")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('유형을 누르면 <b>무엇을 고칠지</b>와 실제 고객 문구가 펼쳐집니다');
    await h.click('button:has-text("사이즈")', { after: 1000 }).catch(() => {});
    await wait(h, 2200);
    await h.cap('<b>상품별로 고칠 것</b> — 반품률이 높은 상품과 그 상품의 1위 사유입니다');
    await h.scroll('h4:has-text("상품별로 고칠 것")', { after: 700 });
    await wait(h, 2400);
    await h.cap('아래는 기간별 <b>반품 건수 · 반품률 · 배송비 손실 · 판매자 귀책</b>입니다');
    await h.scroll('text=배송비 손실', { after: 700 }).catch(() => {});
    await wait(h, 2200);
    await h.cap('<b>상품별 반품</b> 표의 손실은 원가 입력의 반품 배송비로 계산합니다. 비어 있으면 채워 주세요');
    await h.scroll('h3:has-text("상품별 반품")', { after: 700 });
    await wait(h, 2400);
  } },
  inquiries: { title: '고객문의', subtitle: '답변 초안을 AI가 씁니다', steps: 5, async run(h) {
    await h.cap('윙에 들어온 <b>미답변 문의</b>가 모입니다. 상품명과 문의 내용, 고객이 보입니다');
    await h.spot('article >> nth=0', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>답변 초안 만들기</b>를 누르면 상품 정보를 바탕으로 초안을 씁니다');
    await h.click('article >> nth=0 >> button:has-text("답변 초안 만들기")', { after: 1400 }).catch(() => {});
    await wait(h, 1200);
    await h.cap('초안을 읽고 <b>필요한 곳만 고친 뒤</b> 고객에게 전송합니다. 전송 후에는 수정할 수 없습니다');
    await h.spot('article >> nth=0 >> textarea', 2600, 8).catch(() => wait(h, 2600));
    await h.cap('[대괄호] 자리가 남아 있으면 보내기 전에 한 번 더 묻습니다');
    await h.spot('article >> nth=0 >> button:has-text("고객에게 전송")', 2200, 8).catch(() => wait(h, 2200));
    await h.cap('<b>답변한 것도 보기</b>를 켜면 답변 완료 문의까지 같이 봅니다');
    await h.click('text=답변한 것도 보기', { after: 900 }).catch(() => {});
    await wait(h, 1800);
  } },
  rank: { title: '순위 · 매출', subtitle: '순위 한 계단이 내 매출로 얼마인가', steps: 5, async run(h) {
    await h.cap('<b>내 상품 순위 확인</b> — 키워드를 넣고 [순위 확인]을 누르면 지금 몇 위인지 바로 봅니다');
    await h.spot('h3:has-text("내 상품 순위 확인")', 2200, 8).catch(() => wait(h, 2200));
    await h.type('input[placeholder="키워드"] >> nth=0', '여자 니트티', { delay: 80 }).catch(() => {});
    await h.click('button:has-text("순위 확인") >> nth=0', { after: 1400 }).catch(() => {});
    await wait(h, 1200);
    await h.cap('아래 카드는 순위 추적에 등록된 상품마다 <b>순위와 판매의 관계</b>를 계산한 것입니다');
    await h.scroll('h3:has-text("여자 니트티")', { after: 700 }).catch(() => {});
    await wait(h, 2400);
    await h.cap('"한 계단 올릴 때마다 주간 매출이 약 얼마"가 나옵니다. 광고비를 얼마까지 써도 되는지의 기준입니다');
    await h.spot('text=/한 계단 올릴 때마다/', 2800, 8).catch(() => wait(h, 2800));
    await h.cap('<b>순위와 판매 추이 보기</b>를 열면 날짜별 순위와 판매량이 한 그래프에 보입니다');
    await h.click('button:has-text("순위와 판매 추이 보기") >> nth=0', { after: 1000 }).catch(() => {});
    await wait(h, 2200);
    await h.cap('며칠치가 안 쌓인 상품은 <b>집계 중</b>으로 표시됩니다. 최소 7일이 필요합니다');
    await wait(h, 2200);
  } },
  price: { title: '가격 관리', subtitle: '마진 하한 아래로는 팔지 않습니다', steps: 5, async run(h) {
    await h.cap('원가와 수수료로 <b>하한가</b>를 계산하고, 현재가가 그 아래면 빨간 줄로 알립니다');
    await h.spot('text=/마진 하한 아래에서 팔리고 있습니다/', 2600, 8).catch(() => wait(h, 2600));
    await h.cap('상품마다 <b>목표 이익률 · 절대 하한 · 절대 상한 · 비교 키워드</b>를 정합니다');
    await h.scroll('table', { after: 700 });
    await h.spot('th:has-text("목표 이익률")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>제안</b> 열에 바꿀 가격이 뜹니다. 누르면 쿠팡에 즉시 반영됩니다');
    await h.spot('button:has-text("원로 변경") >> nth=0', 2600, 8).catch(() => wait(h, 2600));
    await h.cap('<b>자동</b>을 켜면 매일 오전 9시에 한도 안에서 자동으로 맞춥니다. 원가가 없는 상품은 켤 수 없습니다');
    await h.spot('input[aria-label="매일 오전 9시 자동 반영"] >> nth=0', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('바꾼 가격은 <b>가격 변경 기록</b>에 남습니다');
    await h.scroll('h3:has-text("가격 변경 기록")', { after: 700 }).catch(() => {});
    await wait(h, 2200);
  } },
  costs: { title: '원가 입력', subtitle: '한 번만 넣으면 순이익이 자동으로 계산됩니다', steps: 6, async run(h) {
    await h.cap('판매가 많은데 원가가 <b>빈 옵션</b>이 위로 올라옵니다. 거기부터 채우세요');
    await h.spot('h3:has-text("원가 입력")', 2200, 8);
    await h.cap('옵션이 여러 개인 상품은 <b>상품 줄(전체 적용)</b>에 한 번 넣으면 옵션 전체에 들어갑니다');
    await h.scroll('table', { after: 700 });
    await h.spot('text=여기 넣으면 전체 적용', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('매입원가만 넣어도 됩니다. 부자재 · 출고배송 · 입출고비 · 반품배송은 알면 넣으세요');
    await h.type('tbody tr:first-child input[type=number] >> nth=0', '8500', { delay: 90 }).catch(() => {});
    await wait(h, 1400);
    await h.cap('오른쪽 <b>개당 남는 돈</b>은 쿠폰가에서 원가를 뺀 값입니다. 수수료 전이라 참고용입니다');
    await h.spot('th:has-text("개당 남는 돈")', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('다 넣었으면 위의 <b>저장</b>을 누릅니다. 바뀐 개수가 버튼에 표시됩니다');
    await h.scroll(-3000, { after: 600 });
    await h.spot('button:has-text("저장")', 2200, 8).catch(() => wait(h, 2200));
    await h.cap('상품이 많으면 <b>양식 내려받기</b>로 엑셀에 채워 <b>엑셀로 올리기</b>로 한 번에 넣습니다');
    await h.spot('button:has-text("양식 내려받기")', 2400, 8).catch(() => wait(h, 2400));
  } },
  settings: { title: '연동 설정', subtitle: '브리핑 · 리포트 · 연동 정보', steps: 4, async run(h) {
    await h.cap('<b>아침 브리핑</b> — 매일 아침 어제 매출 · 발주 알림 · 광고비를 메일로 받습니다');
    await h.spot('h3:has-text("아침 브리핑")', 2400, 8);
    await h.cap('발주 리드타임과 시즌 지난 상품 기준을 내 상황에 맞게 바꿉니다');
    await h.spot('input[inputmode="numeric"] >> nth=0', 2400, 8).catch(() => wait(h, 2400));
    await h.cap('<b>주간 성과 리포트</b>는 매주 월요일 자동 발송됩니다. 지난 리포트는 여기서 봅니다');
    await h.scroll('h3:has-text("주간 성과 리포트")', { after: 700 });
    await wait(h, 2400);
    await h.cap('<b>연동 정보</b>에서 키 만료일을 확인하세요. 만료 14일 전부터 위에 경고가 뜹니다');
    await h.scroll('h3:has-text("연동 정보")', { after: 700 });
    await h.spot('text=키 만료까지', 2400, 8).catch(() => wait(h, 2400));
  } },
};

const only = process.argv.slice(2);
for (const [view, sc] of Object.entries(scenes)) {
  if (only.length && !only.includes(view)) continue;
  await record({
    name: `coupang-${view}-guide`, title: `정산AI · ${sc.title}`, subtitle: sc.subtitle,
    token: fakeToken(), tokenKey: TOKEN_KEY, mocks: coupangMocks,
    session: { 'hoonpro-coupang-view': view },
    async run(h) {
      h.steps(sc.steps);
      await h.goto('/?tab=coupang');
      await h.sleep(900);
      await h.titleCard();
      await sc.run(h);
      await h.sleep(600);
    },
  });
}
