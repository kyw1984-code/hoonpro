/**
 * 소싱 손익 계산기 — "이 가격에 팔면 원가가 얼마 이하여야 남나".
 *
 * 키워드 분석은 검색량과 경쟁까지만 답한다. 정작 소싱할 때 필요한 건 공장에
 * 얼마를 부를지인데, 그건 이 판매자의 수수료율·광고비율·반품률·쿠폰율을 알아야
 * 나온다. 훈프로는 정산AI에 그 값을 실측으로 갖고 있다 — 업계 평균이 아니라
 * 이 사람의 숫자다.
 *
 * 실적이 없으면 비율을 지어내지 않고 그렇게 말한다. 근거 없는 숫자로 소싱
 * 가격을 정하면 화면이 없느니만 못하다.
 */
import { useEffect, useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { ratioPct, won } from '../../lib/coupang';
import { costCeiling, marginAt, type SellerRates } from '../../lib/sourcingProfit';

interface RatesResponse {
  hasData: boolean;
  from: string;
  to: string;
  reason?: string;
  rates?: SellerRates;
  totals?: {
    salesAmount: number;
    netSales: number;
    commission: number;
    adCost: number;
    returnAmount: number;
    couponDiscount: number;
    quantity: number;
  };
}


const MARGINS = [0.1, 0.15, 0.2, 0.3];

export function SourcingProfit({
  avgPrice,
  product,
}: {
  avgPrice: number;
  /** 상품 카드에서 [마진 분석]을 누르면 그 상품으로 채워진다 */
  product?: { productName: string; productPrice: number; estimated1688Price?: number } | null;
}) {
  const [data, setData] = useState<RatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(String(avgPrice || ''));
  const [margin, setMargin] = useState(0.2);
  const [quote, setQuote] = useState('');
  // 1688 위안 가격 → 원화 원가. 예전에는 이 계산이 별도 '마진 계산기'에 있었는데
  // 수수료 12%·배송비 3,000원이 코드에 박혀 있어 이 화면과 다른 답을 냈다.
  // 어느 쪽을 믿어야 할지 모르게 되므로 한 곳으로 합쳤다.
  const [yuan, setYuan] = useState('');
  const [multiplier, setMultiplier] = useState(() => {
    const saved = Number(localStorage.getItem('sourcingMultiplier'));
    return Number.isFinite(saved) && saved > 0 ? saved : 300;
  });

  useEffect(() => { setPrice(String(avgPrice || '')); }, [avgPrice]);

  // 상품 카드에서 고른 상품으로 갈아 끼운다
  useEffect(() => {
    if (!product) return;
    setPrice(String(product.productPrice || ''));
    setYuan(product.estimated1688Price ? String(product.estimated1688Price) : '');
  }, [product]);

  // 위안을 넣으면 견적 원가 칸을 대신 채운다. 두 칸에 각각 넣게 하면
  // 어느 쪽이 쓰이는지 알 수 없다.
  useEffect(() => {
    const y = Number(yuan);
    if (y > 0) setQuote(String(Math.round(y * multiplier)));
  }, [yuan, multiplier]);

  const saveMultiplier = (v: number) => {
    const n = Math.min(1000, Math.max(1, Math.round(v) || 300));
    setMultiplier(n);
    try { localStorage.setItem('sourcingMultiplier', String(n)); } catch { /* 저장 실패는 계산을 막지 않는다 */ }
  };

  useEffect(() => {
    fetch('/api/coupang?action=my-rates&days=60', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || '판매 실적을 불러오지 못했습니다.');
        setData(d);
      })
      .catch(e => setError(e?.message ?? '판매 실적을 불러오지 못했습니다.'));
  }, []);

  if (error) {
    return (
      <div className="rounded-card border border-line bg-paper-2 p-4 text-[12.5px] text-ink-2">
        소싱 손익 계산: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-line bg-paper-2 p-4 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[12.5px]">내 판매 실적으로 계산하는 중...</span>
      </div>
    );
  }

  if (!data.hasData || !data.rates) {
    return (
      <div className="rounded-card border border-line bg-paper-2 p-4">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Calculator className="h-4 w-4 text-ink-3" /> 소싱 손익 계산
        </h4>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
          {data.reason ?? '아직 판매 실적이 없어 계산할 수 없습니다.'}
          {' '}[훈프로 정산AI]에서 쿠팡을 연동하고 수집이 끝나면, 대표님의 실제 수수료·광고비·반품·쿠폰 비율로
          원가 상한을 계산해 드립니다.
        </p>
      </div>
    );
  }

  const rates = data.rates;
  const listPrice = Number(price) || 0;
  const c = costCeiling(listPrice, rates, margin);
  const quoteCost = Number(quote) || 0;
  const m = quoteCost > 0 ? marginAt(listPrice, quoteCost, rates) : null;

  return (
    <div className="rounded-card border border-line bg-paper-2 p-4">
      <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Calculator className="h-4 w-4 text-accent" /> 소싱 손익 계산
      </h4>
      {product && (
        <p className="mt-1 truncate text-[12px] text-ink-2" title={product.productName}>
          {product.productName}
        </p>
      )}
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
        업계 평균이 아니라 <b className="text-ink-2">대표님의 최근 60일 실적</b>에서 뽑은 비율입니다
        (수수료 {ratioPct(rates.commission)} · 광고비 {ratioPct(rates.ad)} · 반품 {ratioPct(rates.returns)} · 쿠폰 {ratioPct(rates.coupon)}).
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11px] text-ink-3">판매가</span>
          <input
            value={price}
            onChange={e => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            className="w-full rounded-control border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-3">목표 이익률</span>
          <div className="flex gap-1">
            {MARGINS.map(v => (
              <button
                key={v}
                onClick={() => setMargin(v)}
                className={`rounded-control px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                  margin === v ? 'bg-ink text-paper' : 'border border-line text-ink-2 hover:text-ink'
                }`}
              >
                {v * 100}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 결론을 먼저. 계산 과정은 아래에 작게 */}
      <div className={`mt-3 rounded-control px-3.5 py-3 ${c.impossible ? 'bg-critical-soft' : 'bg-accent-soft'}`}>
        {c.impossible ? (
          <p className="text-[13px] font-semibold text-critical">
            이 가격에서는 원가가 0원이어도 {margin * 100}%가 남지 않습니다.
          </p>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-ink">
            원가+배송비가 <b className="text-accent">{won(c.maxCost)}</b> 이하여야
            순이익 {margin * 100}%가 남습니다.
          </p>
        )}
        <p className="mt-1 text-[11.5px] text-ink-3">
          판매가 {won(c.listPrice)} → 쿠폰 빼고 {won(c.netPrice)} · 수수료 {won(c.commission)} ·
          광고비 {won(c.adCost)} · 반품 {won(c.returnLoss)} · 목표이익 {won(c.targetProfit)}
        </p>
      </div>

      {/* 1688 위안 가격을 넣으면 원가가 자동으로 채워진다 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink-3">1688 매입가</span>
        <input
          value={yuan}
          onChange={e => setYuan(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          placeholder="위안"
          className="w-20 rounded-control border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <span className="text-[11.5px] text-ink-3">× 배수</span>
        <input
          value={multiplier}
          onChange={e => saveMultiplier(Number(e.target.value.replace(/[^0-9]/g, '')))}
          inputMode="numeric"
          title="환율에 관세·통관까지 얹은 배수입니다. 1위안당 실제로 얼마가 드는지 넣으세요"
          className="w-16 rounded-control border border-line bg-paper px-2.5 py-1.5 text-right text-[12.5px] tabular-nums text-ink focus:border-accent focus:outline-none"
        />
        {Number(yuan) > 0 && (
          <span className="text-[12px] tabular-nums text-ink-2">= {won(Number(yuan) * multiplier)}</span>
        )}
      </div>

      {/* 견적을 받아 왔을 때 바로 확인 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink-3">견적 원가를 넣어 확인</span>
        <input
          value={quote}
          onChange={e => setQuote(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          placeholder="예: 8000"
          className="w-28 rounded-control border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        {m && (
          <span className={`text-[12.5px] font-semibold ${m.profit > 0 ? 'text-positive' : 'text-critical'}`}>
            개당 {won(m.profit)} · 이익률 {ratioPct(m.rate)}
          </span>
        )}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        쿠폰은 판매가에서 먼저 빠지고, 수수료·광고비·반품은 그렇게 남은 실매출에 붙습니다.
        비율은 최근 60일 {data.totals?.quantity.toLocaleString('ko-KR')}개 판매 실적 기준이라, 상품군이 많이 다르면 실제와 차이가 날 수 있습니다.
      </p>
    </div>
  );
}
