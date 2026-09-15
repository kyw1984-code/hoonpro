/**
 * 정산서 대조 — 우리가 계산한 정산예정액이 쿠팡이 잡은 금액과 맞는지 본다.
 *
 * 자료를 파 보고 전제가 하나 바뀌었다. 쿠팡 지급내역 API에는 판매자배송(윙)만
 * 들어온다 — 로켓그로스는 한 건도 없다. 그로스 매출이 477만 원인 달의 지급내역
 * 총매출이 112만 원이고, 그 112만은 같은 달 윙 매출과 맞는다.
 *
 * 그래서 화면이 하는 일이 둘로 갈린다.
 *   - 자동: 윙끼리 견준다. 어긋나면 매출 수집이 빠진 것이다.
 *   - 수동: 판매자가 쿠팡 정산서 금액을 적어 넣으면 윙+그로스 전체로 견준다.
 *     그로스 수수료율이 맞는지 확인할 수 있는 길은 지금 이것뿐이라,
 *     그로스 매출이 있는 달에는 적어 달라고 화면에서 먼저 청한다.
 *
 * 차이를 곧바로 '오류'라고 부르지 않는다. 반품 차감·판매장려금·지급 지연이
 * 섞여 있어서다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Scale, TriangleAlert } from 'lucide-react';
import { coupangApi, won, type SettlementCheckRow } from '../../lib/coupang';

const VERDICT = {
  ok:      { label: '맞습니다',    cls: 'border-positive/35 bg-positive-soft text-positive' },
  watch:   { label: '한 번 보세요', cls: 'border-caution/40 bg-caution-soft text-caution' },
  off:     { label: '어긋났습니다', cls: 'border-critical/35 bg-critical-soft text-critical' },
  pending: { label: '집계 중',     cls: 'border-line bg-paper-2 text-ink-2' },
  unknown: { label: '기준 없음',   cls: 'border-line bg-paper-2 text-ink-3' },
} as const;

function monthLabel(m: string) {
  return `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
}

export function SettlementCheck({ feeRateHint }: { feeRateHint?: number }) {
  const [rows, setRows] = useState<SettlementCheckRow[] | null>(null);
  const [feeRate, setFeeRate] = useState(feeRateHint ?? 11.88);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await coupangApi.settlementCheck(6);
      setRows(d.rows);
      setFeeRate(d.feeRate);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '불러오지 못했습니다.');
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (month: string) => {
    // 쉼표를 찍어 넣는 사람이 많다. 숫자만 남긴다.
    const amount = Number(draft.replace(/[^0-9]/g, '')) || 0;
    setSaving(true);
    try {
      await coupangApi.settlementCheckSave(month, amount);
      setEditing(null);
      setDraft('');
      await load();
    } catch (e: any) {
      setError(e?.message ?? '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (error && rows === null) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (rows === null) {
    return (
      <div className="flex items-center gap-2 py-10 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">정산 대조를 준비하는 중...</span>
      </div>
    );
  }

  const off = rows.filter(r => r.verdict === 'off');
  const pending = rows.filter(r => r.verdict === 'pending');
  // 그로스 매출이 있는데 정산서 금액을 안 적은 달 — 그로스가 대조 밖에 있다.
  const growthUnchecked = rows.filter(r => r.growthSettlement > 0 && r.scope !== 'all');
  const offWithRate = off.find(r => r.impliedGrowthFeeRate !== null);

  return (
    <div className="rounded-panel border border-line bg-paper p-5">
      <div className="mb-1 flex items-center gap-2">
        <Scale className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold text-ink">정산서 대조</h3>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        우리가 계산한 정산예정액과 쿠팡이 잡은 <b>정산대상액</b>(수수료 뺀 금액)을 매출인식월끼리 맞춰 봅니다.
        쿠팡 지급내역 API에는 <b>판매자배송(윙)만</b> 들어오므로 자동 대조는 윙끼리 합니다.
        <b> 로켓그로스</b>는 정산서 금액을 적어 주셔야 견줄 수 있습니다.
      </p>
      {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}

      {growthUnchecked.length > 0 && (
        <p className="mt-3 rounded-card border border-accent-line bg-accent-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <b>로켓그로스는 아직 대조되지 않았습니다.</b> 쿠팡이 그로스 정산액을 API로 주지 않아
          우리가 계산해 쓰고 있습니다 — 이 계산이 틀리면 순이익이 조용히 부풀고 몇 달 뒤 통장을 보고서야 압니다.
          {' '}쿠팡 정산서의 <b>윙+그로스 합계</b>를 [정산서 입력]에 적어 주시면 그 달은 전체로 견주고,
          어긋나면 그로스 수수료율을 몇 %로 봐야 맞는지 역산해 드립니다.
          {' '}(해당 달: {growthUnchecked.map(r => monthLabel(r.month)).join(', ')})
        </p>
      )}

      {off.length === 0 && pending.length > 0 && (
        <p className="mt-3 rounded-card border border-line bg-paper-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          {pending.map(r => monthLabel(r.month)).join(', ')}은 아직 집계 중입니다 —
          쿠팡이 그 달 매출 인식을 안 끝냈거나, 그 달 윙 매출 자료를 우리가 온전히 갖고 있지 않습니다.
          어긋난 것이 아닙니다.
        </p>
      )}

      {off.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[12.5px] text-critical">
          <TriangleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0" />
          <span>
            {off.map(r => monthLabel(r.month)).join(', ')}이 5% 넘게 어긋났습니다.
            {offWithRate
              ? <> 그로스 수수료율을 {feeRate}% 대신 <b>{offWithRate.impliedGrowthFeeRate}%</b>로 봐야 맞는 금액입니다.</>
              : <> 윙끼리 견준 값이라 그로스 수수료와는 무관합니다 — 그 달 윙 매출 수집이 빠졌는지 보세요.</>}
          </span>
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-line">
            <tr>
              {['매출인식월', '우리 계산', '쿠팡 정산대상액', '차이', '역산 수수료율', ''].map((h, i) => (
                <th key={h || i}
                  className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-2 ${i === 0 || i === 5 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(r => {
              const v = VERDICT[r.verdict];
              return (
                <tr key={r.month} className="transition-colors hover:bg-paper-2">
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="text-[13px] text-ink">{monthLabel(r.month)}</span>
                    <span className={`ml-2 inline-block rounded-control border px-1.5 py-[1px] text-[10.5px] font-semibold ${v.cls}`}>
                      {v.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    <span className="text-[13px] text-ink">{won(r.ours)}</span>
                    {/* 무엇이 들어간 금액인지 반드시 밝힌다. 윙만 견준 달에
                        윙+그로스 합계를 적어 두면 표를 읽는 사람이 차이를
                        그로스 탓으로 잘못 돌린다. */}
                    <span className="mt-0.5 block text-[11px] text-ink-3">
                      {r.scope === 'all'
                        ? <>윙 {won(r.marketSettlement)} · 그로스 {won(r.growthSettlement)}</>
                        : <>윙만{r.growthSettlement > 0 && <> · 그로스 {won(r.growthSettlement)}은 대조 밖</>}</>}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {editing === r.month ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          autoFocus
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void save(r.month); if (e.key === 'Escape') setEditing(null); }}
                          placeholder="윙+그로스 합계"
                          className="w-32 rounded-control border border-accent-line bg-paper px-2 py-1 text-right text-[12.5px] text-ink outline-none"
                        />
                        <button onClick={() => void save(r.month)} disabled={saving}
                          className="rounded-control border border-line p-1 text-ink-2 hover:text-accent disabled:opacity-50">
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                      </span>
                    ) : r.reference === null ? (
                      <span className="text-[12.5px] text-ink-3">—</span>
                    ) : (
                      <>
                        <span className="text-[13px] text-ink">{won(r.reference)}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-3">
                          {r.referenceSource === 'actual' ? '정산서 입력값 (윙+그로스)' : '쿠팡 지급내역 (윙)'}
                          {r.pendingLast > 0 && (
                            <span className="mt-0.5 block text-[10.5px] text-caution">
                              최종액 {won(r.pendingLast)} 미도래
                            </span>
                          )}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {r.diff === null ? (
                      <span className="text-[12.5px] text-ink-3">—</span>
                    ) : (
                      <>
                        <span className={`text-[13px] font-semibold ${r.verdict === 'ok' ? 'text-ink' : r.verdict === 'off' ? 'text-critical' : 'text-caution'}`}>
                          {r.diff > 0 ? '+' : ''}{won(r.diff)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-3">
                          {r.diffRate === null ? '판정 보류' : `${r.diffRate}%`}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {r.impliedGrowthFeeRate === null ? (
                      <span className="text-[12px] text-ink-3">—</span>
                    ) : (
                      <span className={`text-[13px] ${Math.abs(r.impliedGrowthFeeRate - feeRate) > 1 ? 'font-semibold text-caution' : 'text-ink-2'}`}>
                        {r.impliedGrowthFeeRate}%
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <button
                      onClick={() => {
                        setEditing(r.month);
                        setDraft(r.actual ? String(r.actual) : '');
                      }}
                      className="inline-flex items-center gap-1 rounded-control border border-line px-2 py-1 text-[11.5px] text-ink-2 hover:border-accent-line hover:text-accent"
                    >
                      <Pencil className="h-3 w-3" />
                      {r.actual ? '수정' : '정산서 입력'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-ink-3">
        <p>
          <b>쿠팡 지급내역에는 로켓그로스가 없습니다.</b> 판매자배송(윙) 정산만 내려옵니다.
          그래서 자동 대조는 윙끼리만 하고, 그로스 금액은 '대조 밖'으로 적어 둡니다.
          [정산서 입력]에 쿠팡 정산서의 <b>윙+그로스 합계</b>를 적으시면 그 달은 전체로 견줍니다 —
          적어 둔 값이 지급내역보다 우선합니다. 0을 넣으면 지워집니다.
        </p>
        <p>
          <b>쿠팡 주정산은 두 번에 나눠 들어옵니다.</b> 한 주(월~일) 구매확정 매출에서 판매수수료를 뺀 것이
          <b>정산대상액</b>이고, 그 <b>70%</b>가 일요일 기준 15영업일 뒤에 먼저 들어옵니다.
          나머지 <b>30%(최종액)</b>는 환불·교환에 대비해 쿠팡이 들고 있다가 <b>익익월 1일</b>에 줍니다.
          (월정산은 최종액 없이 100% 한 번에 들어옵니다.)
          그래서 이 표는 통장에 들어온 돈이 아니라 <b>정산대상액</b>과 견줍니다 — 들어온 돈과 견주면 매달 30%씩
          어긋난 것처럼 보입니다.
        </p>
        <p>
          <b>집계 중</b>은 아직 견줄 때가 아니라는 뜻입니다. 쿠팡이 그 달 매출 인식을 안 끝냈거나,
          그 달 윙 매출 자료를 우리가 온전히 갖고 있지 않은 경우입니다. 말일에 팔린 것이 다음 달에
          구매확정되면 다음 달 매출로 잡히므로, 달이 지났다고 바로 끝나는 것이 아닙니다.
          정산서 금액을 직접 적어 넣으시면 그 달은 바로 판정합니다.
        </p>
        <p>
          <b>역산 수수료율</b>은 차이를 전부 로켓그로스 수수료 탓으로 돌렸을 때 나오는 값입니다.
          지금 쓰는 값은 {feeRate}%(부가세 포함)입니다. 그로스가 대조에 들어간 달 —
          즉 정산서 금액을 적어 넣은 달에만 나옵니다. 반품 차감이나 지급 지연이 섞이면 이 값이 부풀어
          보이므로, 여러 달이 같은 방향으로 어긋날 때만 요율을 의심하세요.
        </p>
        <p>이번 달은 지급이 끝나지 않아 늘 어긋나 보이므로 지난달까지만 보여 줍니다.</p>
      </div>
    </div>
  );
}
