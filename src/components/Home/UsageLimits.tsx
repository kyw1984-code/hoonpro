import { useEffect, useState } from 'react';
import { Gauge, Loader2, RotateCcw } from 'lucide-react';
import { getToken } from '../../lib/auth';

/**
 * 오늘 남은 사용량 — 기능별 일일 한도와 잔여 횟수, 초기화 시각을 보여준다.
 * 한도는 관리자 화면(app_config.feature_limits)에서 조정하고, 매일 0시(KST)에 초기화된다.
 */

const LABEL: Record<string, { name: string; hint: string }> = {
  image:    { name: '이미지 생성',      hint: '썸네일·상세페이지 이미지 1장당 1회' },
  qa:       { name: '훈프로 코칭AI',    hint: '질문 1건당 1회' },
  sourcing: { name: '소싱AI 상품 수집', hint: '키워드 수집 1회당 1회' },
  reviews:  { name: '리뷰 수집·요약',   hint: '상품 1개당 1회' },
  rank:     { name: '순위 확인',        hint: '조회 1회당 1회' },
  analyze:  { name: '경쟁상품 분석',    hint: '분석 1회당 1회' },
  general:  { name: '기타 AI 작업',     hint: '기획안·문구 생성, 이미지 검수 등' },
};

const ORDER = ['image', 'qa', 'sourcing', 'reviews', 'rank', 'analyze', 'general'];

interface FeatureLimit {
  feature: string;
  limit: number;
  used: number;
  remaining: number; // -1 = 무제한
}

/** 초기화까지 남은 시간 — "6시간 20분 후" */
function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '곧';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}시간 ${m}분 후` : `${m}분 후`;
}

export function UsageLimits() {
  const [data, setData] = useState<{ resetAt: string; unlimited: boolean; features: FeatureLimit[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        const res = await fetch('/api/usage?action=limits', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('failed');
        setData(await res.json());
      } catch {
        setFailed(true); // 사용량 조회 실패가 대시보드를 막지 않게 한다
      }
    })();

    const onUsed = () => {
      // 기능을 쓴 직후 잔여 횟수를 다시 읽는다 (usage-updated는 track 성공 시 발생)
      setData(null);
      setFailed(false);
      (async () => {
        try {
          const token = getToken();
          const res = await fetch('/api/usage?action=limits', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) setData(await res.json());
        } catch { /* 무시 */ }
      })();
    };
    window.addEventListener('usage-updated', onUsed);
    return () => window.removeEventListener('usage-updated', onUsed);
  }, []);

  if (failed) return null;

  const rows = (data?.features ?? [])
    .filter(f => LABEL[f.feature])
    .sort((a, b) => ORDER.indexOf(a.feature) - ORDER.indexOf(b.feature));

  return (
    <div className="rounded-panel border border-line bg-paper p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Gauge className="h-4 w-4" style={{ color: '#22a3b8' }} />
        <h3 className="text-sm font-semibold text-ink">오늘 남은 사용량</h3>
        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-ink-3">
          <RotateCcw className="h-3 w-3" />
          매일 0시 초기화
          {data && <span className="tabular-nums">· {untilLabel(data.resetAt)}</span>}
        </span>
      </div>

      {!data ? (
        <div className="flex items-center gap-2 py-6 text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-[12px]">불러오는 중...</span>
        </div>
      ) : data.unlimited ? (
        <p className="py-4 text-[13px] text-ink-2">관리자 계정은 사용 한도가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map(f => {
            const meta = LABEL[f.feature];
            const unlimited = f.remaining < 0;
            const pct = unlimited || f.limit <= 0 ? 0 : Math.min(100, Math.round((f.used / f.limit) * 100));
            const low = !unlimited && f.limit > 0 && f.remaining <= Math.max(1, Math.round(f.limit * 0.1));
            return (
              <li key={f.feature}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-ink">{meta.name}</span>
                  <span className="text-[11.5px] text-ink-3">{meta.hint}</span>
                  <span className="ml-auto text-[12.5px] font-semibold tabular-nums" style={{ color: unlimited ? '#8b7bff' : low ? '#ffb454' : '#22a3b8' }}>
                    {unlimited ? '무제한' : `${f.remaining}회 남음`}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${unlimited ? 0 : pct}%`, background: low ? '#ffb454' : '#22a3b8' }}
                    />
                  </div>
                  <span className="w-[74px] shrink-0 text-right text-[11px] tabular-nums text-ink-3">
                    {unlimited ? '한도 없음' : `${f.used} / ${f.limit}회`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
