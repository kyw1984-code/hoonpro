/**
 * 쿠팡 윙 판매분석 옵션별 파일(SELLER_INSIGHTS_VENDOR_ITEM_METRICS_*.xlsx) 읽기.
 *
 * 로켓그로스 주문 API는 취소를 안 주고, 이 파일에만 옵션별 '총 취소된 상품수·
 * 총 취소 금액'이 있다. 파일 올리기와 윙 즐겨찾기가 같은 파서를 쓴다.
 * 파일 안에 날짜가 없다 — 어느 날짜 파일인지는 밖에서 정한다.
 */
const loadXLSX = () => import('xlsx');

// 파일의 열 이름 — 쿠팡이 내려주는 그대로
export const INSIGHT_COL = {
  vendorItemId: '옵션 ID',
  channel: '판매방식',
  grossAmount: '총 매출(원)',
  grossQty: '총 판매수',
  cancelAmount: '총 취소 금액(원)',
  cancelQty: '총 취소된 상품수',
} as const;

export interface InsightCancelRow {
  vendorItemId: string;
  cancelQty: number;
  cancelAmount: number;
  grossQty: number;
  grossAmount: number;
}

/** 로켓그로스 줄만 뽑는다. 판매분석 파일이 아니면 어느 열이 없는지 말하며 거절한다 */
export async function parseInsightBuffer(buf: ArrayBuffer): Promise<InsightCancelRow[]> {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headers = new Set(Object.keys(rows[0] ?? {}).map(h => h.trim()));
  for (const h of [INSIGHT_COL.vendorItemId, INSIGHT_COL.channel, INSIGHT_COL.cancelQty, INSIGHT_COL.cancelAmount]) {
    if (!headers.has(h)) throw new Error(`판매분석 옵션별 파일이 아닙니다. '${h}' 열이 없습니다.`);
  }
  const num = (v: unknown) => Math.abs(Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0);
  const get = (r: Record<string, unknown>, key: string) => {
    if (key in r) return r[key];
    const k = Object.keys(r).find(x => x.trim() === key);
    return k ? r[k] : '';
  };
  return rows
    .filter(r => String(get(r, INSIGHT_COL.channel) ?? '').includes('로켓그로스'))
    .map(r => ({
      vendorItemId: String(get(r, INSIGHT_COL.vendorItemId) ?? '').trim(),
      cancelQty: Math.round(num(get(r, INSIGHT_COL.cancelQty))),
      cancelAmount: Math.round(num(get(r, INSIGHT_COL.cancelAmount))),
      grossQty: Math.round(num(get(r, INSIGHT_COL.grossQty))),
      grossAmount: Math.round(num(get(r, INSIGHT_COL.grossAmount))),
    }))
    .filter(r => r.vendorItemId);
}

/**
 * 주소나 파일 이름에서 날짜를 찾는다. 판매분석 요청은 대개 startDate·endDate를
 * 20260919 또는 2026-09-19 꼴로 붙인다. 시작·끝이 다르면 하루가 아니므로 null.
 */
export function dateFromHint(text: string): string | null {
  const found: string[] = [];
  const re = /(\d{4})-?(\d{2})-?(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const mo = Number(m[2]);
    const dy = Number(m[3]);
    const yr = Number(m[1]);
    if (yr < 2020 || yr > 2100 || mo < 1 || mo > 12 || dy < 1 || dy > 31) continue;
    found.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  const uniq = [...new Set(found)];
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return uniq[0];
  // 시작·끝이 같은 날이면 그 날, 다르면 하루짜리 파일이 아니다
  return uniq.every(d => d === uniq[0]) ? uniq[0] : null;
}
