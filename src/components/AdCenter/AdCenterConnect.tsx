/**
 * 광고센터 연결 카드 — 광고비를 버튼 하나로 가져오게 하는 즐겨찾기.
 *
 * 즐겨찾기 바에 한 번 끌어다 놓으면, 이후 광고센터에 들어가 그 버튼을 누를 때마다
 * 고른 기간의 광고비가 훈프로에 들어온다. 로그인 정보는 어디에도 저장되지 않는다.
 *
 * 기간은 고르게 해 뒀다. 30일은 우리가 정한 값이지 쿠팡의 상한이 아니다. 다만
 * 길게 잡을수록 보고서 생성이 오래 걸리고, 쿠팡이 어느 길이부터 거절하는지는
 * 문서에 없다. 고정해 두면 거절당하는 날 코드를 고쳐 배포할 때까지 못 쓴다.
 * 고르게 두면 그 자리에서 짧은 쪽을 눌러 쓰면 된다.
 *
 * "마지막 반영"을 함께 보여준다. 광고비가 빠진 채로 순이익을 보면 실제보다
 * 크게 나오는데, 언제까지 들어와 있는지 모르면 그걸 알아챌 길이 없다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Check, Copy, Megaphone } from 'lucide-react';
import { AD_COLLECT_DAYS, buildAdBookmarklet } from '../../lib/adCollector';
import { coupangApi, sinceText } from '../../lib/coupang';

/** 고를 수 있는 수집 기간 */
const DAY_CHOICES = [30, 90, 180, 365] as const;

export function AdCenterConnect({ compact = false }: { compact?: boolean }) {
  const [days, setDays] = useState<number>(AD_COLLECT_DAYS);
  const bookmarklet = useMemo(() => buildAdBookmarklet(window.location.origin, days), [days]);
  const [copied, setCopied] = useState(false);
  // React는 href에 javascript: 주소를 넣으면 보안상 막힌 주소로 바꿔 버린다.
  // 북마클릿은 그게 본질이라, React를 거치지 않고 DOM에 직접 넣는다.
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    linkRef.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);
  // 마지막 날짜만 보여주면 "90일로 받았는데 진짜 90일이 들어왔나"를 알 수가 없다.
  // 첫 날짜와 실제로 값이 있는 날수를 함께 본다. 기간에 구멍이 있으면 날수가
  // 기간보다 적게 나오므로 그것도 여기서 드러난다.
  const [span, setSpan] = useState<{ first: string; last: string; days: number } | null | undefined>(undefined);

  useEffect(() => {
    coupangApi
      .adCosts(400)
      .then(r => {
        const dates = r.days.map(d => d.date).sort();
        setSpan(dates.length ? { first: dates[0], last: dates[dates.length - 1], days: dates.length } : null);
      })
      .catch(() => setSpan(null));
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

  const last = span === undefined
    ? '확인 중...'
    : span === null
      ? '아직 없음'
      : `${span.first} ~ ${span.last} · ${span.days}일 (마지막 ${sinceText(`${span.last}T00:00:00+09:00`)})`;

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
            누르면 최근 {days}일 광고비가 자동으로 들어옵니다. 로그인 정보는 어디에도 저장되지 않습니다.
          </p>
          <p className="mt-1 text-[11.5px] text-ink-3">광고비 들어온 기간: {last}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11.5px] text-ink-3">가져올 기간</span>
        {DAY_CHOICES.map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`min-h-[32px] rounded-control border px-2.5 text-[12px] font-medium transition-colors ${
              days === d ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
            }`}
          >
            {d}일
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
        길게 잡을수록 보고서가 만들어지는 데 오래 걸립니다. 쿠팡이 거절하면 짧은 쪽을 눌러 다시 끌어다 놓으세요.
        이미 받아 둔 날짜는 덮어쓰기만 하므로 여러 번 눌러도 광고비가 두 번 잡히지 않습니다.
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
