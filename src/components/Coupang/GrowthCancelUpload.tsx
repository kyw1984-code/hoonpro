/**
 * 쿠팡 판매분석 파일로 로켓그로스 취소를 반영한다.
 *
 * 로켓그로스 주문 API는 취소를 안 준다. 윙 > 비즈니스 인사이트 > 판매분석에서
 * 날짜를 고르고 내려받은 옵션별 파일(SELLER_INSIGHTS_VENDOR_ITEM_METRICS)에는
 * '총 취소된 상품수·총 취소 금액'이 있어, 그 값을 그 날짜의 그로스 매출에서 뺀다.
 * 파일에 날짜가 없으므로 어느 날짜 파일인지는 여기서 고른다.
 */
import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Check, Copy, Loader2, Upload } from 'lucide-react';
import { coupangApi } from '../../lib/coupang';
import { parseInsightBuffer } from '../../lib/insightFile';
import { WING_INSIGHT_PATH, WING_ORIGIN, buildWingBookmarklet } from '../../lib/wingCollector';

const kstYesterday = () => new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10);

export function GrowthCancelUpload({ onDone }: { onDone: () => void | Promise<void> }) {
  const [date, setDate] = useState(kstYesterday());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 즐겨찾기 — href가 javascript: 라 React가 막으므로 ref로 직접 넣는다
  const linkRef = useRef<HTMLAnchorElement>(null);
  const bookmarklet = buildWingBookmarklet(window.location.origin);
  useEffect(() => { linkRef.current?.setAttribute('href', bookmarklet); }, [bookmarklet]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg('복사하지 못했습니다. 즐겨찾기 버튼을 직접 끌어다 놓아주세요.');
    }
  };

  const upload = async (file: File | null) => {
    if (!file || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const rows = await parseInsightBuffer(await file.arrayBuffer());
      if (rows.length === 0) throw new Error('파일에 로켓그로스 줄이 없습니다.');
      const r = await coupangApi.growthCancelUpload({ date, rows });
      const mismatch = r.fileGross !== r.ourGross;
      setMsg(
        `${r.date} 그로스 ${r.matched}개 옵션에 취소 ${r.cancelQty.toLocaleString('ko-KR')}개 · ${r.cancelAmount.toLocaleString('ko-KR')}원을 뺐습니다.` +
          (mismatch
            ? ` 파일의 총 판매수 ${r.fileGross}개, 우리 결제 수량 ${r.ourGross}개 — 다르면 날짜를 잘못 골랐거나 아직 수집 전입니다.`
            : ` 총 판매수 ${r.fileGross}개가 우리 결제 수량과 일치합니다.`),
      );
      await onDone();
    } catch (e: any) {
      setMsg(e?.message ?? '올리지 못했습니다.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="mt-3 rounded-card border border-line bg-paper-2/40 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <p className="text-[12px] font-semibold text-ink">판매분석 파일로 취소 정확히 반영</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
            윙 › 비즈니스 인사이트 › 판매분석에서 날짜를 고르고 옵션별 파일을 내려받아 올리세요.
            그 날짜의 그로스 취소가 추정치 대신 파일 값으로 바뀝니다.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">
          파일의 날짜
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded-control border border-line bg-paper px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          파일 올리기
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => upload(e.target.files?.[0] ?? null)} />
      </div>
      {msg && <p className="mt-2 text-[11.5px] text-ink-2">{msg}</p>}

      <div className="mt-3 border-t border-line/60 pt-3">
        <p className="text-[12px] font-semibold text-ink">한 번 클릭으로 — 윙 즐겨찾기</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
          아래 버튼을 즐겨찾기 바에 한 번 끌어다 놓으세요. 이후 윙 판매분석에서 그 즐겨찾기를 누르고 평소처럼 날짜를 골라 [다운로드]를
          누르면, 파일이 훈프로로 바로 넘어와 취소가 반영됩니다. 로그인 정보는 어디에도 저장되지 않습니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a
            ref={linkRef}
            onClick={e => e.preventDefault()}
            draggable
            title="이 버튼을 즐겨찾기 바로 끌어다 놓으세요"
            className="inline-flex cursor-grab items-center gap-1.5 rounded-control border border-accent bg-accent-soft px-3.5 py-2 text-[12.5px] font-semibold text-ink active:cursor-grabbing"
          >
            <BookmarkPlus className="h-4 w-4 text-accent" />
            훈프로 취소 가져오기
          </a>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '복사됨' : '주소 복사'}
          </button>
          <a
            href={`${WING_ORIGIN}${WING_INSIGHT_PATH}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            윙 판매분석 열기
          </a>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          순서: 윙에 로그인 → 판매분석 화면 → 즐겨찾기 클릭 → 날짜 선택 → [다운로드]. 훈프로 창이 하나 열리고 "취소를 반영했습니다"가 뜨면 끝입니다.
          PC 크롬·엣지에서 됩니다.
        </p>
      </div>
    </div>
  );
}
