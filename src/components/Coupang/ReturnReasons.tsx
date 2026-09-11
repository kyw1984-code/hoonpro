/**
 * 반품 사유 분석 — 무엇을 고치면 반품이 줄어드나.
 *
 * 반품 목록은 이미 있지만 한 건씩 흩어져 있어 무엇을 고칠지는 안 보인다.
 * 같은 상품에서 사이즈 얘기가 스무 번 나왔다면 그건 개별 취향이 아니라
 * 상세페이지에 실측 치수가 없다는 뜻이다.
 *
 * 변심은 따로 뺀다. 판매자가 손댈 수 없는 걸 개선 목록에 섞으면
 * "반품률을 낮추라"는 실행 불가능한 결론만 남는다.
 */
import { useEffect, useState } from 'react';
import { Loader2, PackageX, Wrench } from 'lucide-react';
import { getToken } from '../../lib/auth';

interface Category {
  category: string;
  label: string;
  count: number;
  quantity: number;
  share: number;
  actionable: boolean;
  advice: string;
  samples: string[];
}

interface Product {
  productName: string;
  returnCount: number;
  returnQuantity: number;
  sold: number;
  returnRate: number | null;
  sellerFault: number;
  topCategory: { category: string; label: string; count: number; share: number; advice: string } | null;
  categories: Category[];
}

interface Data {
  from: string;
  to: string;
  total: number;
  totalQuantity: number;
  sellerFault: number;
  totalSold: number;
  returnRate: number | null;
  categories: Category[];
  /** 고객이 철회한 반품 — 집계에서 뺐다 */
  cancelledCount?: number;
  products: Product[];
}

const auth = () => ({ Authorization: `Bearer ${getToken()}` });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// 색은 '고칠 수 있는 것'과 아닌 것만 구분한다. 유형마다 색을 다 다르게 주면
// 색이 정보가 아니라 장식이 된다.
const BAR_ACTIONABLE = '#22a3b8';
const BAR_PASSIVE = '#3d4a68';

export function ReturnReasons({ days = 90 }: { days?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/coupang?action=return-reasons&days=${days}`, { headers: auth() })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || '반품 사유를 불러오지 못했습니다.');
        setData(d);
      })
      .catch(e => setError(e?.message ?? '반품 사유를 불러오지 못했습니다.'));
  }, [days]);

  if (error) {
    return (
      <div className="rounded-panel border border-line bg-paper px-5 py-4 text-[12.5px] text-ink-2">
        반품 사유 분석: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-line bg-paper px-5 py-4 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">반품 사유를 분류하는 중...</span>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="rounded-panel border border-line bg-paper px-5 py-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <PackageX className="h-4 w-4 text-ink-3" /> 반품 사유 분석
        </h3>
        <p className="mt-1.5 text-[12.5px] text-ink-2">최근 {days}일 동안 접수된 반품이 없습니다.</p>
      </div>
    );
  }

  const fixable = data.categories.filter(c => c.actionable);
  const fixableCount = fixable.reduce((n, c) => n + c.count, 0);

  return (
    <div className="rounded-panel border border-line bg-paper px-5 py-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <PackageX className="h-4 w-4 text-accent" /> 반품 사유 분석
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
        최근 {days}일 반품 {data.total}건 ({data.totalQuantity.toLocaleString('ko-KR')}개)
        {data.returnRate !== null && <> · 반품률 {pct(data.returnRate)}</>}
        {data.sellerFault > 0 && <> · 판매자 귀책 {data.sellerFault}건</>}
      </p>
      {/* 조용히 빼면 기준이 틀렸을 때 알아챌 방법이 없다 */}
      {(data.cancelledCount ?? 0) > 0 && (
        <p className="mt-1 text-[11.5px] text-ink-3">
          고객이 철회한 반품 {data.cancelledCount}건은 빼고 셌습니다.
        </p>
      )}

      {fixableCount > 0 && (
        <p className="mt-2 rounded-control bg-accent-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
          이 중 <b className="text-accent">{fixableCount}건</b>은 상세페이지나 검수로 줄일 수 있는 유형입니다.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        {data.categories.map(c => (
          <button
            key={c.category}
            type="button"
            onClick={() => setOpen(open === c.category ? null : c.category)}
            className="w-full rounded-card border border-line bg-paper-2 px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-medium text-ink">{c.label}</span>
              {!c.actionable && <span className="text-[10.5px] text-ink-3">판매자가 줄이기 어려움</span>}
              <span className="ml-auto shrink-0 text-[12.5px] font-semibold tabular-nums text-ink">
                {c.count}건 <span className="font-normal text-ink-3">{pct(c.share)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(c.share * 100)}%`, background: c.actionable ? BAR_ACTIONABLE : BAR_PASSIVE }}
              />
            </div>

            {open === c.category && (
              <div className="mt-2">
                {c.advice && <p className="text-[12px] leading-relaxed text-ink-2">{c.advice}</p>}
                {c.samples.length > 0 && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                    분류한 사유: {c.samples.map(s => `"${s.slice(0, 24)}"`).join(' · ')}
                  </p>
                )}
              </div>
            )}
          </button>
        ))}
      </div>

      {data.products.length > 0 && (
        <>
          <h4 className="mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Wrench className="h-3.5 w-3.5 text-ink-3" /> 상품별로 고칠 것
          </h4>
          <div className="mt-2 flex flex-col">
            {data.products.map(p => (
              <div key={p.productName} className="border-t border-line/60 py-2.5 first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink" title={p.productName}>
                    {p.productName}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
                    반품 {p.returnCount}건
                    {p.returnRate !== null && ` · ${pct(p.returnRate)}`}
                  </span>
                </div>
                {p.topCategory ? (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">
                    <b className="text-ink">{p.topCategory.label}</b> {p.topCategory.count}건
                    ({pct(p.topCategory.share)}) — {p.topCategory.advice}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    고칠 수 있는 유형은 없습니다. 대부분 변심이나 주문 실수입니다.
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        사유 원문의 단어로 분류합니다. 알아볼 수 없는 사유는 억지로 묶지 않고 기타에 둡니다.
        반품률은 판매 10개 이상인 상품에만 표시합니다 — 표본이 적으면 비율이 크게 튀기 때문입니다.
      </p>
    </div>
  );
}
