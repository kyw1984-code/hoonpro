/**
 * 윙 판매 데이터 북마클릿이 연 창.
 *
 * 북마클릿(윙 안에서 실행)에게 "조회할 상품 목록"을 건네고, 돌아온 조회수·판매량을
 * 판매자 본인의 훈프로 세션으로 저장한다. 보내는 쪽이 윙이 아니면 받지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { WING_MAX_ITEMS, WING_ORIGIN, WING_WANTED_KEY, type WingStatRow, type WingWanted } from '../../lib/wingStats';

type Phase = { kind: 'waiting'; count: number } | { kind: 'saving' } | { kind: 'done'; saved: number; partial: boolean } | { kind: 'error'; message: string };

export function WingStatsReceiver() {
  const wanted = useRef<{ keyword?: string; items: WingWanted[] }>({ items: [] });
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting', count: 0 });

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(WING_WANTED_KEY) || '{}');
      wanted.current = { keyword: raw.keyword, items: Array.isArray(raw.items) ? raw.items.slice(0, WING_MAX_ITEMS) : [] };
    } catch { /* 비어 있으면 북마클릿이 안내한다 */ }
    setPhase({ kind: 'waiting', count: wanted.current.items.length });

    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== WING_ORIGIN || !ev.data) return;
      const src = ev.source as Window | null;
      if (ev.data.type === 'hoonpro-wing-hello') {
        src?.postMessage({ type: 'hoonpro-wing-wanted', items: wanted.current.items }, WING_ORIGIN);
      } else if (ev.data.type === 'hoonpro-wing-error') {
        setPhase(p => (p.kind === 'done' ? p : { kind: 'error', message: String(ev.data.message || '알 수 없는 오류') }));
      } else if (ev.data.type === 'hoonpro-wing-stats') {
        const rows: WingStatRow[] = Array.isArray(ev.data.rows) ? ev.data.rows : [];
        setPhase({ kind: 'saving' });
        try {
          const res = await fetch('/api/coupang?action=wing-stats-save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify({ rows }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d?.error || '저장에 실패했습니다.');
          // 원래 창(소싱AI)이 알아채고 다시 불러오게 한다
          try { localStorage.setItem('hoonpro_wing_saved_at', String(Date.now())); } catch { /* 무시 */ }
          setPhase({ kind: 'done', saved: d.saved ?? rows.length, partial: ev.data.partial === true });
        } catch (e: any) {
          setPhase({ kind: 'error', message: e?.message || '저장에 실패했습니다.' });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md rounded-panel border border-line bg-paper-2 p-6 text-center">
        <h1 className="text-[16px] font-semibold text-ink">윙 판매 데이터 가져오기</h1>
        {phase.kind === 'waiting' && (
          <>
            <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-accent" />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
              {phase.count > 0
                ? <>윙에서 상품 {phase.count}개의 최근 28일 조회수·판매량을 읽는 중입니다. 1~2분 걸립니다. 이 창과 윙 창을 닫지 마세요.</>
                : <>조회할 상품이 없습니다. 소싱AI에서 키워드를 분석한 뒤 [윙 판매 데이터 가져오기]를 누르고 다시 시도해 주세요.</>}
            </p>
          </>
        )}
        {phase.kind === 'saving' && <><Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-accent" /><p className="mt-3 text-[13px] text-ink-2">저장하는 중...</p></>}
        {phase.kind === 'done' && (
          <>
            <CheckCircle2 className="mx-auto mt-4 h-7 w-7 text-positive" />
            <p className="mt-3 text-[13px] leading-relaxed text-ink">
              {phase.saved}개 상품의 판매 데이터를 저장했습니다{phase.partial ? ' (윙이 중간에 거절해 일부만)' : ''}.
              소싱AI 창으로 돌아가면 상품 카드에 표시됩니다. 이 창은 닫아도 됩니다.
            </p>
          </>
        )}
        {phase.kind === 'error' && <><XCircle className="mx-auto mt-4 h-7 w-7 text-critical" /><p className="mt-3 text-[13px] leading-relaxed text-critical">{phase.message}</p></>}
      </div>
    </div>
  );
}
