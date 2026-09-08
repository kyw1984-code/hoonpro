/**
 * 광고센터 연결 카드 — 광고비를 버튼 하나로 가져오게 하는 즐겨찾기.
 *
 * 즐겨찾기 바에 한 번 끌어다 놓으면, 이후 광고센터에 들어가 그 버튼을 누를 때마다
 * 최근 30일 광고비가 훈프로에 들어온다. 로그인 정보는 어디에도 저장되지 않는다.
 *
 * "마지막 반영"을 함께 보여준다. 광고비가 빠진 채로 순이익을 보면 실제보다
 * 크게 나오는데, 언제까지 들어와 있는지 모르면 그걸 알아챌 길이 없다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Check, Copy, Megaphone } from 'lucide-react';
import { buildAdBookmarklet } from '../../lib/adCollector';
import { coupangApi, sinceText } from '../../lib/coupang';

export function AdCenterConnect({ compact = false }: { compact?: boolean }) {
  const bookmarklet = useMemo(() => buildAdBookmarklet(window.location.origin), []);
  const [copied, setCopied] = useState(false);
  // React는 href에 javascript: 주소를 넣으면 보안상 막힌 주소로 바꿔 버린다.
  // 북마클릿은 그게 본질이라, React를 거치지 않고 DOM에 직접 넣는다.
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    linkRef.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);
  const [lastDate, setLastDate] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    coupangApi
      .adCosts(400)
      .then(r => {
        const dates = r.days.map(d => d.date).sort();
        setLastDate(dates.length ? dates[dates.length - 1] : null);
      })
      .catch(() => setLastDate(null));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* 클립보드가 막힌 환경 — 아래 안내 문구가 대신한다 */
    }
  };

  const last = lastDate === undefined
    ? '확인 중...'
    : lastDate === null
      ? '아직 없음'
      : `${lastDate}까지 (${sinceText(`${lastDate}T00:00:00+09:00`)})`;

  return (
    <div className="rounded-panel border border-line bg-paper px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-soft">
          <Megaphone className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">광고센터 연결 — 광고비를 버튼 하나로</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
            아래 버튼을 브라우저 <b className="text-ink">즐겨찾기 바에 한 번 끌어다 놓으세요</b>. 이후 광고센터에 들어가서 그 즐겨찾기를
            누르면 최근 30일 광고비가 자동으로 들어옵니다. 로그인 정보는 어디에도 저장되지 않습니다.
          </p>
          <p className="mt-1 text-[11.5px] text-ink-3">광고비 마지막 반영: {last}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* href가 javascript: 라 클릭은 막고 드래그만 살린다. 여기서 실행되면 광고센터가 아니라고 안내만 뜬다 */}
        <a
          ref={linkRef}
          onClick={e => e.preventDefault()}
          draggable
          title="이 버튼을 즐겨찾기 바로 끌어다 놓으세요"
          className="inline-flex cursor-grab items-center gap-1.5 rounded-control border border-accent bg-accent-soft px-3.5 py-2 text-[12.5px] font-semibold text-ink active:cursor-grabbing"
        >
          <BookmarkPlus className="h-4 w-4 text-accent" />
          훈프로 광고비 가져오기
        </a>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '복사됨' : '주소 복사'}
        </button>
      </div>

      {!compact && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[11.5px] leading-relaxed text-ink-3">
          <li>
            즐겨찾기 바가 안 보이면 <kbd className="rounded border border-line px-1 text-[10.5px]">Ctrl</kbd>+
            <kbd className="rounded border border-line px-1 text-[10.5px]">Shift</kbd>+
            <kbd className="rounded border border-line px-1 text-[10.5px]">B</kbd>로 켜세요. 끌어다 놓기가 어려우면 [주소 복사] 뒤
            즐겨찾기를 새로 만들고 주소 칸에 붙여넣으면 됩니다.
          </li>
          <li>광고센터(advertising.coupang.com)에 로그인한 뒤, 그 즐겨찾기를 누릅니다.</li>
          <li>훈프로 창이 하나 열리고 10~40초 뒤 "광고비가 반영됐습니다"가 뜹니다. 끝입니다.</li>
        </ol>
      )}
      <p className="mt-2 text-[11px] text-ink-3">PC 크롬·엣지에서 됩니다. 휴대폰에서는 [광고 성과 분석]의 파일 올리기를 이용해주세요.</p>
    </div>
  );
}
