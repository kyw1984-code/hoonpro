/**
 * 광고 보고서에서 날짜별 광고비를 뽑는다.
 *
 * 쿠팡 Open API에는 광고 엔드포인트가 없다. 광고 데이터는 광고센터라는 별도
 * 시스템에만 있고 판매자용 공개 API가 없어, 광고 보고서 파일로 받는 수밖에 없다.
 * 대신 한 번 올린 값을 날짜별로 쪼개 두면 순이익 화면이 조회 기간에 겹치는
 * 날만 합산해 자동으로 채운다.
 *
 * 화면과 분리해 둔 이유는 이 계산이 UI와 무관하고, 날짜 파싱이 틀리면
 * 광고비가 통째로 어긋나 순이익이 조용히 부풀려지기 때문이다.
 */
// 쿠팡 Open API에는 광고 엔드포인트가 없어 광고비는 이 보고서 파일로만 들어온다.
// 보고서에 일자 컬럼이 있으면 날짜별로 쪼개 두고, 순이익 화면이 조회 기간에
// 맞춰 알아서 합산한다. 파일 한 번 올리면 그 기간은 계속 자동으로 맞는다.
export const AD_DATE_COLUMNS = ["날짜", "일자", "광고일자", "집행일자", "기준일", "보고서 날짜", "date", "Date"];

const pad2 = (n: number) => String(n).padStart(2, "0");

export function toISODate(v: any): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // 로컬 기준으로 읽어야 UTC 변환에서 하루씩 밀리지 않는다
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  // cellDates를 못 붙인 경로(CSV 등)로 들어온 엑셀 시리얼 날짜
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const str = String(v ?? "").trim();
  // 광고센터 보고서의 날짜는 구분자 없는 20260906 형태(숫자 또는 문자열)로 온다.
  // 이걸 못 읽으면 일자별 광고비가 통째로 '추정'(균등 분배)으로 떨어진다.
  const compact = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const mo = Number(compact[2]), dy = Number(compact[3]);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    return null;
  }
  const m = str.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (!m) return null;
  const mo = Number(m[2]), dy = Number(m[3]);
  if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return null;
  return `${m[1]}-${pad2(mo)}-${pad2(dy)}`;
}

function toNumber(val: any): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/,/g, "").replace(/%/g, "").replace(/^-$/, "0"));
  return isNaN(n) ? 0 : n;
}

/** 보고서에서 날짜별 광고비를 뽑는다. 일자 컬럼이 없으면 null (기간을 직접 받아야 한다) */
export function extractDailyAdCost(rawData: any[]): { days: { date: string; cost: number }[]; from: string; to: string } | null {
  if (!rawData || rawData.length === 0) return null;
  // 컬럼 목록은 여러 행에서 모은다. sheet_to_json은 빈 칸의 키를 아예 만들지
  // 않아서, 첫 행의 날짜나 광고비가 비어 있으면 정확한 일자별 경로를 놓치고
  // 총액을 균등 분배하는 쪽으로 조용히 떨어진다.
  const cols = new Set<string>();
  for (const row of rawData.slice(0, 20)) {
    Object.keys(row ?? {}).forEach(k => cols.add(k.trim()));
  }
  const dateCol = AD_DATE_COLUMNS.find(c => cols.has(c));
  if (!dateCol || !cols.has("광고비")) return null;

  const map = new Map<string, number>();
  for (const raw of rawData) {
    const row: any = {};
    Object.keys(raw).forEach(k => { row[k.trim()] = raw[k]; });
    const date = toISODate(row[dateCol]);
    if (!date) continue;
    map.set(date, (map.get(date) ?? 0) + toNumber(row["광고비"]));
  }
  if (map.size === 0) return null;
  const days = [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, cost]) => ({ date, cost: Math.round(cost) }));
  return { days, from: days[0].date, to: days[days.length - 1].date };
}


/**
 * 표를 2차원 배열로 받아 헤더 줄을 찾아 객체 행으로 바꾼다.
 *
 * 쿠팡 광고 보고서는 맨 위에 제목·기간 같은 줄이 몇 개 있고 그 아래에 진짜
 * 헤더가 온다. 첫 줄을 헤더로 읽으면 열 이름이 "__EMPTY"나 제목 문구가 되어
 * 일자 열을 못 찾고, 광고비가 기간에 균등 분배되는 쪽으로 조용히 떨어진다.
 * '광고비'가 들어 있는 첫 줄을 헤더로 본다. 없으면 첫 줄이 헤더다.
 */
export function rowsFromMatrix(matrix: any[][]): Record<string, any>[] {
  if (!matrix || matrix.length === 0) return [];
  let headerIdx = matrix.findIndex(r => Array.isArray(r) && r.some(c => String(c ?? "").trim() === "광고비"));
  if (headerIdx < 0) headerIdx = 0;
  const header = (matrix[headerIdx] ?? []).map(c => String(c ?? "").trim());
  const out: Record<string, any>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!Array.isArray(r) || r.every(c => c === null || c === undefined || String(c).trim() === "")) continue;
    const obj: Record<string, any> = {};
    header.forEach((h, j) => {
      if (h) obj[h] = r[j];
    });
    out.push(obj);
  }
  return out;
}

// 광고 보고서의 옵션ID 열. 상품별 순이익에 광고비를 붙이려면 이 열이 있어야 한다.
export const AD_OPTION_COLUMNS = ["광고집행 옵션ID", "광고집행 옵션 ID", "옵션ID", "옵션 ID", "vendorItemId"];

/**
 * 보고서에서 날짜·옵션별 광고비를 뽑는다. 일자 열이나 옵션ID 열이 없으면 null.
 * 옵션ID가 비어 있는 행(캠페인 단위로만 잡힌 광고비)은 옵션에 붙일 수 없어 건너뛴다 —
 * 그 몫은 일자별 합계에는 들어가고 옵션별 합계와의 차이로 남는다.
 */
export function extractItemAdCost(rawData: any[]): { date: string; vendorItemId: string; cost: number }[] | null {
  if (!rawData || rawData.length === 0) return null;
  const cols = new Set<string>();
  for (const row of rawData.slice(0, 20)) Object.keys(row ?? {}).forEach(k => cols.add(k.trim()));
  const dateCol = AD_DATE_COLUMNS.find(c => cols.has(c));
  const optCol = AD_OPTION_COLUMNS.find(c => cols.has(c));
  if (!dateCol || !optCol || !cols.has("광고비")) return null;

  const map = new Map<string, number>();
  for (const raw of rawData) {
    const row: any = {};
    Object.keys(raw).forEach(k => { row[k.trim()] = raw[k]; });
    const date = toISODate(row[dateCol]);
    const opt = String(row[optCol] ?? "").replace(/\.0$/, "").trim();
    if (!date || !/^\d+$/.test(opt)) continue;
    const key = `${date}|${opt}`;
    map.set(key, (map.get(key) ?? 0) + toNumber(row["광고비"]));
  }
  if (map.size === 0) return null;
  return [...map.entries()].map(([k, cost]) => {
    const [date, vendorItemId] = k.split("|");
    return { date, vendorItemId, cost: Math.round(cost) };
  });
}
