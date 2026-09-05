import { createClient } from '@supabase/supabase-js';
import { computeProfit, computeInventory, kstToday, addDays } from './coupang';

// ═══════════════════════════════════════════════════════════════
// [8] 코칭AI에 질문자의 실제 판매 데이터를 붙인다
//
// 같은 질문이라도 "광고를 더 태울까요?"는 이익률 3%인 사람과 22%인 사람에게
// 답이 다르다. 코칭AI가 일반론에서 개인 컨설팅으로 올라서려면 질문자의 숫자를
// 알아야 한다.
//
// 두 가지를 지킨다.
//  · 토큰을 아낀다. 요약은 300자 안팎으로 눌러 담는다. 질문마다 붙는 비용이라
//    상품 목록을 통째로 넣으면 코칭AI 원가가 몇 배가 된다.
//  · 조언의 근거는 여전히 강의 자료다. 숫자는 '질문자에 대한 사실'로만 쓴다.
//
// 파일명이 밑줄로 시작하므로 Vercel이 이 파일을 라우트로 만들지 않는다.
// ═══════════════════════════════════════════════════════════════

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/**
 * 질문자의 최근 30일 판매 요약. 연동이 없거나 데이터가 없으면 null을 돌려
 * 호출부가 아무것도 붙이지 않게 한다.
 */
// 질문마다 순이익·재고를 다시 계산하면 쿼리 7개가 붙는다. 하루 안에 숫자가
// 크게 바뀌지 않으므로 10분 동안은 같은 요약을 재사용한다. 서버리스 인스턴스가
// 바뀌면 캐시도 비지만, 그때는 한 번 더 계산하면 될 뿐이다.
const CONTEXT_TTL_MS = 10 * 60_000;
const contextCache = new Map<string, { at: number; value: string | null }>();

export async function buildSellerContext(userId: string): Promise<string | null> {
  const hit = contextCache.get(userId);
  if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.value;
  const value = await computeSellerContext(userId);
  contextCache.set(userId, { at: Date.now(), value });
  if (contextCache.size > 500) {
    // 오래된 것부터 버린다 — 메모리를 무한정 먹지 않게
    const oldest = [...contextCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) contextCache.delete(k);
  }
  return value;
}

async function computeSellerContext(userId: string): Promise<string | null> {
  if (!supabase) return null;

  try {
    const { data: acc } = await supabase
      .from('coupang_accounts')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle();
    if (!acc || acc.status !== 'active') return null;

    const today = kstToday();
    const from = addDays(today, -29);

    const [profit, inventory, settleRes] = await Promise.all([
      computeProfit(userId, from, today),
      computeInventory(userId),
      supabase
        .from('coupang_settlements')
        .select('amount')
        .eq('user_id', userId)
        .gte('settlement_date', today)
        .lte('settlement_date', addDays(today, 30)),
    ]);

    if (profit.totals.quantity === 0) return null;

    const lines: string[] = [];
    lines.push(`· 최근 30일 매출 ${won(profit.totals.salesAmount)}, 판매 ${profit.totals.quantity.toLocaleString('ko-KR')}개`);
    lines.push(
      `· 쿠팡 수수료 ${won(profit.totals.commission)}, 순이익 ${won(profit.totals.profit)} (이익률 ${profit.totals.marginRate.toFixed(1)}%)`,
    );

    // 원가가 덜 채워졌으면 이익률이 부풀려진 상태다. 모델이 그걸 모르면 안 된다.
    if (profit.missingCost > 0) {
      lines.push(`· 주의: 원가 미입력 상품이 ${profit.missingCost}개라 위 순이익은 실제보다 높게 잡혀 있다`);
    }

    const sold = profit.rows.filter(r => r.quantity > 0 && r.costEntered);
    const best = sold.slice(0, 3);
    const loss = sold.filter(r => r.profit < 0);
    if (best.length > 0) {
      lines.push(`· 이익 상위: ${best.map(r => `${r.productName.slice(0, 18)}(${won(r.profit)})`).join(', ')}`);
    }
    if (loss.length > 0) {
      lines.push(
        `· 적자 상품 ${loss.length}개: ${loss.slice(0, 3).map(r => `${r.productName.slice(0, 18)}(${won(r.profit)})`).join(', ')}`,
      );
    }

    if (profit.totals.returnCount > 0) {
      const rate = profit.totals.quantity > 0 ? (profit.totals.returnCount / profit.totals.quantity) * 100 : 0;
      lines.push(`· 반품 ${profit.totals.returnCount}건 (판매 대비 ${rate.toFixed(1)}%)`);
    }

    const urgent = inventory.rows.filter(r => r.risk === 'out' || r.risk === 'urgent');
    if (urgent.length > 0) {
      lines.push(
        `· 품절·임박 ${urgent.length}개: ${urgent.slice(0, 3).map(r => r.productName.slice(0, 18)).join(', ')}`,
      );
    }

    const incoming = (settleRes.data ?? []).reduce((n, s) => n + (Number(s.amount) || 0), 0);
    if (incoming > 0) lines.push(`· 30일 내 입금 예정 ${won(incoming)}`);

    return lines.join('\n');
  } catch {
    // 데이터를 못 붙여도 코칭AI 자체는 답해야 한다
    return null;
  }
}
