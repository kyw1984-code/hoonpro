/**
 * 광고 보고서에서 키워드를 뽑고, 저장본 둘을 견준다.
 *
 * 합계만 견주는 것으로는 부족하다. ROAS가 그대로여도 안에서는 스타 키워드
 * 하나가 죽고 다른 하나가 살아난 것일 수 있다. 무엇을 손봐야 하는지는
 * 키워드 단위로만 보인다.
 *
 * 열 이름 찾기와 숫자 읽기가 여기 있는 이유: 지금 보고서와 지난 보고서를
 * 같은 규칙으로 읽어야 한다. 화면과 여기가 갈라지면 같은 파일을 두 가지로
 * 세고, 변화가 아닌 것이 변화로 보인다.
 */

/** 쿠팡 광고센터 보고서의 판매수량 열. 앞엣것부터 찾는다 */
export const QTY_COLUMNS = ['총 판매수량(14일)', '총 판매수량(1일)', '총 판매수량', '전환 판매수량', '판매수량'];
export const REVENUE_COLUMNS = ['총 전환매출액(14일)', '총 전환매출액(1일)', '총 전환매출액', '전환매출액'];

/** 지면 분류 — "비검색"이 "검색"을 포함하는 substring 함정을 피한다 */
export function isSearchPlatform(platform: string): boolean {
  if (!platform) return false;
  const lower = platform.toLowerCase();
  if (platform.includes('비검색') || lower.includes('non-search') || lower.includes('nonsearch')) return false;
  return platform.includes('검색') || lower.includes('search');
}

export function isNonSearchPlatform(platform: string): boolean {
  if (!platform) return false;
  const lower = platform.toLowerCase();
  if (platform.includes('비검색') || lower.includes('non-search') || lower.includes('nonsearch')) return true;
  if (platform.includes('검색') || lower.includes('search')) return false;
  return false;
}

/** "1,234" · "12%" · "-" 를 모두 숫자로 */
export function parseNum(val: any): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/,/g, '').replace(/%/g, '').replace(/^-$/, '0'));
  return Number.isNaN(n) ? 0 : n;
}

/** 엑셀에서 온 열 이름에는 공백이 붙어 있는 일이 잦다 */
export function normalizeRows(rows: any[]): any[] {
  return (rows ?? []).map(row => {
    const out: any = {};
    for (const k of Object.keys(row ?? {})) out[k.trim()] = row[k];
    return out;
  });
}

export interface DetectedColumns {
  qty: string | null;
  revenue: string | null;
  revenue1d: string | null;
  indirect: string | null;
}

export function detectColumns(sampleRow: any): DetectedColumns {
  const s = sampleRow ?? {};
  const revenue = REVENUE_COLUMNS.find(c => c in s) ?? null;
  return {
    qty: QTY_COLUMNS.find(c => c in s) ?? null,
    revenue,
    revenue1d: revenue === '총 전환매출액(14일)' && '총 전환매출액(1일)' in s ? '총 전환매출액(1일)' : null,
    indirect:
      revenue === '총 전환매출액(14일)' && '간접 전환매출액(14일)' in s ? '간접 전환매출액(14일)'
      : '간접 전환매출액(1일)' in s ? '간접 전환매출액(1일)'
      : null,
  };
}

export interface KeywordAgg {
  keyword: string;
  cost: number;
  clicks: number;
  impressions: number;
  qty: number;
  revenue: number;
  roasPct: number;
  cpc: number;
}

/**
 * 검색 지면의 키워드별 집계.
 *
 * 전환매출 열이 있으면 실측을 쓰고, 없으면 판매수량 × 실결제가로 어림한다.
 * 어림한 값을 실측인 척 하지 않도록 revenueMode를 함께 돌려준다 — 두 보고서의
 * 방식이 다르면 매출 비교가 성립하지 않는다.
 */
export function aggregateKeywords(rawRows: any[], netUnitPrice: number): {
  keywords: KeywordAgg[];
  revenueMode: 'actual' | 'estimated';
  hasKeywordColumn: boolean;
} {
  const rows = normalizeRows(rawRows);
  const sample = rows[0] ?? {};
  const cols = detectColumns(sample);
  const revenueMode: 'actual' | 'estimated' = cols.revenue ? 'actual' : 'estimated';
  const hasKeywordColumn = '키워드' in sample;

  const map = new Map<string, KeywordAgg>();
  if (hasKeywordColumn) {
    for (const row of rows) {
      const kw = String(row['키워드'] ?? '').trim();
      // '-'는 광고센터가 키워드 없는 줄에 쓰는 값이다. 키워드로 세면
      // 비검색 지면 전체가 '-'라는 이름의 키워드 하나로 뭉친다.
      if (!kw || kw === '-') continue;
      if (!isSearchPlatform(String(row['광고 노출 지면'] ?? ''))) continue;

      const qty = cols.qty ? parseNum(row[cols.qty]) : 0;
      const cur = map.get(kw) ?? { keyword: kw, cost: 0, clicks: 0, impressions: 0, qty: 0, revenue: 0, roasPct: 0, cpc: 0 };
      cur.cost += parseNum(row['광고비']);
      cur.clicks += parseNum(row['클릭수']);
      cur.impressions += parseNum(row['노출수']);
      cur.qty += qty;
      cur.revenue += cols.revenue ? parseNum(row[cols.revenue]) : qty * (Number(netUnitPrice) || 0);
      map.set(kw, cur);
    }
  }

  const keywords = [...map.values()].map(k => ({
    ...k,
    roasPct: k.cost > 0 ? (k.revenue / k.cost) * 100 : 0,
    cpc: k.clicks > 0 ? k.cost / k.clicks : 0,
  }));

  return { keywords, revenueMode, hasKeywordColumn };
}

export type KeywordChange = 'new' | 'gone' | 'better' | 'worse' | 'same';

export interface KeywordDiff {
  keyword: string;
  prev: KeywordAgg | null;
  current: KeywordAgg | null;
  costDelta: number;
  roasDelta: number | null;
  qtyDelta: number;
  change: KeywordChange;
}

export interface KeywordDiffSummary {
  /** 새로 생긴 키워드 */
  added: number;
  /** 사라진 키워드 */
  removed: number;
  /** 돈은 더 썼는데 ROAS가 떨어진 키워드 — 가장 먼저 봐야 할 것들 */
  worseAndCostlier: KeywordDiff[];
  /** 살아난 키워드 */
  improved: KeywordDiff[];
  /** 사라진 키워드에 지난번 쓰던 광고비 — 그만큼이 어디론가 옮겨 갔다 */
  removedCost: number;
  /** 새로 생긴 키워드가 쓴 광고비 */
  addedCost: number;
}

/** ROAS가 이 정도(%p) 안쪽으로 움직인 것은 같다고 본다 */
export const ROAS_NOISE_PP = 10;

export function diffKeywords(prev: KeywordAgg[], current: KeywordAgg[]): {
  rows: KeywordDiff[];
  summary: KeywordDiffSummary;
} {
  const prevMap = new Map(prev.map(k => [k.keyword, k]));
  const curMap = new Map(current.map(k => [k.keyword, k]));
  const allKeywords = new Set([...prevMap.keys(), ...curMap.keys()]);

  const rows: KeywordDiff[] = [...allKeywords].map(keyword => {
    const p = prevMap.get(keyword) ?? null;
    const c = curMap.get(keyword) ?? null;

    let change: KeywordChange;
    if (!p) change = 'new';
    else if (!c) change = 'gone';
    else {
      const d = c.roasPct - p.roasPct;
      change = Math.abs(d) < ROAS_NOISE_PP ? 'same' : d > 0 ? 'better' : 'worse';
    }

    return {
      keyword,
      prev: p,
      current: c,
      costDelta: (c?.cost ?? 0) - (p?.cost ?? 0),
      roasDelta: p && c ? c.roasPct - p.roasPct : null,
      qtyDelta: (c?.qty ?? 0) - (p?.qty ?? 0),
      change,
    };
  });

  // 광고비를 많이 쓴 순으로. 화면에서 위부터 보게 된다.
  rows.sort((a, b) => (b.current?.cost ?? b.prev?.cost ?? 0) - (a.current?.cost ?? a.prev?.cost ?? 0));

  const worseAndCostlier = rows
    .filter(r => r.change === 'worse' && r.costDelta > 0)
    .sort((a, b) => b.costDelta - a.costDelta);
  const improved = rows
    .filter(r => r.change === 'better')
    .sort((a, b) => (b.roasDelta ?? 0) - (a.roasDelta ?? 0));

  return {
    rows,
    summary: {
      added: rows.filter(r => r.change === 'new').length,
      removed: rows.filter(r => r.change === 'gone').length,
      worseAndCostlier,
      improved,
      removedCost: rows.filter(r => r.change === 'gone').reduce((n, r) => n + (r.prev?.cost ?? 0), 0),
      addedCost: rows.filter(r => r.change === 'new').reduce((n, r) => n + (r.current?.cost ?? 0), 0),
    },
  };
}
