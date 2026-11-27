/**
 * 소싱 마진 계산기 — 판매가에서 실제로 손에 남는 돈까지.
 *
 *   매출 − 원가 − 수수료(VAT포함) − 물류비(VAT포함) − 반품손실 − 기타 = 영업이익
 *   영업이익 − (매출세액 − 매입세액) = 실마진
 *
 * 매출세액은 판매가 ÷ 11. 매입세액은 수수료·물류비에 붙은 VAT(쿠팡이 세금계산서를
 * 준다)와, 원가에 세금계산서·통관 VAT가 있으면 그 몫까지.
 *
 * 아래에 광고 시뮬레이션: 타깃 ROAS로 광고 1개 판매 시 마진, 손익분기 ROAS,
 * 월 판매량을 오가닉·광고로 나눈 월 총 실마진.
 *
 * 물류비 사이즈 값은 참고용이다. 쿠팡이 프로모션·카테고리별로 수시로 바꾸므로
 * 화면에서 직접 고칠 수 있게 했다.
 */
import { useEffect, useState } from 'react';
import { BarChart3, Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { getToken } from '../../lib/auth';
import type { SellerRates } from '../../lib/sourcingProfit';

/** 실적이 없을 때 쓰는 쿠팡 판매 수수료율 */
const DEFAULT_COMMISSION = 0.108;
const VAT = 0.1;

/**
 * 로켓그로스 사이즈별 입출고비 (배송비 포함, VAT 별도) — 쿠팡 공식 안내의 "최소 금액(~부터)".
 *   극소형 600 + 1,350 / 소형 650 + 1,550 / 중형 1,250 + 2,100
 *   대형1 1,375 + 2,200 / 대형2 1,375 + 4,100 / 특대형 1,375 + 5,600
 * 실제 금액은 판매가 구간과 카테고리에 따라 이보다 높아진다. 정확한 값은 윙의
 * [입출고/배송 비용 확인]에서 보고 칸에 직접 넣는다.
 */
const CFS_SIZES = [
  { key: 'xs', label: '극소형', spec: '~80cm, ~2kg', fee: 1950 },
  { key: 's', label: '소형', spec: '~100cm, ~5kg', fee: 2200 },
  { key: 'm', label: '중형', spec: '~120cm, ~10kg', fee: 3350 },
  { key: 'l1', label: '대형1', spec: '~140cm, ~15kg', fee: 3575 },
  { key: 'l2', label: '대형2', spec: '~160cm, ~20kg', fee: 5475 },
  { key: 'xl', label: '특대형', spec: '~250cm, ~30kg', fee: 6975 },
] as const;

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const digits = (v: string) => v.replace(/[^0-9]/g, '');
const decimal = (v: string) => v.replace(/[^0-9.]/g, '');

function Field({ label, value, onChange, unit, mode = 'int', hint, readOnly }: {
  label: string; value: string; onChange?: (v: string) => void; unit: string;
  mode?: 'int' | 'dec'; hint?: React.ReactNode; readOnly?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11.5px] font-medium text-ink-2">{label}</span>
      <div className={`flex items-center rounded-control border px-3 ${readOnly ? 'border-line bg-paper-2' : 'border-line bg-paper focus-within:border-accent'}`}>
        <input
          value={value}
          readOnly={readOnly}
          onChange={e => onChange?.(mode === 'int' ? digits(e.target.value) : decimal(e.target.value))}
          inputMode={mode === 'int' ? 'numeric' : 'decimal'}
          className={`min-w-0 flex-1 bg-transparent py-2 text-[14px] tabular-nums focus:outline-none ${readOnly ? 'text-ink-3' : 'text-ink'}`}
        />
        <span className="shrink-0 text-[12px] text-ink-3">{unit}</span>
      </div>
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

const Section = ({ title }: { title: string }) => (
  <p className="mb-2 mt-5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
    <span className="h-1.5 w-1.5 rounded-full bg-accent" />{title}
  </p>
);

function Line({ label, value, tone = 'minus', strong }: { label: string; value: number; tone?: 'minus' | 'plus' | 'plain'; strong?: boolean }) {
  const cls = tone === 'minus' ? 'text-critical' : tone === 'plus' ? 'text-positive' : 'text-ink';
  const sign = tone === 'minus' ? '−' : tone === 'plus' ? '+' : '';
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-[12.5px] ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>{label}</span>
      <span className={`tabular-nums text-[13px] ${strong ? 'font-semibold' : ''} ${cls}`}>{sign}{won(Math.abs(value))}</span>
    </div>
  );
}

export function SourcingProfit({
  avgPrice,
  product,
  monthlySales,
}: {
  avgPrice: number;
  /** 상품 카드에서 [마진 분석]을 누르면 그 상품으로 채워진다 */
  product?: { productName: string; productPrice: number; productImage?: string; estimated1688Price?: number } | null;
  /** 윙에서 가져온 그 상품의 최근 28일 판매량 — 월 판매수량 기본값 */
  monthlySales?: number | null;
}) {
  const [rates, setRates] = useState<SellerRates | null>(null);
  const [channel, setChannel] = useState<'growth' | 'market'>('growth');
  const [price, setPrice] = useState(String(avgPrice || ''));
  const [costCurrency, setCostCurrency] = useState<'krw' | 'cny'>('krw');
  const [cost, setCost] = useState('');
  const [yuan, setYuan] = useState('');
  const [multiplier, setMultiplier] = useState(() => {
    const saved = Number(localStorage.getItem('sourcingMultiplier'));
    return Number.isFinite(saved) && saved > 0 ? saved : 300;
  });
  const [commission, setCommission] = useState('');
  const [size, setSize] = useState<string>('xs');
  const [cfsFee, setCfsFee] = useState(String(CFS_SIZES[0].fee));
  const [marketShip, setMarketShip] = useState('3000');
  const [etc, setEtc] = useState('0');
  const [returnRate, setReturnRate] = useState('2');
  const [costHasVat, setCostHasVat] = useState(false);
  const [adOpen, setAdOpen] = useState(true);
  const [roas, setRoas] = useState('500');
  const [monthlyQty, setMonthlyQty] = useState('');
  const [adShare, setAdShare] = useState('30');

  useEffect(() => { setPrice(String(avgPrice || '')); }, [avgPrice]);
  useEffect(() => {
    if (!product) return;
    setPrice(String(product.productPrice || ''));
    if (product.estimated1688Price) { setCostCurrency('cny'); setYuan(String(product.estimated1688Price)); }
  }, [product]);
  useEffect(() => { if (monthlySales != null) setMonthlyQty(String(monthlySales)); }, [monthlySales, product]);

  // 수수료율 기본값은 내 최근 60일 실적, 없으면 10.8%
  useEffect(() => {
    fetch('/api/coupang?action=my-rates&days=60', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.json())
      .then(d => { if (d?.hasData && d.rates) setRates(d.rates); })
      .catch(() => { /* 기본값으로 계산한다 */ });
  }, []);
  useEffect(() => {
    if (commission) return;
    const r = rates && rates.commission > 0 ? rates.commission : DEFAULT_COMMISSION;
    setCommission((Math.round(r * 1000) / 10).toString());
  }, [rates]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMultiplier = (v: number) => {
    const n = Math.min(1000, Math.max(1, Math.round(v) || 300));
    setMultiplier(n);
    try { localStorage.setItem('sourcingMultiplier', String(n)); } catch { /* 무시 */ }
  };
  const pickSize = (key: string) => {
    const s = CFS_SIZES.find(x => x.key === key);
    if (!s) return;
    setSize(key); setCfsFee(String(s.fee));
  };

  // ── 계산 ──
  const P = Number(price) || 0;
  const C = costCurrency === 'cny' ? Math.round((Number(yuan) || 0) * multiplier) : Number(cost) || 0;
  const feeRate = (Number(commission) || 0) / 100;
  const feeVat = Math.round(P * feeRate * (1 + VAT));                 // 수수료 (VAT포함)
  const logisticsNet = channel === 'growth' ? Number(cfsFee) || 0 : Number(marketShip) || 0;
  const logistics = channel === 'growth' ? Math.round(logisticsNet * (1 + VAT)) : logisticsNet;
  const returnLoss = Math.round(P * ((Number(returnRate) || 0) / 100));
  const other = Number(etc) || 0;
  const operating = P - C - feeVat - logistics - returnLoss - other;   // 영업이익
  const salesTax = Math.round(P / 11);
  const inputTax = Math.round(feeVat / 11) + (channel === 'growth' ? Math.round(logistics / 11) : 0) + (costHasVat ? Math.round(C / 11) : 0);
  const vatDue = salesTax - inputTax;
  const realMargin = operating - vatDue;                                 // 실마진
  const marginRate = P > 0 ? realMargin / P : 0;

  // ── 광고 ──
  const R = (Number(roas) || 0) / 100;
  const adCostPer = R > 0 ? Math.round((P / R) * (1 + VAT)) : 0;
  const adMarginPer = realMargin - adCostPer;
  const breakEvenRoas = realMargin > 0 ? (P * (1 + VAT)) / realMargin : null;
  const Q = Number(monthlyQty) || 0;
  const share = Math.min(100, Math.max(0, Number(adShare) || 0)) / 100;
  const adQty = Math.round(Q * share);
  const orgQty = Q - adQty;
  const monthRevenue = Q * P;
  const monthAdBudget = adQty * adCostPer;
  const monthMargin = orgQty * realMargin + adQty * adMarginPer;

  return (
    <div className="rounded-card border border-line bg-paper-2 p-4 sm:p-5">
      <h4 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
        <Calculator className="h-4 w-4 text-accent" /> 마진 계산
      </h4>
      {product && (
        <div className="mt-2 flex items-center gap-3 rounded-control border border-line bg-paper p-2.5">
          {product.productImage && <img src={product.productImage} alt="" className="h-12 w-12 shrink-0 rounded-control border border-line bg-white object-cover" />}
          <p className="line-clamp-2 text-[12.5px] font-medium text-ink" title={product.productName}>{product.productName}</p>
        </div>
      )}

      {/* 판매 방식 */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {([['market', '마켓플레이스', '직접배송'], ['growth', '로켓그로스', 'CFS 풀필먼트']] as const).map(([v, t, s]) => (
          <button key={v} onClick={() => setChannel(v)}
            className={`rounded-control border px-3 py-2.5 text-center transition-colors ${channel === v ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:border-line-strong'}`}>
            <p className={`text-[13px] font-semibold ${channel === v ? 'text-accent' : 'text-ink'}`}>{t}</p>
            <p className="text-[11px] text-ink-3">{s}</p>
          </button>
        ))}
      </div>

      <Section title="판매 정보" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="판매가" value={price} onChange={setPrice} unit="원" />
        {costCurrency === 'krw'
          ? <Field label="원가 (매입가)" value={cost} onChange={setCost} unit="원" />
          : <Field label="원가 (위안)" value={yuan} onChange={setYuan} unit="¥" mode="dec" hint={`× ${multiplier} = ${won(C)}`} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-control border border-line">
          {([['krw', '원(₩)'], ['cny', '위안(¥)']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setCostCurrency(v)}
              className={`px-3 py-1.5 text-[12px] font-semibold ${costCurrency === v ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'}`}>{l}</button>
          ))}
        </div>
        {costCurrency === 'cny' && (
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
            배수
            <input value={multiplier} onChange={e => saveMultiplier(Number(digits(e.target.value)))} inputMode="numeric"
              title="환율에 관세·통관·배대지까지 얹은 배수 — 1위안당 실제로 드는 원화"
              className="w-16 rounded-control border border-line bg-paper px-2 py-1 text-right text-[12px] tabular-nums text-ink focus:border-accent focus:outline-none" />
          </label>
        )}
      </div>

      <Section title="플랫폼 수수료" />
      <Field label="수수료율" value={commission} onChange={setCommission} unit="%" mode="dec"
        hint={<span className="text-caution">VAT 별도 — 실부담 {pct(feeRate * (1 + VAT))} = {won(feeVat)}</span>} />

      <Section title={channel === 'growth' ? 'CFS 입출고비 (배송비 포함)' : '배송비'} />
      {channel === 'growth' ? (
        <>
          <p className="mb-2 text-[11.5px] text-ink-3">사이즈 금액은 쿠팡 공식 안내의 최소 금액입니다. 판매가 구간·카테고리에 따라 더 높아지니 윙 [입출고/배송 비용 확인]의 금액으로 고쳐 주세요.</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {CFS_SIZES.map(s => (
              <button key={s.key} onClick={() => pickSize(s.key)}
                className={`rounded-control border px-1.5 py-2 text-center transition-colors ${size === s.key ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:border-line-strong'}`}>
                <p className={`text-[12.5px] font-semibold ${size === s.key ? 'text-accent' : 'text-ink'}`}>{s.label}</p>
                <p className="text-[10px] text-ink-3">{s.spec}</p>
                <p className="mt-0.5 text-[10.5px] tabular-nums text-ink-2">{s.fee.toLocaleString()}원~</p>
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Field label="입출고비 (배송비 포함, VAT 별도)" value={cfsFee} onChange={v => { setCfsFee(v); setSize(''); }} unit="원" />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-control border border-line bg-paper px-3 py-2">
            <span className="text-[12.5px] font-semibold text-ink">합계 (VAT 포함)</span>
            <span className="text-[14px] font-semibold tabular-nums text-accent">{won(logistics)}</span>
          </div>
        </>
      ) : (
        <Field label="택배비 (개당)" value={marketShip} onChange={setMarketShip} unit="원" />
      )}

      <Section title="부대비용" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="기타 비용 (포장·부자재)" value={etc} onChange={setEtc} unit="원" />
        <Field label="반품률" value={returnRate} onChange={setReturnRate} unit="%" mode="dec" />
        <Field label="반품손실 (자동)" value={returnLoss.toLocaleString()} unit="원" readOnly />
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" checked={costHasVat} onChange={e => setCostHasVat(e.target.checked)} />
        원가에 세금계산서(국내 매입) 또는 통관 VAT가 있음 — 매입세액으로 공제
      </label>

      {/* ── 결과 ── */}
      <div className="mt-5 rounded-card border border-line bg-paper p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink-2">마진 분석 결과</span>
          <span className={`text-[26px] font-semibold tabular-nums ${realMargin > 0 ? 'text-accent' : 'text-critical'}`}>{pct(marginRate)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-b border-dashed border-line pb-2">
          <span className="text-[13px] font-semibold text-ink">매출</span>
          <span className="text-[15px] font-semibold tabular-nums text-ink">{won(P)}</span>
        </div>
        <div className="mt-1">
          <Line label="원가" value={C} />
          <Line label="쿠팡 수수료 (VAT포함)" value={feeVat} />
          <Line label={channel === 'growth' ? 'CFS 입출고비 (VAT포함)' : '택배비'} value={logistics} />
          <Line label={`반품손실 (${returnRate || 0}%)`} value={returnLoss} />
          <Line label="기타 비용" value={other} />
        </div>
        <div className="mt-2 flex items-center justify-between rounded-control bg-positive-soft px-3 py-2.5">
          <span className="text-[13px] font-semibold text-ink">영업이익</span>
          <span className={`text-[15px] font-semibold tabular-nums ${operating >= 0 ? 'text-positive' : 'text-critical'}`}>
            {won(operating)} <span className="text-[11.5px]">{P > 0 ? pct(operating / P) : ''}</span>
          </span>
        </div>
        <div className="mt-3 rounded-control border border-dashed border-line px-3 py-2">
          <p className="mb-1 text-center text-[11.5px] font-semibold text-accent">부가세 정산</p>
          <Line label="매출세액 (판매가 ÷ 11)" value={salesTax} />
          <Line label={`매입세액 (수수료${channel === 'growth' ? '·물류비' : ''}${costHasVat ? '·원가' : ''} VAT)`} value={inputTax} tone="plus" />
          <div className="mt-1 border-t border-line pt-1"><Line label="실 납부 부가세" value={vatDue} strong /></div>
        </div>
        <div className={`mt-3 flex items-center justify-between rounded-control px-4 py-3.5 ${realMargin > 0 ? 'bg-accent text-black' : 'bg-critical-soft text-critical'}`}>
          <span className="text-[14px] font-semibold">실마진</span>
          <span className="text-[20px] font-semibold tabular-nums">{won(realMargin)} <span className="text-[12px]">{pct(marginRate)}</span></span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">소득세(개인 6~45%, 법인 9~24%)는 별도로 차감됩니다.</p>
      </div>

      {/* ── 광고 시뮬레이션 ── */}
      <div className="mt-4 rounded-card border border-line bg-paper">
        <button onClick={() => setAdOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
          <BarChart3 className="h-4 w-4 text-accent" />
          <span className="text-[13px] font-semibold text-ink">광고 시뮬레이션</span>
          <span className="text-[11.5px] text-ink-3">타깃 ROAS · 월 광고비 · 월 총 실마진</span>
          <span className="ml-auto text-ink-3">{adOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
        </button>
        {adOpen && (
          <div className="border-t border-line px-4 pb-4">
            <Section title="광고 수익 분석" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="타깃 ROAS" value={roas} onChange={setRoas} unit="%" />
              <Field label="손익분기 ROAS" value={breakEvenRoas ? String(Math.ceil(breakEvenRoas * 100)) : '—'} unit="%" readOnly
                hint="이 아래로 내리면 광고로 팔수록 손해" />
            </div>
            <div className="mt-3 rounded-control border border-line bg-paper-2 p-3">
              <p className="mb-1 text-[11.5px] font-semibold text-ink-3">광고로 1개 판매 시</p>
              <Line label="실마진 (광고 전)" value={realMargin} tone="plain" />
              <Line label="광고비 (VAT포함)" value={adCostPer} />
              <p className="-mt-0.5 text-right text-[10.5px] text-ink-3">{won(P)} ÷ {roas || 0}% × 1.1</p>
              <div className="mt-1 border-t border-line pt-1">
                <Line label="광고 1개 실마진" value={adMarginPer} tone={adMarginPer >= 0 ? 'plus' : 'minus'} strong />
              </div>
            </div>

            <Section title="월별 목표 수익" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="월 총 판매수량" value={monthlyQty} onChange={setMonthlyQty} unit="개"
                hint={monthlySales != null ? '윙 최근 28일 판매량으로 채웠습니다' : undefined} />
              <Field label="광고 매출 비율" value={adShare} onChange={setAdShare} unit="%" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-control border border-line bg-paper-2 p-3">
                <p className="mb-1 text-[12px] font-semibold text-positive">오가닉 ({Math.round((1 - share) * 100)}%)</p>
                <div className="flex items-center justify-between py-1"><span className="text-[12.5px] text-ink-2">수량</span><span className="text-[13px] tabular-nums text-ink">{orgQty.toLocaleString()}개</span></div>
                <Line label="매출" value={orgQty * P} tone="plain" />
                <div className="mt-1 border-t border-line pt-1"><Line label="실마진" value={orgQty * realMargin} tone="plus" strong /></div>
              </div>
              <div className="rounded-control border border-line bg-paper-2 p-3">
                <p className="mb-1 text-[12px] font-semibold text-caution">광고 ({Math.round(share * 100)}%)</p>
                <div className="flex items-center justify-between py-1"><span className="text-[12.5px] text-ink-2">수량</span><span className="text-[13px] tabular-nums text-ink">{adQty.toLocaleString()}개</span></div>
                <Line label="매출" value={adQty * P} tone="plain" />
                <Line label="광고비" value={monthAdBudget} />
                <div className="mt-1 border-t border-line pt-1"><Line label="실마진" value={adQty * adMarginPer} tone={adMarginPer >= 0 ? 'plus' : 'minus'} strong /></div>
              </div>
            </div>
            <div className="mt-3 rounded-control border border-line bg-paper-2 p-3">
              <Line label="월 총 매출" value={monthRevenue} tone="plain" />
              <Line label="월 광고비 예산" value={monthAdBudget} />
              <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
                <span className="text-[14px] font-semibold text-ink">월 총 실마진</span>
                <span className={`text-[18px] font-semibold tabular-nums ${monthMargin >= 0 ? 'text-accent' : 'text-critical'}`}>{won(monthMargin)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-ink-3">실질 마진율 (광고비 포함)</span>
                <span className="text-[12.5px] font-semibold tabular-nums text-accent">{monthRevenue > 0 ? pct(monthMargin / monthRevenue) : '—'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
