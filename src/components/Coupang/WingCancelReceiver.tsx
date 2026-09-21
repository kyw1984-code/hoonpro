/**
 * 윙 즐겨찾기가 보내는 판매분석 파일을 받는 창.
 *
 * 즐겨찾기는 윙 안에서 돌면서 이 창을 window.open으로 열고, 판매자가 [다운로드]를
 * 누를 때 페이지가 받는 파일을 가로채 postMessage로 넘긴다. 여기서 파일을 읽어
 * 그 날짜의 로켓그로스 매출에서 취소를 뺀다. 판매자 본인의 훈프로 세션으로
 * 저장하므로 별도 토큰도, 서버에 두는 세션도 없다.
 *
 * 파일에는 날짜가 없다. 요청 주소에 날짜가 있으면 그걸 쓰고, 없거나 하루가
 * 아니면 여기서 고르게 한다. 보내는 쪽 origin이 윙이 아니면 받지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ShoppingBag, XCircle } from 'lucide-react';
import { WING_ORIGIN } from '../../lib/wingCollector';
import { dateFromHint, parseInsightBuffer, type InsightCancelRow } from '../../lib/insightFile';
import { coupangApi } from '../../lib/coupang';

type Phase =
  | { kind: 'waiting' }
  | { kind: 'pick'; rows: InsightCancelRow[]; hint: string }
  | { kind: 'saving' }
  | { kind: 'done'; date: string; matched: number; cancelQty: number; cancelAmount: number; fileGross: number; ourGross: number }
  | { kind: 'error'; message: string };

const kstYesterday = () => new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10);

export function WingCancelReceiver() {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [date, setDate] = useState(kstYesterday());
  const [captured, setCaptured] = useState<number | null>(null);
  const busy = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPing = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const save = async (rows: InsightCancelRow[], d: string) => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: 'saving' });
    try {
      const r = await coupangApi.growthCancelUpload({ date: d, rows });
      setPhase({ kind: 'done', date: r.date, matched: r.matched, cancelQty: r.cancelQty, cancelAmount: r.cancelAmount, fileGross: r.fileGross, ourGross: r.ourGross });
    } catch (e: any) {
      setPhase({ kind: 'error', message: e?.message ?? String(e) });
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    const opener = window.opener as Window | null;
    const ping = () => {
      try {
        opener?.postMessage({ type: 'hoonpro-wing-ready' }, WING_ORIGIN);
      } catch {
        /* opener가 없거나 닫혔으면 보낼 곳이 없다 */
      }
    };
    ping();
    timerRef.current = setInterval(ping, 2000);

    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== WING_ORIGIN || !ev.data || typeof ev.data !== 'object') return;
      const data = ev.data as { type?: string; buffer?: ArrayBuffer; url?: string; page?: string; requests?: unknown[]; ok?: boolean };

      if (data.type === 'hoonpro-wing-capture') {
        // 페이지가 보낸 요청의 경로·상태만 온다(값 없음). 다음 판에서 다운로드
        // 클릭 없이 바로 부를 수 있게 서버 로그에 남긴다.
        const list = Array.isArray(data.requests) ? data.requests : [];
        setCaptured(list.length);
        try {
          await coupangApi.wingCapture({ page: String(data.page ?? ''), ok: Boolean(data.ok), requests: list });
        } catch {
          /* 진단용이라 실패해도 된다 */
        }
        if (!data.ok && phaseRef.current.kind === 'waiting') {
          stopPing();
          setPhase({ kind: 'error', message: '3분 안에 파일을 받지 못했습니다. 윙 판매분석 화면에서 날짜를 고르고 [다운로드]를 눌러야 합니다.' });
        }
        return;
      }
      if (data.type !== 'hoonpro-wing-report') return;
      stopPing();
      try {
        if (!(data.buffer instanceof ArrayBuffer)) throw new Error('파일이 비어 있습니다.');
        const rows = await parseInsightBuffer(data.buffer);
        if (rows.length === 0) throw new Error('파일에 로켓그로스 줄이 없습니다. 판매분석 옵션별 파일이 맞는지 확인해주세요.');
        const hint = String(data.url ?? '');
        const d = dateFromHint(hint);
        if (d) {
          setDate(d);
          await save(rows, d);
        } else {
          setPhase({ kind: 'pick', rows, hint });
        }
      } catch (e: any) {
        setPhase({ kind: 'error', message: e?.message ?? String(e) });
      }
    };

    window.addEventListener('message', onMessage);
    return () => {
      stopPing();
      window.removeEventListener('message', onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-6 py-10 font-sans">
      <div className="w-full max-w-md rounded-panel border border-line bg-paper px-6 py-6">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-accent" />
          <h1 className="text-[15px] font-semibold text-ink">훈프로 취소 가져오기</h1>
        </div>

        {phase.kind === 'waiting' && (
          <div className="mt-4 flex items-start gap-2 text-[13px] text-ink-2">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-ink-3" />
            <p>
              윙 판매분석 화면으로 돌아가 <b className="text-ink">날짜를 고르고 [다운로드]</b>를 누르세요. 파일이 이 창으로 넘어오면 바로 반영합니다.
            </p>
          </div>
        )}

        {phase.kind === 'pick' && (
          <div className="mt-4 flex flex-col gap-3 text-[13px] text-ink-2">
            <p>파일을 받았습니다 (로켓그로스 {phase.rows.length}개 옵션). 어느 날짜 파일인지 골라주세요.</p>
            {phase.hint && <p className="text-[11px] text-ink-3">요청 주소: {phase.hint.slice(0, 160)}</p>}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-ink-3">
                파일의 날짜
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-control border border-line bg-paper px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-accent" />
              </label>
              <button
                onClick={() => save(phase.rows, date)}
                className="min-h-[36px] rounded-control bg-accent px-3 py-1.5 text-[12px] font-bold text-ground hover:opacity-90"
              >
                이 날짜로 반영
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'saving' && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin text-ink-3" /> 취소를 매출에 반영하는 중...
          </div>
        )}

        {phase.kind === 'done' && (
          <div className="mt-4 text-[13px] text-ink-2">
            <p className="flex items-center gap-1.5 font-semibold text-ink">
              <CheckCircle2 className="h-4 w-4 text-positive" /> {phase.date} 취소를 반영했습니다
            </p>
            <p className="mt-1.5">
              로켓그로스 {phase.matched}개 옵션 · 취소 {phase.cancelQty.toLocaleString('ko-KR')}개 · {phase.cancelAmount.toLocaleString('ko-KR')}원을 뺐습니다.
            </p>
            <p className="mt-1 text-[11.5px] text-ink-3">
              {phase.fileGross === phase.ourGross
                ? `파일의 총 판매수 ${phase.fileGross}개가 훈프로 결제 수량과 일치합니다.`
                : `파일의 총 판매수 ${phase.fileGross}개, 훈프로 결제 수량 ${phase.ourGross}개 — 다르면 날짜가 다르거나 아직 수집 전입니다.`}
            </p>
            <p className="mt-3 text-[11.5px] text-ink-3">이 창은 닫아도 됩니다. 순이익 화면을 새로고침하면 반영돼 있습니다.</p>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="mt-4 text-[13px] text-ink-2">
            <p className="flex items-center gap-1.5 font-semibold text-critical">
              <XCircle className="h-4 w-4" /> 반영하지 못했습니다
            </p>
            <p className="mt-1.5">{phase.message}</p>
          </div>
        )}

        {captured !== null && (
          <p className="mt-4 text-[11px] text-ink-3">윙이 보낸 요청 {captured}건의 경로를 기록했습니다 (값은 없음). 다음 판에는 [다운로드] 없이 바로 가져오도록 쓰입니다.</p>
        )}
      </div>
    </div>
  );
}
