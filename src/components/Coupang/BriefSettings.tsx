/**
 * 아침 브리핑 설정 — 수신 여부와 발주 리드타임.
 *
 * 매일 오는 메일은 끌 수 있어야 한다. 끄는 방법이 없으면 결국 스팸으로
 * 분류되고, 그러면 결제 실패나 수집 중단 메일까지 같이 안 보이게 된다.
 *
 * 리드타임은 사람마다 다르다(국내 3일, 중국 30일). 이 값이 틀리면 발주 알림이
 * 늘 이르거나 늘 늦어서 아무도 안 보게 된다. 알림의 정확도가 여기에 달려 있다.
 */
import { useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { getToken } from '../../lib/auth';

const auth = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

export function BriefSettings({ showToast }: { showToast?: (msg: string) => void }) {
  const [enabled, setEnabled] = useState(true);
  const [leadTime, setLeadTime] = useState('14');
  const [minSales, setMinSales] = useState('3');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/coupang?action=brief-settings', { headers: auth() })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || '설정을 불러오지 못했습니다.');
        setEnabled(d.enabled !== false);
        setLeadTime(String(d.leadTimeDays ?? 14));
        setMinSales(String(d.minSales14 ?? 3));
      })
      .catch(e => setError(e?.message ?? '설정을 불러오지 못했습니다.'))
      .finally(() => setLoaded(true));
  }, []);

  const save = async (patch: { enabled?: boolean; leadTimeDays?: number; minSales14?: number }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/coupang?action=brief-settings', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || '저장하지 못했습니다.');
      showToast?.('저장했습니다.');
    } catch (e: any) {
      setError(e?.message ?? '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (next: boolean) => {
    setEnabled(next);
    void save({ enabled: next });
  };

  // 입력 중간값(빈칸, '0')으로 저장하지 않도록 포커스를 벗어날 때 한 번만 보낸다
  const commitLeadTime = () => {
    const n = Math.min(120, Math.max(1, Number(leadTime) || 14));
    setLeadTime(String(n));
    void save({ leadTimeDays: n });
  };

  // 여기서는 0이 '자동 판단 끔'이라 뜻이 있는 값이다. 빈칸만 기본값으로 되돌린다.
  const commitMinSales = () => {
    const n = minSales.trim() === '' ? 3 : Math.min(999, Math.max(0, Number(minSales) || 0));
    setMinSales(String(n));
    void save({ minSales14: n });
  };

  return (
    <div className="rounded-panel border border-line bg-paper p-6">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Mail className="h-4 w-4 text-ink-3" /> 아침 브리핑
      </h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
        매일 아침 7시에 어제 주문, 지금 발주해야 할 재고, 새 문의를 한 통으로 보내 드립니다.
        팔린 것도 없고 발주할 것도 없는 날은 보내지 않습니다.
      </p>

      {!loaded ? (
        <div className="mt-3 flex items-center gap-2 text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-[12.5px]">불러오는 중...</span>
        </div>
      ) : (
        <>
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={e => toggle(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-[13px] text-ink">브리핑 메일 받기</span>
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-ink-2">발주 리드타임</span>
            <input
              value={leadTime}
              onChange={e => setLeadTime(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitLeadTime}
              inputMode="numeric"
              className="w-20 min-h-[40px] rounded-control border border-line bg-paper-2 px-2.5 text-right text-[13px] tabular-nums text-ink focus:border-accent focus:outline-none"
            />
            <span className="text-[12.5px] text-ink-2">일</span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
            발주해서 입고되기까지 걸리는 날입니다. 남은 재고가 이 일수보다 적어지면 알려 드립니다.
            국내 사입이면 3~7일, 중국 소싱이면 25~40일이 보통입니다.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-ink-2">시즌 지난 상품 빼기</span>
            <span className="text-[12.5px] text-ink-3">최근 14일 판매</span>
            <input
              value={minSales}
              onChange={e => setMinSales(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitMinSales}
              inputMode="numeric"
              className="w-20 min-h-[40px] rounded-control border border-line bg-paper-2 px-2.5 text-right text-[13px] tabular-nums text-ink focus:border-accent focus:outline-none"
            />
            <span className="text-[12.5px] text-ink-2">개 미만이면 제외</span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
            여름 나시티가 9월에 품절인 건 사고가 아니라 계절입니다. 최근에 팔리지 않는 상품은
            품절이어도 발주 알림에서 뺍니다. <b className="text-ink-2">0을 넣으면 이 판단을 끄고</b> 전부 알립니다.
            개별 상품은 [재고 예측]에서 직접 고정할 수 있습니다 — 곧 시즌이 오는 겨울 상품처럼
            자동 판단이 알 수 없는 경우에 씁니다.
          </p>
        </>
      )}

      {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}
    </div>
  );
}
