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
      })
      .catch(e => setError(e?.message ?? '설정을 불러오지 못했습니다.'))
      .finally(() => setLoaded(true));
  }, []);

  const save = async (patch: { enabled?: boolean; leadTimeDays?: number }) => {
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
        </>
      )}

      {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}
    </div>
  );
}
