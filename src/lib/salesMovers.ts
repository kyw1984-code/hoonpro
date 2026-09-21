/**
 * 매출 급감·급증 감지 — 최근 7일과 그 전 7일을 옵션별로 견준다.
 *
 * 판매자가 아침에 가장 먼저 알고 싶은 것은 "어제 얼마 팔았나"보다 "뭐가
 * 갑자기 빠졌나"다. 순위가 밀렸는지, 재고가 비었는지, 쿠폰이 끝났는지는 그
 * 다음 질문이고, 이 표가 그 질문을 던지게 만든다.
 *
 * 하루 단위로 비교하면 요일 효과와 우연이 섞여 매일 다른 목록이 나온다.
 * 7일씩 묶으면 그 흔들림이 가라앉는다. 표본이 작은 옵션(합쳐 6개 미만)은
 * 두 배가 돼도 우연일 수 있어 뺀다.
 */
export interface MoverInput {
  vendorItemId: string;
  productName: string;
  optionName: string;
  channel: 'wing' | 'growth';
  recentQty: number;
  prevQty: number;
  recentAmount: number;
  prevAmount: number;
  /** 지금 재고. 모르면 null */
  stock: number | null;
}

export interface SalesMover extends MoverInput {
  /** 전주 대비 변화율(%). 전주가 0이면 null */
  pct: number | null;
  /** 원인 후보 — 재고·신규 같은, 데이터로 바로 말할 수 있는 것만 */
  hints: string[];
}

export interface SalesMovers {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  drops: SalesMover[];
  rises: SalesMover[];
}

/** 최소 표본 — 두 주를 합쳐 이만큼은 팔렸어야 변화를 말한다 */
export const MOVER_MIN_TOTAL = 6;
/** 급감 기준 — 전주의 70% 이하 */
export const DROP_RATIO = 0.7;
/** 급증 기준 — 전주의 150% 이상 */
export const RISE_RATIO = 1.5;
/** 한쪽에 보여줄 최대 개수 */
export const MOVER_LIMIT = 8;

function hintsFor(m: MoverInput, kind: 'drop' | 'rise'): string[] {
  const out: string[] = [];
  const perDay = m.recentQty / 7;
  if (m.stock !== null) {
    if (m.stock <= 0) out.push(m.channel === 'growth' ? '로켓창고 재고 없음' : '재고 0');
    else if (perDay > 0 && m.stock / perDay < 7) out.push(`재고 ${m.stock}개 — 일주일 안에 소진`);
  }
  if (kind === 'rise' && m.prevQty === 0) out.push('지난주 판매 없음 — 신규·재개');
  if (kind === 'drop' && out.length === 0) out.push('재고는 있음 — 노출·가격·쿠폰 확인');
  return out;
}

export function pickMovers(rows: MoverInput[]): { drops: SalesMover[]; rises: SalesMover[] } {
  const drops: SalesMover[] = [];
  const rises: SalesMover[] = [];
  for (const r of rows) {
    if (r.recentQty + r.prevQty < MOVER_MIN_TOTAL) continue;
    const pct = r.prevQty > 0 ? Math.round(((r.recentQty - r.prevQty) / r.prevQty) * 100) : null;
    if (r.prevQty >= 5 && r.recentQty <= r.prevQty * DROP_RATIO) {
      drops.push({ ...r, pct, hints: hintsFor(r, 'drop') });
    } else if (r.recentQty >= 5 && (r.prevQty === 0 || r.recentQty >= r.prevQty * RISE_RATIO)) {
      rises.push({ ...r, pct, hints: hintsFor(r, 'rise') });
    }
  }
  // 금액이 큰 변화부터. 개수보다 돈이 판매자의 우선순위다.
  drops.sort((a, b) => (b.prevAmount - b.recentAmount) - (a.prevAmount - a.recentAmount));
  rises.sort((a, b) => (b.recentAmount - b.prevAmount) - (a.recentAmount - a.prevAmount));
  return { drops: drops.slice(0, MOVER_LIMIT), rises: rises.slice(0, MOVER_LIMIT) };
}
