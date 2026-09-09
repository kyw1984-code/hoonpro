/**
 * 내 상품별 키워드 순위 — 상품을 먼저 놓고, 키워드는 상품에 붙여 묻는다.
 *
 * 앞서는 키워드를 먼저 받아 검색 결과에서 내 상품을 찾는 방식이었다. 그러면
 * 내 상품이 60위 밖일 때 아무것도 안 나오고, 판매자는 자기 상품을 고를 수조차
 * 없다. 판매자가 아는 건 자기 상품이다. 상품을 고르고 "이 키워드에서는 몇 위인가"를
 * 묻는 쪽이 실제 순서에 맞는다.
 *
 * 목록은 옵션이 아니라 상품 단위다. 순위는 상품에 매겨지므로 옵션 20개가 20줄로
 * 늘어서면 어느 줄의 순위를 볼지 고르는 일 자체가 어려워진다. 매출도 같은 이유로
 * 상품 단위로 합친다.
 */
import { useEffect, useState } from 'react';
import { Loader2, Package, Search } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { won } from '../../lib/coupang';

interface MyProduct {
  productId: string;
  productName: string;
  optionCount: number;
  quantity: number;
  salesAmount: number;
}

interface RankResult {
  rank: number | null;
  page: number | null;
  keyword: string;
  /** 몇 위까지 훑었는지 — 못 찾았을 때 "N위 밖"이라고 정확히 말하기 위한 값 */
  searchedTo?: number;
  /** 끝까지 못 보고 멈췄으면 그 이유 */
  stoppedBy?: 'limit' | 'error';
}

const auth = () => ({ Authorization: `Bearer ${getToken()}` });

// 상품마다 넣은 키워드와 결과를 남긴다. 다른 탭에 다녀오면 컴포넌트가 새로 그려져
// 입력이 전부 사라지는데, 상품 열 개에 키워드를 넣어 둔 사람에게는 그게 곧 처음부터
// 다시 하라는 말이다. 순위는 시간이 지나면 변하므로 확인한 시각도 함께 남긴다.
const SAVE_KEY = 'hoonpro_product_ranks';
type Saved = Record<string, {
  keyword: string;
  /** 실제로 [순위 확인]을 돌린 결과인지. 적어만 둔 키워드를 "순위 없음"으로 읽으면 안 된다 */
  checked?: boolean;
  rank?: number | null;
  page?: number | null;
  searchedTo?: number;
  stoppedBy?: 'limit' | 'error';
  at?: string;
}>;

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function saveOne(productId: string, value: Saved[string] | null) {
  try {
    const all = loadSaved();
    if (value) all[productId] = value;
    else delete all[productId];
    localStorage.setItem(SAVE_KEY, JSON.stringify(all));
  } catch {
    /* 저장이 막힌 환경 — 화면 동작은 그대로 */
  }
}

/** "3분 전"처럼. 순위는 변하므로 언제 확인한 값인지가 중요하다 */
function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}

export function MyProductRanks({ days = 30 }: { days?: number }) {
  const [products, setProducts] = useState<MyProduct[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/coupang?action=my-products&days=${days}`, { headers: auth() })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || '상품을 불러오지 못했습니다.');
        setProducts(d.products ?? []);
        setReason(d.reason ?? null);
      })
      .catch(e => setError(e?.message ?? '상품을 불러오지 못했습니다.'));
  }, [days]);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft px-5 py-4 text-[12.5px] text-ink-2">{error}</div>;
  }
  if (!products) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-line bg-paper px-5 py-4 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">내 상품을 불러오는 중...</span>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-14 text-ink-3">
        <Package className="mb-3 h-10 w-10 opacity-20" />
        <p className="text-sm font-semibold">내 상품을 아직 찾지 못했습니다</p>
        <p className="mt-1.5 text-center text-[12px] leading-relaxed">
          {reason ?? '[연동 설정]에서 쿠팡을 연결하고 수집이 끝나면 여기에 상품이 나옵니다.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-line bg-paper px-5 py-4">
      <h3 className="text-sm font-semibold text-ink">내 상품 순위 확인</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
        상품마다 키워드를 넣으면 쿠팡에서 지금 검색해 <b className="text-ink">그 상품이 몇 위·몇 페이지</b>에 있는지 알려줍니다.
        매출은 최근 {days}일이고, 옵션이 아니라 상품 단위로 합친 값입니다.
      </p>

      <div className="mt-3 flex flex-col">
        {products.map(p => (
          <ProductRow key={p.productId} product={p} days={days} />
        ))}
      </div>
    </div>
  );
}

function ProductRow({ product, days }: { product: MyProduct; days: number }) {
  // 지연 초기화 — 저장분은 마운트할 때 한 번만 읽는다. 이걸 본문에서 그냥 부르면
  // 줄마다 매 렌더링마다 localStorage를 파싱하게 된다.
  const [saved] = useState(() => loadSaved()[product.productId]);
  const [keyword, setKeyword] = useState(saved?.keyword ?? '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RankResult | null>(
    saved?.checked
      ? {
          rank: saved.rank ?? null, page: saved.page ?? null, keyword: saved.keyword,
          searchedTo: saved.searchedTo, stoppedBy: saved.stoppedBy,
        }
      : null,
  );
  const [checkedAt, setCheckedAt] = useState<string | null>(saved?.checked ? saved.at ?? null : null);
  const [error, setError] = useState<string | null>(null);

  // 눌러 보지 않고 적어만 둔 키워드도 남긴다. 대표님이 겪은 건 "확인을 안 누르고
  // 다른 탭에 갔다 오니 비어 있더라"이므로, 결과가 있을 때만 저장하면 절반만 고친 게 된다.
  // 다만 키워드를 바꿔 적었다면 화면의 순위는 옛 키워드 것이니 함께 남기지 않는다.
  const rememberKeyword = () => {
    const kw = keyword.trim();
    if (!kw) return saveOne(product.productId, null);
    // 키워드를 바꿔 적었다면 화면의 순위는 옛 키워드 것이므로 함께 남기지 않는다
    if (result && result.keyword === kw) {
      saveOne(product.productId, {
        keyword: kw, checked: true, rank: result.rank, page: result.page,
        searchedTo: result.searchedTo, stoppedBy: result.stoppedBy, at: checkedAt ?? undefined,
      });
    } else {
      saveOne(product.productId, { keyword: kw });
    }
  };

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = keyword.trim();
    if (!kw || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    // 확인 시각도 함께 지운다. 결과만 지우면 오류 옆에 옛 "3분 전"이 남는다
    setCheckedAt(null);
    try {
      const res = await fetch(
        `/api/sourcing?type=rankwatch&action=check&keyword=${encodeURIComponent(kw)}&product=${encodeURIComponent(product.productId)}`,
        { headers: auth() },
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || '순위를 확인하지 못했습니다.');
      const next: RankResult = {
        rank: d.currentRank ?? null, page: d.page ?? null, keyword: kw,
        searchedTo: d.searchedTo, stoppedBy: d.stoppedBy,
      };
      const at = new Date().toISOString();
      setResult(next);
      setCheckedAt(at);
      saveOne(product.productId, {
        keyword: kw, checked: true, rank: next.rank, page: next.page,
        searchedTo: next.searchedTo, stoppedBy: next.stoppedBy, at,
      });
    } catch (err: any) {
      setError(err?.message ?? '순위를 확인하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-line/60 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={product.productName}>
          {product.productName}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-2">
          {product.salesAmount > 0 ? won(product.salesAmount) : '판매 없음'}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-3">
        {product.quantity > 0 && `${product.quantity.toLocaleString('ko-KR')}개 · `}
        옵션 {product.optionCount}개 · 최근 {days}일
      </p>

      <form onSubmit={check} className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onBlur={rememberKeyword}
          placeholder="키워드"
          className="min-w-0 flex-1 rounded-control border border-line bg-paper-2 px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !keyword.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-ink disabled:opacity-45"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          순위 확인
        </button>

        {result && (
          result.rank === null ? (
            <span className="text-[12px] text-ink-3">
              {/* 한도에 걸려 멈춘 걸 "순위 밖"이라고 하면 거짓말이 된다 */}
              {result.stoppedBy
                ? `"${result.keyword}" ${result.searchedTo ?? 0}위까지는 없었습니다 (${
                    result.stoppedBy === 'limit' ? '오늘 순위 확인 한도에 걸려 여기까지' : '수집이 끊겨 여기까지'
                  })`
                : `"${result.keyword}" ${result.searchedTo ? `${result.searchedTo}위 밖` : '순위 없음'}`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="rounded-control bg-accent-soft px-2 py-0.5 text-[12.5px] font-semibold tabular-nums text-accent">
                {result.rank}위
              </span>
              {result.page !== null && (
                <span className="rounded-control border border-line px-2 py-0.5 text-[12px] tabular-nums text-ink-2">
                  {result.page}페이지
                </span>
              )}
            </span>
          )
        )}
        {checkedAt && !loading && <span className="text-[11px] text-ink-3">{ago(checkedAt)}</span>}
        {error && <span className="text-[11.5px] text-critical">{error}</span>}
      </form>
    </div>
  );
}
