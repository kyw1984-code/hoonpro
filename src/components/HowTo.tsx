/**
 * 사용 방법 안내 — 버튼 하나와 안내창.
 *
 * 화면마다 안내를 따로 만들면 말투도 깊이도 제각각이 되고, 어디에 있는지
 * 외워야 한다. 부품을 하나로 두면 어느 화면에서든 같은 자리에 같은 모양으로
 * 있으므로 한 번 찾으면 그다음부터는 찾지 않아도 된다.
 *
 * 자동으로 뜨지 않는다. 들어올 때마다 안내가 가로막으면 그건 안내가 아니라
 * 치워야 할 것이 된다 (소싱AI에서 실제로 그랬다).
 */
import { useEffect, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { HOWTO } from '../lib/howto';

export function HowTo({
  id,
  label = '사용 방법',
  compact = false,
  className = '',
}: {
  id: string;
  label?: string;
  /** 아이콘만 — 탭 줄처럼 자리가 좁은 곳에 쓴다 */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const guide = HOWTO[id];

  // 화면을 옮기면 열려 있던 안내는 닫는다. 다른 화면의 안내가 남아 있으면
  // 지금 보는 것과 다른 얘기를 하게 된다.
  useEffect(() => { setOpen(false); }, [id]);

  // 안내창이 떠 있을 때 Esc로 닫힌다. 모달에서 기대하는 동작이다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 안내가 없는 화면에서는 버튼도 두지 않는다. 눌렀는데 빈 창이 뜨면
  // 다음부터 그 버튼을 안 누르게 된다.
  if (!guide) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${guide.title} 사용 방법`}
        aria-label={`${guide.title} 사용 방법`}
        className={
          compact
            ? `flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink ${className}`
            : `flex shrink-0 items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink ${className}`
        }
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {!compact && label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${guide.title} 사용 방법`}
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-[540px] flex-col overflow-hidden rounded-panel border border-line bg-paper shadow-overlay"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">How to use</p>
                <h3 className="mt-1.5 text-[19px] font-semibold text-ink">{guide.title}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{guide.lead}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="shrink-0 rounded-full p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2.5 overflow-y-auto px-6 pb-4 pt-2">
              {guide.steps.map((s, i) => (
                <div key={s.title} className="flex items-start gap-3 rounded-card border border-line bg-paper-2 p-3.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-paper">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">{s.title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{s.desc}</p>
                  </div>
                </div>
              ))}

              {guide.caution && (
                <p className="rounded-card border px-3.5 py-3 text-[12px] leading-relaxed" style={{ borderColor: 'rgba(255,180,84,.35)', background: 'rgba(255,180,84,.08)', color: '#ffb454' }}>
                  {guide.caution}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
              <span className="text-[11px] text-ink-3">[사용 방법] 버튼으로 언제든 다시 볼 수 있습니다</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
