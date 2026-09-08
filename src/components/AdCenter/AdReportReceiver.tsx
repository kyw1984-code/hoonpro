/**
 * 광고센터 북마클릿이 보내는 보고서를 받는 창.
 *
 * 북마클릿은 광고센터 안에서 돌면서 이 창을 window.open으로 열고, 보고서 파일을
 * postMessage로 넘긴다. 여기서 파일을 읽어 날짜별 광고비를 뽑고, 판매자 본인의
 * 훈프로 세션으로 저장한다. 그래서 별도 토큰도, 서버에 보관하는 세션도 없다.
 *
 * 보내는 쪽 origin이 광고센터가 아니면 받지 않는다. 아무 사이트나 이 창에
 * 메시지를 던져 남의 광고비를 덮어쓸 수 있으면 안 된다.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Megaphone, XCircle } from 'lucide-react';
import { AD_CENTER_ORIGIN, ymdToIso } from '../../lib/adCollector';
import { parseAdReportBuffer } from '../../lib/adReport';
import { extractDailyAdCost } from '../../lib/adcost';
import { coupangApi, won } from '../../lib/coupang';

type Phase =
  | { kind: 'waiting' }
  | { kind: 'saving' }
  | { kind: 'done'; days: number; total: number; from: string; to: string }
  | { kind: 'error'; message: string };

export function AdReportReceiver() {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const busy = useRef(false);

  useEffect(() => {
    const opener = window.opener as Window | null;

    // 북마클릿에 "받을 준비 됐다"고 알린다. 북마클릿이 아직 듣기 전일 수 있어
    // 보고서가 올 때까지 2초마다 다시 보낸다.
    const ping = () => {
      try {
        opener?.postMessage({ type: 'hoonpro-ad-ready' }, AD_CENTER_ORIGIN);
      } catch {
        /* opener가 없거나 닫혔으면 보낼 곳이 없다 */
      }
    };
    ping();
    const timer = setInterval(ping, 2000);

    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== AD_CENTER_ORIGIN || !ev.data || typeof ev.data !== 'object') return;
      const data = ev.data as { type?: string; buffer?: ArrayBuffer; from?: number; to?: number; contentType?: string; message?: string };

      if (data.type === 'hoonpro-ad-error') {
        clearInterval(timer);
        setPhase({ kind: 'error', message: String(data.message ?? '광고센터에서 오류가 났습니다.') });
        return;
      }
      if (data.type !== 'hoonpro-ad-report' || !(data.buffer instanceof ArrayBuffer)) return;
      if (busy.current) return;
      busy.current = true;
      clearInterval(timer);
      setPhase({ kind: 'saving' });

      try {
        const rows = parseAdReportBuffer(data.buffer, { contentType: data.contentType });
        if (rows.length === 0) throw new Error('보고서가 비어 있습니다. 이 기간에 광고 집행이 없었을 수 있습니다.');

        const daily = extractDailyAdCost(rows);
        const from = ymdToIso(data.from ?? '');
        const to = ymdToIso(data.to ?? '');
        if (!from || !to) throw new Error('기간 정보가 없습니다.');

        let result: { days: number; total: number };
        if (daily) {
          // 보고서 안의 날짜가 기준이다. 요청 기간보다 좁을 수 있다(집행 없는 날).
          const r = await coupangApi.adCostSave({ from, to, daily: daily.days, source: 'report' });
          result = { days: r.days, total: r.total };
        } else {
          // 일자 컬럼이 없으면 합계라도 기간에 나눠 넣는다. 아예 없는 것보다 낫지만
          // 화면에는 '추정'으로 표시된다.
          const cols = Object.keys(rows[0] ?? {});
          const costCol = cols.find(c => c.trim() === '광고비');
          if (!costCol) throw new Error(`보고서에 '광고비' 열이 없습니다. (열: ${cols.slice(0, 8).join(', ')})`);
          const total = rows.reduce((n, r) => n + (Number(String(r[costCol] ?? '').replace(/[^0-9.-]/g, '')) || 0), 0);
          const r = await coupangApi.adCostSave({ from, to, total: Math.round(total) });
          result = { days: r.days, total: r.total };
        }
        setPhase({ kind: 'done', days: result.days, total: result.total, from, to });
      } catch (e: any) {
        setPhase({ kind: 'error', message: e?.message ?? String(e) });
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const goHome = () => {
    // 이 창은 북마클릿이 연 창이라 원래 탭이 따로 있다. 여기서 순이익을 바로 보여준다.
    window.location.href = '/';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground p-6 font-sans">
      <div className="w-full max-w-[460px] rounded-panel border border-line bg-paper p-7 shadow-overlay">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-control bg-accent-soft">
          <Megaphone className="h-5 w-5 text-accent" />
        </div>

        {phase.kind === 'waiting' && (
          <>
            <h1 className="text-[17px] font-semibold text-ink">광고센터에서 보고서를 기다리는 중</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
              광고센터 창에서 보고서를 만들고 있습니다. 보통 10~40초 걸립니다.
              <br />
              이 창은 닫지 말고 그대로 두세요.
            </p>
            <div className="mt-5 flex items-center gap-2 text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[12.5px]">광고센터 창의 오른쪽 위 안내를 보시면 진행 상황이 나옵니다</span>
            </div>
          </>
        )}

        {phase.kind === 'saving' && (
          <>
            <h1 className="text-[17px] font-semibold text-ink">보고서를 받았습니다</h1>
            <div className="mt-4 flex items-center gap-2 text-ink-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[13px]">날짜별 광고비를 뽑아 저장하는 중...</span>
            </div>
          </>
        )}

        {phase.kind === 'done' && (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-positive" />
              <h1 className="text-[17px] font-semibold text-ink">광고비가 반영됐습니다</h1>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
              {phase.from} ~ {phase.to} 사이 <b className="text-ink">{phase.days}일치</b>, 합계{' '}
              <b className="text-ink">{won(phase.total)}</b>이 순이익 계산에 들어갑니다.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              같은 기간을 다시 가져오면 최신 값으로 바뀝니다. 광고센터에 들어갈 때 한 번씩 눌러 주시면 됩니다.
            </p>
            <button
              onClick={goHome}
              className="mt-5 w-full rounded-control bg-accent px-4 py-2.5 text-[13.5px] font-bold text-ground transition-opacity hover:opacity-90"
            >
              순이익 보러 가기
            </button>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-critical" />
              <h1 className="text-[17px] font-semibold text-ink">가져오지 못했습니다</h1>
            </div>
            <p className="mt-3 break-words text-[13px] leading-relaxed text-ink-2">{phase.message}</p>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              광고센터 창에서 즐겨찾기를 다시 눌러보세요. 계속 안 되면 이 문구를 그대로 알려주시면 고치겠습니다.
              그동안은 [광고 성과 분석]에서 보고서 파일을 올려도 같은 결과가 됩니다.
            </p>
            <button
              onClick={() => window.close()}
              className="mt-5 w-full rounded-control border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink-2 hover:border-line-strong hover:text-ink"
            >
              창 닫기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
