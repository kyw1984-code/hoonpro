/**
 * 광고센터 북마클릿이 보내는 보고서를 받는 창.
 *
 * 북마클릿은 광고센터 안에서 돌면서 이 창을 window.open으로 열고, 결과를
 * postMessage로 넘긴다. 세 가지 형태로 온다.
 *   · 파일 그 자체(buffer)         → 여기서 읽어 저장
 *   · 파일 주소(url, S3 같은 곳)    → 브라우저는 다른 도메인이라 못 읽으니 서버가 대신 받아 저장
 *   · 내려받기로 돌렸다(download)  → 브라우저가 파일을 내려받았으니 여기에 끌어다 놓게 한다
 * 어느 쪽이든 판매자 본인의 훈프로 세션으로 저장하므로 별도 토큰도 서버에 두는
 * 세션도 없다.
 *
 * 보내는 쪽 origin이 광고센터가 아니면 받지 않는다. 아무 사이트나 이 창에
 * 메시지를 던져 남의 광고비를 덮어쓸 수 있으면 안 된다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Megaphone, Upload, XCircle } from 'lucide-react';
import { AD_CENTER_ORIGIN, ymdToIso } from '../../lib/adCollector';
import { parseAdReportBuffer } from '../../lib/adReport';
import { extractDailyAdCost, extractItemAdCost } from '../../lib/adcost';
import { coupangApi, won } from '../../lib/coupang';

type Phase =
  | { kind: 'waiting' }
  | { kind: 'saving' }
  | { kind: 'drop'; from: string; to: string; reason: string }
  | { kind: 'done'; days: number; total: number; from: string; to: string; estimated: boolean; columns: string[]; dateGroup: string }
  | { kind: 'error'; message: string };

export function AdReportReceiver() {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const busy = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPing = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /** 파일(버퍼)에서 날짜별 광고비를 뽑아 저장한다 — 북마클릿이 준 것이든 끌어다 놓은 것이든 같다 */
  const saveBuffer = useCallback(async (buf: ArrayBuffer, from: string, to: string, hint?: { filename?: string; contentType?: string }) => {
    const rows = parseAdReportBuffer(buf, hint);
    if (rows.length === 0) throw new Error('보고서가 비어 있습니다. 이 기간에 광고 집행이 없었을 수 있습니다.');
    const cols = Object.keys(rows[0] ?? {});
    const daily = extractDailyAdCost(rows);
    if (daily) {
      // 보고서 안의 날짜가 기준이다. 요청 기간보다 좁을 수 있다(집행 없는 날).
      const r = await coupangApi.adCostSave({ from, to, daily: daily.days, source: 'report', items: extractItemAdCost(rows) ?? [] });
      return { days: r.days, total: r.total, estimated: false, columns: cols };
    }
    // 일자 컬럼이 없으면 합계라도 기간에 나눠 넣는다. 아예 없는 것보다 낫지만 화면에는 '추정'으로 표시되고,
    // 어떤 열이 왔는지 남겨 다음 수정의 단서로 삼는다.
    const costCol = cols.find(c => c.trim() === '광고비');
    if (!costCol) throw new Error(`보고서에 '광고비' 열이 없습니다. (열: ${cols.slice(0, 8).join(', ')})`);
    const total = rows.reduce((n, r) => n + (Number(String(r[costCol] ?? '').replace(/[^0-9.-]/g, '')) || 0), 0);
    const r = await coupangApi.adCostSave({ from, to, total: Math.round(total) });
    return { days: r.days, total: r.total, estimated: true, columns: cols };
  }, []);

  useEffect(() => {
    const opener = window.opener as Window | null;

    // 북마클릿에 "받을 준비 됐다"고 알린다. 북마클릿이 아직 듣기 전일 수 있어
    // 결과가 올 때까지 2초마다 다시 보낸다.
    const ping = () => {
      try {
        opener?.postMessage({ type: 'hoonpro-ad-ready' }, AD_CENTER_ORIGIN);
      } catch {
        /* opener가 없거나 닫혔으면 보낼 곳이 없다 */
      }
    };
    ping();
    timerRef.current = setInterval(ping, 2000);

    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== AD_CENTER_ORIGIN || !ev.data || typeof ev.data !== 'object') return;
      const data = ev.data as {
        type?: string; buffer?: ArrayBuffer; url?: string; from?: number; to?: number;
        contentType?: string; message?: string; reason?: string; dateGroup?: string;
      };
      const dateGroup = String(data.dateGroup ?? '');

      if (data.type === 'hoonpro-ad-error') {
        stopPing();
        setPhase({ kind: 'error', message: String(data.message ?? '광고센터에서 오류가 났습니다.') });
        return;
      }
      if (!/^hoonpro-ad-report(-url|-download)?$/.test(String(data.type))) return;
      if (busy.current) return;

      const from = ymdToIso(data.from ?? '');
      const to = ymdToIso(data.to ?? '');
      if (!from || !to) {
        setPhase({ kind: 'error', message: '기간 정보가 없습니다.' });
        return;
      }

      if (data.type === 'hoonpro-ad-report-download') {
        // 파일은 브라우저가 내려받았다. 여기에 끌어다 놓게 한다. busy는 잠그지 않는다 —
        // 사용자가 파일을 놓아야 다음으로 간다.
        stopPing();
        setPhase({ kind: 'drop', from, to, reason: String(data.reason ?? '') });
        return;
      }

      busy.current = true;
      stopPing();
      setPhase({ kind: 'saving' });
      try {
        let result: { days: number; total: number; estimated: boolean; columns: string[] };
        if (data.type === 'hoonpro-ad-report-url') {
          // 다른 도메인 주소라 브라우저에서는 못 읽는다. 서버가 대신 받아 저장한다.
          const r = await coupangApi.adImportUrl(String(data.url ?? ''), from, to);
          result = { days: r.days, total: r.total, estimated: r.source === 'spread', columns: [] };
        } else {
          if (!(data.buffer instanceof ArrayBuffer)) throw new Error('보고서 파일이 비어 있습니다.');
          result = await saveBuffer(data.buffer, from, to, { contentType: data.contentType });
        }
        setPhase({ kind: 'done', ...result, from, to, dateGroup });
      } catch (e: any) {
        setPhase({ kind: 'error', message: e?.message ?? String(e) });
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      stopPing();
      window.removeEventListener('message', onMessage);
    };
  }, [saveBuffer]);

  /** 내려받기로 돌아간 경우 — 사용자가 놓은 파일을 읽는다 */
  const onFile = async (file: File | null) => {
    if (!file || phase.kind !== 'drop' || busy.current) return;
    busy.current = true;
    const { from, to } = phase;
    setPhase({ kind: 'saving' });
    try {
      const result = await saveBuffer(await file.arrayBuffer(), from, to, { filename: file.name, contentType: file.type });
      setPhase({ kind: 'done', ...result, from, to, dateGroup: '' });
    } catch (e: any) {
      busy.current = false;
      setPhase({ kind: 'error', message: e?.message ?? String(e) });
    }
  };

  const goHome = () => {
    // 이 창은 북마클릿이 연 창이라 원래 탭이 따로 있다. 여기서 순이익 화면으로 바로 보낸다 —
    // 홈으로 보내면 "순이익 보러 가기"를 눌렀는데 홈이 떠서 다시 찾아 들어가야 한다.
    window.location.href = '/?tab=coupang';
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

        {phase.kind === 'drop' && (
          <>
            <h1 className="text-[17px] font-semibold text-ink">보고서 파일이 내려받아졌습니다</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              브라우저가 파일을 직접 읽지 못해 평소처럼 내려받았습니다. 방금 내려받은 파일을
              아래에 끌어다 놓거나 골라주세요. 보고서를 만들고 기다리는 일은 이미 끝났습니다.
            </p>
            <label
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className="mt-4 flex h-28 cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-line-strong bg-paper-2 text-ink-3 hover:bg-paper"
            >
              <Upload className="mb-1.5 h-6 w-6" />
              <span className="text-[12.5px]">여기에 파일을 끌어다 놓거나 클릭해서 선택</span>
              <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={e => onFile(e.target.files?.[0] ?? null)} />
            </label>
            {phase.reason && <p className="mt-2 text-[11px] text-ink-3">브라우저가 읽지 못한 이유: {phase.reason}</p>}
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
            {phase.estimated && (
              // 일자 열을 못 찾아 합계를 나눠 넣은 경우. 어떤 열이 왔는지 그대로 보여준다 —
              // 이 문구가 곧 다음 수정의 단서다.
              <p className="mt-2 rounded-control border border-line bg-paper-2 px-3 py-2 text-[11.5px] leading-relaxed text-ink-3">
                보고서에서 일자 열을 찾지 못해 합계를 기간에 나눠 넣었습니다(추정).
                {phase.dateGroup && <> 보고서 단위: {phase.dateGroup}.</>}
                {phase.columns.length > 0 && <> 열: {phase.columns.slice(0, 10).join(', ')}</>}
              </p>
            )}
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
