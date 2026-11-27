/**
 * 카테고리별 자연·광고 판매 비중 (추정).
 *
 * 한 키워드의 비중은 그 검색 결과만 본 것이다. 여기는 판매자들이 가져온 윙 판매
 * 데이터를 카테고리로 묶어, 어느 카테고리가 광고 없이도 팔리는지 견준다.
 * 상품의 광고 판매 수량은 알 수 없으므로 검색 노출 자리로 가른 추정이다.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { SALES_TYPE, type SalesType } from '../../lib/salesType';

interface MixRow { category: string; type: SalesType; n: number; sales: number }
interface Group { name: string; n: number; sales: number; byN: Record<SalesType, number>; bySales: Record<SalesType, number> }

const TYPES: SalesType[] = ['organic', 'mixed', 'ad'];
const DEPTHS = [{ d: 1, label: '대분류' }, { d: 2, label: '중분류' }, { d: 3, label: '소분류' }, { d: 99, label: '세부 전체' }];
/** 이보다 표본이 적은 카테고리는 비중이 우연에 흔들린다 — 흐리게 보여준다 */
const MIN_SAMPLE = 5;

const splitPath = (c: string) => c.split(/\s*(?:>|›|»|\/(?=\s)|\|)\s*/).map(s => s.trim()).filter(Boolean);

export function CategoryMix({ current, refreshKey }: { current: string[]; refreshKey?: number }) {
  const [rows, setRows] = useState<MixRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [depth, setDepth] = useState(2);

  useEffect(() => {
    let alive = true;
    fetch('/api/coupang?action=wing-category-mix', { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && Array.isArray(d?.rows)) setRows(d.rows); })
      .catch(() => { /* 없으면 안 보인다 */ });
    return () => { alive = false; };
  }, [refreshKey]);

  const key = (c: string) => splitPath(c).slice(0, depth).join(' > ');
  const currentKeys = useMemo(() => new Set(current.map(key)), [current, depth]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of rows ?? []) {
      if (!TYPES.includes(r.type)) continue;
      const name = key(r.category);
      if (!name) continue;
      const g = m.get(name) ?? { name, n: 0, sales: 0, byN: { organic: 0, mixed: 0, ad: 0 }, bySales: { organic: 0, mixed: 0, ad: 0 } };
      g.n += r.n; g.sales += r.sales; g.byN[r.type] += r.n; g.bySales[r.type] += r.sales;
      m.set(name, g);
    }
    // 지금 보고 있는 상품의 카테고리를 맨 위로, 그다음은 표본이 많은 순
    return [...m.values()].sort((a, b) => Number(currentKeys.has(b.name)) - Number(currentKeys.has(a.name)) || b.n - a.n);
  }, [rows, depth, currentKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows) return null;
  const total = rows.reduce((a, r) => a + r.n, 0);

  return (
    <div className="mb-4 rounded-card border border-line bg-paper">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Layers className="h-4 w-4 shrink-0 text-accent" />
        <span className="text-[13px] font-semibold text-ink">카테고리별 자연 · 광고 판매 비중 <span className="font-normal text-ink-3">(추정)</span></span>
        <span className="ml-auto whitespace-nowrap text-[11.5px] text-ink-3">{total > 0 ? `상품 ${total.toLocaleString()}개 기준` : '데이터 모으는 중'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {groups.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              아직 카테고리가 확인된 상품이 없습니다. 아래 <b>윙에서 바로 가져오기</b>로 판매 데이터를 가져오면 그 상품의 카테고리가 함께 저장되고, 여기에 카테고리별 비중이 쌓입니다.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {DEPTHS.map(o => (
                  <button key={o.d} onClick={() => setDepth(o.d)}
                    className={`rounded-full px-3 py-1 text-[11.5px] font-semibold ${depth === o.d ? 'bg-ink text-paper' : 'border border-line text-ink-2 hover:text-ink'}`}>
                    {o.label}
                  </button>
                ))}
                <span className="ml-auto flex flex-wrap items-center gap-2.5 text-[11px] text-ink-2">
                  {TYPES.map(t => (
                    <span key={t} className="inline-flex items-center gap-1"><i className={`inline-block h-2 w-2 rounded-full ${SALES_TYPE[t].bar}`} />{SALES_TYPE[t].label}</span>
                  ))}
                </span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead className="text-[11px] text-ink-3">
                    <tr>
                      <th className="py-1.5 pr-3 text-left font-semibold">카테고리</th>
                      <th className="w-[38%] px-2 py-1.5 text-left font-semibold">비중</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">자연</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">광고 의존</th>
                      <th className="whitespace-nowrap py-1.5 pl-2 text-right font-semibold">상품 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(g => {
                      // 판매량이 있으면 판매량으로, 없으면 상품 수로 나눈다
                      const bySales = g.sales > 0;
                      const src = bySales ? g.bySales : g.byN, sum = bySales ? g.sales : g.n;
                      const pct = (t: SalesType) => Math.round((src[t] / sum) * 100);
                      const thin = g.n < MIN_SAMPLE;
                      return (
                        <tr key={g.name} className={`border-t border-line ${thin ? 'opacity-55' : ''}`}>
                          <td className="py-2 pr-3 text-ink">
                            {g.name}
                            {currentKeys.has(g.name) && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">지금 보는 상품</span>}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line" title={bySales ? '판매량 기준' : '상품 수 기준'}>
                              {TYPES.map(t => <div key={t} style={{ width: `${(src[t] / sum) * 100}%` }} className={`h-full ${SALES_TYPE[t].bar}`} />)}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-positive">{pct('organic')}%</td>
                          <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-critical">{pct('ad')}%</td>
                          <td className="whitespace-nowrap py-2 pl-2 text-right tabular-nums text-ink-2">{g.n.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
                검색에서 광고 자리로 나왔는지와 자연 순위로 가른 추정치입니다. 실제 광고 판매 수량이 아닙니다. 상품 {MIN_SAMPLE}개 미만인 카테고리는 흐리게 표시합니다. 판매 데이터를 가져올수록 정확해집니다.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
