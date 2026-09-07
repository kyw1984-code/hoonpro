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
  const m = String(v ?? "").trim().match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
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
  const keyOf = (row: any) => Object.keys(row).map(k => k.trim());
  const cols = new Set<string>();
  keyOf(rawData[0]).forEach(k => cols.add(k));
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

