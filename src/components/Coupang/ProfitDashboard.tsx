/**
 * [1] 상품별 순이익 대시보드
 *
 * 이 화면이 답하는 질문은 하나다 — "이 상품, 팔면 남나?"
 * 매출은 쿠팡이 보여주지만 순이익은 아무도 안 보여준다. 정산예정액에서
 * 원가와 반품 배송비를 빼야 비로소 남는 돈이 나온다.
 *
 * 광고비는 상품 단위로 알 수 없어(쿠팡 Open API에 광고 엔드포인트 자체가 없다)
 * 기간 총액으로만 반영한다. [광고 성과 분석]에서 보고서를 올려 두면 날짜별로
 * 쌓이고, 여기서는 조회 기간에 겹치는 날만 합산해 자동으로 채운다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Download, Loader2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { coupangApi, pct, won, type ProfitResponse } from '../../lib/coupang';
import { DailyTrendChart } from './DailyTrendChart';
import { AdCenterConnect } from '../AdCenter/AdCenterConnect';

const PERIODS = [
  { days: 7, label: '최근 7일' },
  { days: 30, label: '최근 30일' },
  { days: 90, label: '최근 90일' },
];

interface Props {
  onEditCosts: () => void;
}

interface Delta { text: string; good: boolean; bad: boolean }

/**
 * 쿠폰 단가를 어디서 가져왔는지 한 줄로. 설정값으로 계산된 옵션은 판매자가 아는
 * 숫자(1건당 11,500원 × 2건)와 정확히 맞고, 나머지는 주문에서 역산한 근사다.
 */
function couponBasisText(src?: { setting: number; order: number; sheet: number; definedOptions: number }): string {
  if (!src) return '쿠폰 단가 × 판매수량';
  const parts: string[] = [];
  if (src.setting > 0) parts.push(`쿠폰 설정값 ${src.setting}개 옵션`);
  if (src.order + src.sheet > 0) parts.push(`주문 역산 ${src.order + src.sheet}개 옵션`);
  return parts.length ? `${parts.join(' · ')} × 판매수량` : '쿠폰 단가 × 판매수량';
}

/**
 * 발행한 쿠폰 목록.
 *
 * 쿠폰은 기간마다 금액이 달라진다. 오늘 11,500원짜리를 걸어 뒀는데 30일 화면에는
 * 19,000원으로 보이면 숫자가 틀린 것처럼 읽히지만, 그 기간에 2만원짜리 쿠폰이
 * 걸려 있었던 것이다. 어느 쿠폰이 언제까지 얼마로 걸려 있는지 옆에 두면 그 차이가
 * 설명된다. 계산에는 쓰지 않는다 — 순이익의 쿠폰은 주문에 실제로 적용된 금액이다.
 */
export /** 올해 날짜는 연도를 뗀다. 좁은 화면에서 기간이 잘리지 않게 */
function short(d: string | null): string {
  if (!d) return '?';
  const year = new Date().getFullYear();
  return d.startsWith(`${year}-`) ? d.slice(5) : d;
}

function CouponList({ rows, from, to }: {
  rows: NonNullable<ProfitResponse['couponList']>;
  from: string;
  to: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const state = (c: { startAt: string | null; endAt: string | null }) =>
    c.startAt && c.startAt > today ? 'upcoming' : c.endAt && c.endAt < today ? 'ended' : 'live';
  // 보고 있는 기간과 겹치는 쿠폰이 먼저다. 그게 이 화면 숫자의 근거다.
  const overlaps = (c: { startAt: string | null; endAt: string | null }) =>
    (!c.startAt || c.startAt <= to) && (!c.endAt || c.endAt >= from);
  const sorted = [...rows].sort((a, b) => {
    const ov = Number(overlaps(b)) - Number(overlaps(a));
    if (ov) return ov;
    return String(b.endAt ?? '').localeCompare(String(a.endAt ?? ''));
  });

  return (
    <div className="rounded-panel border border-line bg-paper px-5 py-4">
      <h3 className="mb-1 text-sm font-semibold text-ink">발행한 쿠폰 {rows.length}건</h3>
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-3">
        쿠폰 관리에 등록된 값 그대로입니다. 위 쿠폰 금액은 이 설정이 아니라
        <b className="text-ink-2"> 주문에 실제로 적용된 할인</b>을 더한 것이라, 기간에 따라 평균이 달라집니다.
        기간을 좁혀 보시면 지금 걸린 쿠폰에 가까운 값이 나옵니다.
      </p>
      <div className="flex flex-col">
        {sorted.map(c => {
          const st = state(c);
          const dim = !overlaps(c);
          return (
            <div
              key={c.couponId}
              className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-line/60 py-2 ${dim ? 'opacity-45' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2" title={c.name}>{c.name}</span>
              <span className="whitespace-nowrap text-[12.5px] font-semibold text-ink tabular-nums">
                − {c.discount.toLocaleString('ko-KR')}원
              </span>
              <span className="basis-full text-[11.5px] text-ink-3 tabular-nums">
                {short(c.startAt)} ~ {short(c.endAt)}
                <span
                  className={`ml-1.5 rounded-control px-1.5 py-0.5 text-[11px] font-medium ${
                    st === 'live' ? 'bg-accent-soft text-accent' : st === 'upcoming' ? 'border border-line text-ink-3' : 'text-ink-3'
                  }`}
                >
                  {st === 'live' ? '진행 중' : st === 'upcoming' ? '예정' : '종료'}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SortKey = 'quantity' | 'salesAmount' | 'couponDiscount' | 'commission' | 'adCost' | 'unitCostTotal' | 'returnAmount' | 'profit' | 'marginRate';

/**
 * 직전 같은 길이 기간과의 증감.
 * 비용(수수료·원가)은 늘어난 쪽이 나쁘므로 higherIsBetter로 색을 뒤집는다.
 * 직전 기간에 판매가 없으면 증감률이 무의미해 표시하지 않는다.
 */
function delta(current: number, previous: number, hasData: boolean, higherIsBetter = true): Delta | null {
  if (!hasData || previous === 0) return null;
  const diff = current - previous;
  if (Math.round(diff) === 0) return { text: '지난 기간과 비슷', good: false, bad: false };
  const rate = (diff / Math.abs(previous)) * 100;
  const up = diff > 0;
  return {
    text: `${up ? '▲' : '▼'} ${Math.abs(rate).toFixed(0)}%`,
    good: up === higherIsBetter,
    bad: up !== higherIsBetter,
  };
}

export function ProfitDashboard({ onEditCosts }: Props) {
  const [days, setDays] = useState(30);
  // 날짜를 직접 고른 경우. 버튼 기간과는 별개라, 어느 쪽이 살아 있는지가 분명해야 한다.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // 표 정렬. 기본은 순이익 내림차순(원가 미입력은 아래). 열 제목을 누르면 그 열로 바꾸고,
  // 같은 열을 다시 누르면 방향이 뒤집힌다.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const [data, setData] = useState<ProfitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adCost, setAdCost] = useState<number>(0);
  // 사용자가 광고비를 손댔는지는 조회 조건이 아니다. 상태로 두면 처음 수정하는
  // 순간 load의 정체성이 바뀌어 쓸데없는 재조회가 한 번 더 나간다.
  const adTouched = useRef(false);

  // 기간 버튼을 빠르게 두 번 누르면 먼저 보낸 요청이 나중에 도착할 수 있다.
  // 순번이 뒤처진 응답은 버린다.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = range ? await coupangApi.profitRange(range.from, range.to) : await coupangApi.profit(days);
      if (mine !== seq.current) return;
      // 원가가 빈 상품은 순이익이 부풀려진 값이라, 실제 순이익 순위 사이에 섞이면
      // 가장 위에 올라와 착시를 만든다. 원가를 넣은 상품 뒤로 보낸다.
      d.rows.sort((a, b) => {
        if (a.costEntered !== b.costEntered) return a.costEntered ? -1 : 1;
        return b.profit - a.profit;
      });
      setData(d);
      if (!adTouched.current) setAdCost(Math.round(d.adCostHint ?? 0));
      setError(null);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setError(e.message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [days, range]);

  useEffect(() => {
    load();
  }, [load]);

  // 날짜 칸은 둘 다 채워지고 순서가 맞을 때만 조회한다. 한쪽만 고른 상태로
  // 요청을 보내면 서버가 오늘로 채워 넣어 사용자가 고르지 않은 기간이 보인다.
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const pickDate = (key: 'from' | 'to', value: string) => {
    const next = { from: range?.from ?? data?.from ?? '', to: range?.to ?? data?.to ?? '', [key]: value };
    if (!next.from || !next.to) return;
    if (next.from > next.to) {
      // 시작이 끝보다 뒤면 뒤집는다. 오류로 막으면 날짜 두 개 고르는 일이 짜증이 된다.
      const t = next.from; next.from = next.to; next.to = t;
    }
    adTouched.current = false;
    setRange({ from: next.from, to: next.to > today ? today : next.to });
  };

  // 광고비는 상품별로 나눌 수 없으므로 포트폴리오 합계에만 반영한다
  // 상품에 붙은 광고비는 상품별 순이익(totals.profit)에서 이미 빠졌다. 여기서는 옵션에
  // 못 붙은 나머지(캠페인 단위 광고비)만 더 뺀다. 둘 다 빼면 광고비가 두 번 빠진다.
  const netProfit = useMemo(
    () => (data ? data.totals.profit - Math.max(0, adCost - (data.totals.adCost ?? 0)) : 0),
    [data, adCost],
  );
  const netMargin = useMemo(
    () => (data && data.totals.salesAmount > 0 ? (netProfit / data.totals.salesAmount) * 100 : 0),
    [data, netProfit],
  );

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">순이익을 계산하는 중...</span>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!data) return null;

  const noSales = data.rows.length === 0;
  const prev = data.previous;

  // 광고비가 어디서 온 값인지 밝힌다. 쿠팡은 광고 API를 제공하지 않아
  // 보고서 파일에서 받은 날짜만 채워지고, 빠진 날은 순이익을 부풀린다.
  const ac = data.adCost;
  const ch = data.channels;
  // 서버가 준 순서(순이익 내림차순, 원가 미입력은 아래)를 기본으로 두고, 사용자가 고른 열이 있으면 그걸로 다시 정렬한다
  const sortedRows = sort
    ? [...data.rows].sort((a, b) => {
        const av = Number(a[sort.key] ?? 0);
        const bv = Number(b[sort.key] ?? 0);
        return sort.dir === 'asc' ? av - bv : bv - av;
      })
    : data.rows;
  const toggleSort = (key: SortKey) =>
    setSort(cur => (cur && cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  const SortTh = ({ k, label, className = 'px-3' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`${className} py-2.5 text-right font-medium`}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-0.5 hover:text-ink ${sort?.key === k ? 'text-ink' : ''}`}
        title="누르면 이 열로 정렬합니다. 다시 누르면 방향이 바뀝니다"
      >
        {label}
        <span className="text-[10px]">{sort?.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
      </button>
    </th>
  );
  // 쿠폰 열은 한 상품이라도 쿠폰 할인이 있을 때만 보인다. 없는데 '0원' 열을 두면 표만 넓어진다
  const hasCoupon = data.rows.some(r => (r.couponDiscount ?? 0) > 0);
  const adNote = (() => {
    if (!ac || ac.coveredDays === 0) {
      return '쿠팡은 광고 데이터를 API로 제공하지 않습니다. 아래 [광고센터 연결]로 가져오거나 [광고 성과 분석]에서 보고서를 올리면 이 칸이 기간에 맞춰 자동으로 채워집니다.';
    }
    const missing = ac.spanDays - ac.coveredDays;
    const est = ac.estimatedDays > 0 ? ` 이 중 ${ac.estimatedDays}일은 기간 총액을 일수로 나눈 추정치입니다.` : '';
    if (missing > 0) {
      return `광고 보고서에서 ${ac.coveredDays}일치를 자동으로 채웠습니다. ${ac.spanDays}일 중 ${missing}일은 광고비 데이터가 없어 순이익이 실제보다 크게 나옵니다.${est}`;
    }
    return `광고 보고서에서 이 기간 ${ac.coveredDays}일치를 자동으로 채웠습니다.${est}`;
  })();

  // 화면의 표를 그대로 엑셀로 내린다. 정산·세무 자료로 넘길 때
  // 화면을 다시 옮겨 적지 않게 하려는 것이다.
  const downloadExcel = () => {
    // 원가를 안 넣은 상품은 0이 아니라 빈칸으로 내린다. 0으로 내리면
    // 받아 본 사람이 "원가가 0원인 상품"으로 읽는다.
    const blank = '';
    const sheet: Record<string, string | number>[] = data.rows.map(r => ({
      상품명: r.productName,
      옵션: r.optionName,
      옵션ID: r.vendorItemId,
      판매수량: r.quantity,
      매출: Math.round(r.salesAmount),
      쿠폰할인_판매자부담: Math.round(r.couponDiscount ?? 0),
      쿠팡수수료: Math.round(r.commission),
      광고비: Math.round(r.adCost ?? 0),
      원가: r.costEntered ? Math.round(r.unitCostTotal) : blank,
      반품건수: r.returnCount,
      반품액_실판매가기준: Math.round(r.returnAmount ?? 0),
      반품비용: Math.round(r.returnCost),
      순이익: r.costEntered ? Math.round(r.profit) : blank,
      '이익률(%)': r.costEntered ? Number(r.marginRate.toFixed(1)) : blank,
      원가입력: r.costEntered ? 'O' : 'X',
    }));

    sheet.push({});
    sheet.push({
      상품명: '상품 합계',
      판매수량: data.totals.quantity,
      매출: Math.round(data.totals.salesAmount),
      쿠팡수수료: Math.round(data.totals.commission),
      원가: Math.round(data.totals.unitCostTotal),
      반품건수: data.totals.returnCount,
      반품비용: Math.round(data.totals.returnCost),
      순이익: Math.round(data.totals.profit),
      '이익률(%)': Number(data.totals.marginRate.toFixed(1)),
    });
    // 광고비는 상품별로 나눌 수 없어 합계 아래에 한 줄로만 뺀다
    sheet.push({ 상품명: '광고비', 순이익: -Math.round(adCost) });
    sheet.push({
      상품명: '광고비 차감 후 순이익',
      순이익: Math.round(netProfit),
      '이익률(%)': Number(netMargin.toFixed(1)),
    });

    const header = [
      '상품명', '옵션', '옵션ID', '판매수량', '매출', '쿠팡수수료',
      '원가', '반품건수', '반품비용', '순이익', '이익률(%)', '원가입력',
    ];
    const ws = XLSX.utils.json_to_sheet(sheet, { header });
    ws['!cols'] = [{ wch: 38 }, { wch: 20 }, { wch: 14 }, ...Array(9).fill({ wch: 12 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '상품별 순이익');
    XLSX.writeFile(wb, `훈프로_순이익_${data.from}_${data.to}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 기간 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(p => (
          <button
            key={p.days}
            onClick={() => {
              // 기간이 바뀌면 광고비도 그 기간 값으로 다시 채운다. 한 번 손댔다는
              // 이유로 90일 화면에 7일치 광고비가 남아 있으면 순이익이 틀린다.
              adTouched.current = false;
              setRange(null);
              setDays(p.days);
            }}
            className={`rounded-control border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              !range && days === p.days ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-3 hover:border-line-strong hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
        {/* 날짜 직접 고르기 — 세일 기간, 특정 주만 따로 보고 싶을 때 */}
        <div className={`flex items-center gap-1.5 rounded-control border px-2 py-1 ${range ? 'border-accent bg-accent-soft' : 'border-line'}`}>
          <input
            type="date"
            value={range?.from ?? data.from}
            max={today}
            onChange={e => pickDate('from', e.target.value)}
            aria-label="시작일"
            // 어두운 배경에서 브라우저 기본 달력 아이콘이 검게 그려져 안 보인다. 어두운 배색을 알려준다
            style={{ colorScheme: 'dark' }}
            className="bg-transparent text-[12px] tabular-nums text-ink outline-none"
          />
          <span className="text-[11px] text-ink-3">~</span>
          <input
            type="date"
            value={range?.to ?? data.to}
            max={today}
            onChange={e => pickDate('to', e.target.value)}
            aria-label="종료일"
            // 어두운 배경에서 브라우저 기본 달력 아이콘이 검게 그려져 안 보인다. 어두운 배색을 알려준다
            style={{ colorScheme: 'dark' }}
            className="bg-transparent text-[12px] tabular-nums text-ink outline-none"
          />
        </div>
        <span className="ml-auto text-[11.5px] text-ink-3">
          {data.from} ~ {data.to}
        </span>
      </div>

      {/* 원가 미입력 경고 — 이게 없으면 순이익이 부풀려 보인다 */}
      {data.missingCost > 0 && (
        <div className="flex items-start gap-2 rounded-panel border border-line bg-paper px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <div className="text-[12.5px] leading-relaxed text-ink-2">
            <p>
              팔린 상품 중 <b className="text-ink">{data.missingCost}개</b>의 원가가 비어 있습니다.
              원가가 없으면 그 상품의 순이익이 실제보다 크게 나옵니다.
            </p>
            <button onClick={onEditCosts} className="mt-1.5 inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              원가 입력하러 가기 <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 광고센터 연결 — 원가 경고 바로 아래. 둘 다 "순이익이 맞으려면 이걸 해야 한다"는
          같은 성격의 할 일이라 한 자리에 둔다. 표 아래에 두면 스크롤해야 보인다. */}
      <AdCenterConnect />

      {noSales ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <Wallet className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">이 기간의 매출 데이터가 없습니다</p>
          <p className="mt-1.5 text-center text-[12px] leading-relaxed">
            쿠팡 매출내역은 구매확정 또는 배송완료 3일 뒤에 잡힙니다.
            <br />
            최근 주문은 아직 반영되지 않았을 수 있습니다.
          </p>
        </div>
      ) : (
        <>
          {/* 핵심 지표 */}
          <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${(data.coupon?.sellerDiscount ?? 0) > 0 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
            <Stat
              label="매출"
              value={won(data.totals.salesAmount)}
              sub={`${data.totals.quantity.toLocaleString('ko-KR')}개 판매`}
              delta={delta(data.totals.salesAmount, prev?.salesAmount ?? 0, Boolean(prev?.hasData))}
            />
            {/* 판매가와 실제 판매가는 다르다 — 쿠폰만큼 덜 받는다. 대부분 알지만
                실제 얼마에 팔렸는지 확인할 방법이 없던 부분이다. */}
            {(data.coupon?.sellerDiscount ?? 0) > 0 && (
              <Stat
                label="쿠폰 할인 (판매자 부담)"
                value={`− ${won(data.coupon!.sellerDiscount)}`}
                sub={`실매출 ${won(data.totals.salesAmount - data.coupon!.sellerDiscount)} · ${couponBasisText(data.coupon!.sources)}`}
                tone="critical"
              />
            )}
            {/* 광고비를 따로 보여준다. 매출 − 광고비 − 수수료 − 원가·배송 = 순이익이
                한눈에 읽혀야 한다. 상품별 표에 붙은 몫과 합계의 차이도 여기서 밝힌다. */}
            <Stat
              label="광고비"
              value={`− ${won(adCost)}`}
              sub={
                adCost > 0 && data.totals.adCost < adCost
                  ? `상품에 붙은 ${won(data.totals.adCost)} · 나머지는 캠페인 단위`
                  : adCost > 0 ? '상품별로 붙음' : '광고비 없음'
              }
              tone="critical"
            />
            <Stat
              label="쿠팡 수수료"
              value={`− ${won(data.totals.commission)}`}
              sub={pct((data.totals.commission / Math.max(1, data.totals.salesAmount)) * 100)}
              delta={delta(data.totals.commission, prev?.commission ?? 0, Boolean(prev?.hasData), false)}
            />
            <Stat
              label="원가 + 배송"
              value={`− ${won(data.totals.unitCostTotal + data.totals.returnCost)}`}
              sub={
                data.totals.returnCount > 0
                  ? `반품 ${data.totals.returnCount}건 · 배송비만 포함 (반품액 ${won(data.totals.returnAmount)}은 매출에서 이미 제외)`
                  : '반품 0건'
              }
            />
            <Stat
              label="순이익"
              value={won(netProfit)}
              sub={pct(netMargin)}
              tone={netProfit >= 0 ? 'positive' : 'critical'}
              // 카드에 적힌 값은 광고비까지 뺀 순이익이다. 견주는 쪽도 같아야 한다.
              // 서버의 previous.profit도 광고비를 뺀 값으로 맞춰 두었다.
              delta={delta(netProfit, prev?.profit ?? 0, Boolean(prev?.hasData))}
            />
          </div>

          {/* 윙과 그로스는 회계 기준이 달라 한 줄로 합치지 않는다.
              합쳐 놓으면 확정 정산과 주문 기준 추정이 소리 없이 섞인다. */}
          {ch && (ch.marketplace.salesAmount > 0 || ch.growth.salesAmount > 0) && (
            <div className="rounded-panel border border-line bg-paper px-5 py-4">
              <h3 className="mb-2.5 text-sm font-semibold text-ink">채널별 매출</h3>
              <div className="flex flex-col gap-2">
                <ChannelRow
                  label="윙 (판매자배송·로켓배송)"
                  note="매출인식일 기준 · 정산예정액 확정"
                  amount={ch.marketplace.salesAmount}
                  quantity={ch.marketplace.quantity}
                  total={ch.marketplace.salesAmount + ch.growth.salesAmount}
                />
                <ChannelRow
                  label="로켓그로스"
                  note="결제일 기준 · 수수료는 윙 요율로 계산"
                  amount={ch.growth.salesAmount}
                  quantity={ch.growth.quantity}
                  total={ch.marketplace.salesAmount + ch.growth.salesAmount}
                  muted
                />
              </div>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
                두 채널은 쿠팡이 주는 데이터의 기준이 다릅니다. 윙은 매출이 확정된 뒤(구매확정·배송완료 +3일)
                정산예정액까지 함께 옵니다. 로켓그로스는 <b className="text-ink-2">주문만</b> 조회돼 결제일 기준이고
                수수료가 오지 않아, 같은 상품의 윙 실적에서 나온 실제 수수료율을 그대로 적용했습니다.
                입출고비는 [원가 입력]의 그로스 입출고비 칸에 넣으면 순이익에 함께 반영됩니다.
              </p>
            </div>
          )}

          {/* 쿠폰 금액이 기억과 다를 때 답이 여기 있다. 쿠폰은 기간마다 금액이 달라진다. */}
          {(data.couponList?.length ?? 0) > 0 && (
            <CouponList rows={data.couponList!} from={data.from} to={data.to} />
          )}

          {prev?.hasData && (
            <p className="-mt-1 text-[11.5px] text-ink-3">
              증감은 직전 같은 기간({prev.from} ~ {prev.to}) 대비입니다. 순이익 증감은 광고비를 빼기 전 기준입니다.
            </p>
          )}

          {/* 일별 추이 — 합계만 보면 오르는 중인지 꺾이는 중인지 알 수 없다 */}
          {data.daily && data.daily.length >= 2 && (
            <div className="rounded-panel border border-line bg-paper px-5 py-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">일별 추이</h3>
                <span className="text-[11.5px] text-ink-3">그래프에 커서를 대면 그날 숫자가 보입니다</span>
              </div>
              <DailyTrendChart days={data.daily} />
            </div>
          )}

          {/* 광고비 입력 */}
          <div className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-paper px-5 py-4">
            <label className="text-[12.5px] font-medium text-ink-2" htmlFor="adcost">
              이 기간 광고비
            </label>
            <input
              id="adcost"
              type="number"
              min={0}
              value={adCost}
              onChange={e => {
                adTouched.current = true;
                setAdCost(Math.max(0, Number(e.target.value) || 0));
              }}
              className="w-40 rounded-control border border-line bg-paper px-3 py-2 text-right text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-[12px] text-ink-3">원</span>
            <p className="w-full text-[11.5px] leading-relaxed text-ink-3 sm:w-auto sm:flex-1">
              {adNote}
            </p>
          </div>

          {/* 상품별 표 */}
          <div className="rounded-panel border border-line bg-paper">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold text-ink">상품별 순이익</h3>
              <span className="text-[11.5px] text-ink-3">순이익 높은 순 · 원가 미입력 상품은 아래</span>
              <div className="ml-auto flex items-center gap-3">
                <button
                  onClick={downloadExcel}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-2 hover:text-ink"
                >
                  <Download className="h-3.5 w-3.5" />
                  엑셀 내려받기
                </button>
                <button onClick={onEditCosts} className="text-[12px] font-medium text-accent hover:underline">
                  원가 편집
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[11.5px] text-ink-3">
                    <th className="px-4 py-2.5 text-left font-medium">상품</th>
                    <SortTh k="quantity" label="판매" />
                    <SortTh k="salesAmount" label="매출" />
                    {hasCoupon && <SortTh k="couponDiscount" label="쿠폰" />}
                    <SortTh k="commission" label="수수료" />
                    <SortTh k="adCost" label="광고비" />
                    <SortTh k="unitCostTotal" label="원가" />
                    <SortTh k="returnAmount" label="반품" />
                    <SortTh k="profit" label="순이익" />
                    <SortTh k="marginRate" label="이익률" className="px-4" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(r => (
                    <tr key={r.vendorItemId} className="border-b border-line/60 last:border-0">
                      <td className="max-w-[300px] px-4 py-2.5">
                        <p className="truncate text-ink">
                          {/* 채널 표기 — 그로스와 판매자배송은 수수료·정산 기준이 달라 한눈에 구분돼야 한다 */}
                          <span
                            className={`mr-1.5 rounded-control border px-1 py-0.5 align-middle text-[9.5px] ${
                              r.channel === 'growth' ? 'border-[#c47a2c]/50 text-[#c47a2c]' : r.channel === 'both' ? 'border-line text-ink-2' : 'border-accent/40 text-accent'
                            }`}
                          >
                            {r.channel === 'growth' ? '그로스' : r.channel === 'both' ? '윙+그로스' : '판매자배송'}
                          </span>
                          {r.productName}
                        </p>
                        {r.optionName && <p className="truncate text-[11px] text-ink-3">{r.optionName}</p>}
                        {!r.costEntered && r.quantity > 0 && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-control border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            원가 미입력
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{r.quantity.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{won(r.salesAmount)}</td>
                      {hasCoupon && (
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">
                          {r.couponDiscount > 0 ? `− ${won(r.couponDiscount)}` : '-'}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{won(r.commission)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.adCost > 0 ? won(r.adCost) : '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.costEntered ? won(r.unitCostTotal) : '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">
                        {r.returnCount > 0 ? (
                          <>
                            <span className="text-ink-2">{won(r.returnAmount)}</span>
                            <span className="block text-[10.5px]">{r.returnCount}건</span>
                          </>
                        ) : '-'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                          !r.costEntered ? 'text-ink-3' : r.profit >= 0 ? 'text-positive' : 'text-critical'
                        }`}
                      >
                        {won(r.profit)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">
                        <span className="inline-flex items-center gap-1">
                          {r.costEntered && (r.marginRate >= 0 ? (
                            <TrendingUp className="h-3 w-3 text-positive" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-critical" />
                          ))}
                          {pct(r.marginRate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 채널 한 줄 — 금액·수량과 함께 비중 막대를 보여준다 */
function ChannelRow({
  label, note, amount, quantity, total, muted,
}: {
  label: string;
  note: string;
  amount: number;
  quantity: number;
  total: number;
  muted?: boolean;
}) {
  const share = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="min-w-[168px] text-[12.5px] font-medium text-ink">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums text-ink">{won(amount)}</span>
      <span className="text-[11.5px] tabular-nums text-ink-3">
        {quantity.toLocaleString('ko-KR')}개 · {share.toFixed(0)}%
      </span>
      <span className="text-[11px] text-ink-3">{note}</span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(share, amount > 0 ? 2 : 0)}%`, background: muted ? '#c47a2c' : 'var(--color-accent)' }}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'critical';
  delta?: Delta | null;
}) {
  const toneClass = tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink';
  return (
    <div className="rounded-panel border border-line bg-paper px-4 py-4">
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className={`mt-1 text-[19px] font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        {sub && <span className="text-[11.5px] tabular-nums text-ink-3">{sub}</span>}
        {delta && (
          <span
            className={`text-[11.5px] font-semibold tabular-nums ${
              delta.good ? 'text-positive' : delta.bad ? 'text-critical' : 'text-ink-3'
            }`}
          >
            {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}
