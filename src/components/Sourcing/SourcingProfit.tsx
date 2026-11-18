/**
 * 소싱 손익 계산기 — 판매가에서 수수료와 입출고비만 빼는 단순 계산.
 *
 * 예전에는 광고비·반품·쿠폰 비율과 목표 이익률까지 넣었는데, 소싱 단계에서
 * 보기에는 항목이 많아 답이 흐려졌다. 지금은 두 가지만 뺀다:
 *   수수료  내 최근 60일 실적의 수수료율 (실적이 없으면 기본 10.8%)
 *   입출고비 개당 3,650원 (로켓그로스 입출고·배송)
 */
import { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { ratioPct, won } from '../../lib/coupang';
import type { SellerRates } from '../../lib/sourcingProfit';

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


/** 로켓그로스 입출고·배송비 (개당) */
const FULFILLMENT_FEE = 3650;
/** 실적이 없을 때 쓰는 쿠팡 판매 수수료율 */
const DEFAULT_COMMISSION = 0.108;

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

  // 실적을 못 불러와도 계산은 된다 — 수수료율만 기본값으로 바뀐다
  const hasRate = Boolean(data?.hasData && data.rates && data.rates.commission > 0);
  const commissionRate = hasRate ? data!.rates!.commission : DEFAULT_COMMISSION;
  const listPrice = Number(price) || 0;
  const commission = Math.round(listPrice * commissionRate);
  const maxCost = listPrice - commission - FULFILLMENT_FEE;
  const quoteCost = Number(quote) || 0;
  const profit = quoteCost > 0 ? maxCost - quoteCost : null;

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
        판매가에서 수수료 {ratioPct(commissionRate)}{hasRate ? ' (내 최근 60일 실적)' : !data && !error ? ' (실적 확인 중)' : ' (기본값)'}와
        입출고비 {won(FULFILLMENT_FEE)}을 뺍니다.
      </p>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[11px] text-ink-3">판매가</span>
        <input
          value={price}
          onChange={e => setPrice(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="w-full rounded-control border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink focus:border-accent focus:outline-none"
        />
      </label>

      {/* 결론을 먼저. 계산 과정은 아래에 작게 */}
      <div className={`mt-3 rounded-control px-3.5 py-3 ${maxCost <= 0 ? 'bg-critical-soft' : 'bg-accent-soft'}`}>
        {maxCost <= 0 ? (
          <p className="text-[13px] font-semibold text-critical">
            이 가격에서는 수수료와 입출고비만으로 남는 금액이 없습니다.
          </p>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-ink">
            수수료와 입출고비를 빼면 <b className="text-accent">{won(maxCost)}</b>이 남습니다. 원가가 이보다 낮아야 이익입니다.
          </p>
        )}
        <p className="mt-1 text-[11.5px] text-ink-3">
          판매가 {won(listPrice)} − 수수료 {won(commission)} − 입출고비 {won(FULFILLMENT_FEE)}
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
        {profit !== null && (
          <span className={`text-[12.5px] font-semibold ${profit > 0 ? 'text-positive' : 'text-critical'}`}>
            개당 {won(profit)}{listPrice > 0 ? ` · 이익률 ${ratioPct(profit / listPrice)}` : ''}
          </span>
        )}
      </div>

    </div>
  );
}
