/**
 * 공지사항 — 버튼 하나와 목록창.
 *
 * 업데이트 내용, 점검 안내처럼 모든 회원이 알아야 할 것을 적는 곳이다. 운영자와
 * AI 도우미가 쓰고, 회원은 읽는다. 사용 방법 왼쪽에 늘 같은 자리에 있다.
 *
 * 새 글이 있으면 버튼에 점이 붙는다. 마지막으로 본 글의 시각을 이 브라우저에
 * 기억한다 — 서버에 읽음을 남길 만큼 중요한 정보는 아니다.
 */
import { useEffect, useState } from 'react';
import { Loader2, Megaphone, Pencil, Pin, Plus, Trash2, X } from 'lucide-react';
import { getToken, getUser } from '../lib/auth';
import { ModalPortal } from './ModalPortal';

export interface Notice {
  id: string;
  title: string;
  body: string;
  author: string;
  pinned: boolean;
  /** 접속할 때 팝업으로 띄운다 */
  popup: boolean;
  published_at: string;
  updated_at: string;
}

const SEEN_KEY = 'hoonpro-notices-seen-at';
/** 팝업을 닫은 글 — { [id]: 닫은 날짜 } 하루 지나면 다시 뜬다 */
const POPUP_DISMISSED_KEY = 'hoonpro-notice-popup-dismissed';
const todayKey = () => new Date().toISOString().slice(0, 10);
const readDismissed = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(POPUP_DISMISSED_KEY) || '{}'); } catch { return {}; }
};
const dismissPopup = (id: string) => {
  try { localStorage.setItem(POPUP_DISMISSED_KEY, JSON.stringify({ ...readDismissed(), [id]: todayKey() })); } catch { /* 무시 */ }
};

const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

async function fetchNotices(): Promise<Notice[]> {
  const res = await fetch('/api/admin?action=notices', { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || '공지를 불러오지 못했습니다.');
  return Array.isArray(json.notices) ? json.notices : [];
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

export function Notices({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const user = getUser();
  const isAdmin = Boolean(user?.isAdmin);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const [editing, setEditing] = useState<Partial<Notice> | null>(null);
  const [saving, setSaving] = useState(false);
  // 접속 시 띄울 팝업 공지 — 닫지 않은 것 중 가장 최근 하나
  const [popup, setPopup] = useState<Notice | null>(null);

  const load = async () => {
    try {
      const n = await fetchNotices();
      setList(n);
      setError(null);
      const latest = n.reduce((m, x) => (x.published_at > m ? x.published_at : m), '');
      let seen = '';
      try { seen = localStorage.getItem(SEEN_KEY) || ''; } catch { /* 비공개 창 */ }
      setHasNew(Boolean(latest) && latest > seen);
      // 팝업 공지: 오늘 닫은 적 없는 것 중 가장 최근 하나만. 여러 개를 겹쳐 띄우면
      // 읽지 않고 닫게 된다.
      const dismissed = readDismissed();
      const cand = n
        .filter(x => x.popup && dismissed[x.id] !== todayKey())
        .sort((a, b) => b.published_at.localeCompare(a.published_at))[0] ?? null;
      setPopup(prev => (prev && cand && prev.id === cand.id ? prev : cand));
      return n;
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return [];
    }
  };

  // 새 글 점만 위해 처음 한 번 조용히 읽는다
  useEffect(() => { void load(); }, []);

  const openList = async () => {
    setOpen(true);
    const n = await load();
    const latest = n.reduce((m, x) => (x.published_at > m ? x.published_at : m), '');
    try { if (latest) localStorage.setItem(SEEN_KEY, latest); } catch { /* 무시 */ }
    setHasNew(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setEditing(null); setOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const save = async () => {
    if (!editing || saving) return;
    const title = String(editing.title ?? '').trim();
    const body = String(editing.body ?? '').trim();
    if (!title || !body) { setError('제목과 내용을 적어주세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin?action=notice-save', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ id: editing.id, title, body, pinned: Boolean(editing.pinned), popup: Boolean(editing.popup) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '저장하지 못했습니다.');
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('이 공지를 지울까요?')) return;
    try {
      const res = await fetch('/api/admin?action=notice-delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '지우지 못했습니다.');
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const sorted = [...(list ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.published_at.localeCompare(a.published_at));

  return (
    <>
      <button
        type="button"
        onClick={openList}
        title="공지사항"
        aria-label="공지사항"
        className={
          compact
            ? `relative flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink ${className}`
            : `relative flex shrink-0 items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink ${className}`
        }
      >
        <Megaphone className="h-3.5 w-3.5" />
        {!compact && '공지사항'}
        {hasNew && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-critical ring-2 ring-paper" aria-label="새 공지" />}
      </button>

      {/* 접속 시 팝업 — 운영자가 '접속 시 팝업'을 켠 공지. 닫으면 그날은 다시 안 뜬다.
          헤더에 버튼이 두 개(좁은 화면용·넓은 화면용) 있어 팝업은 한쪽에서만 띄운다 */}
      {!compact && popup && !open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[85] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
            role="dialog" aria-modal="true" aria-label="공지"
            onClick={() => { dismissPopup(popup.id); setPopup(null); }}
          >
            <div className="flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-panel border border-line bg-paper shadow-overlay" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Notice</p>
                  <h3 className="mt-1.5 break-keep text-[19px] font-semibold text-ink">{popup.title}</h3>
                  <p className="mt-1 text-[12px] text-ink-3">{fmt(popup.published_at)} · {popup.author}</p>
                </div>
                <button type="button" onClick={() => { dismissPopup(popup.id); setPopup(null); }} aria-label="닫기" className="shrink-0 rounded-full p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="overflow-y-auto px-6 pb-4">
                <p className="whitespace-pre-wrap break-keep text-[14px] leading-relaxed text-ink-2">{popup.body}</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
                <button type="button" onClick={() => { dismissPopup(popup.id); setPopup(null); }} className="rounded-control border border-line px-4 py-2 text-[13px] font-medium text-ink-2 hover:text-ink">오늘 그만 보기</button>
                <button type="button" onClick={() => { dismissPopup(popup.id); setPopup(null); void openList(); }} className="rounded-control bg-accent px-4 py-2 text-[13px] font-bold text-ground hover:opacity-90">공지 전체 보기</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
            role="dialog" aria-modal="true" aria-label="공지사항"
            onClick={() => { setEditing(null); setOpen(false); }}
          >
            <div
              className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-panel border border-line bg-paper shadow-overlay"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Notice</p>
                  <h3 className="mt-1.5 text-[19px] font-semibold text-ink">공지사항</h3>
                  <p className="mt-1 text-[13px] text-ink-2">업데이트와 점검 안내를 여기에 올립니다.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isAdmin && !editing && (
                    <button
                      type="button"
                      onClick={() => setEditing({ title: '', body: '', pinned: false })}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-control bg-accent px-3 text-[13px] font-bold text-ground hover:opacity-90"
                    >
                      <Plus className="h-4 w-4" />새 글
                    </button>
                  )}
                  <button type="button" onClick={() => { setEditing(null); setOpen(false); }} aria-label="닫기" className="rounded-full p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 overflow-y-auto px-6 pb-6">
                {error && <p className="rounded-control border border-critical/40 bg-critical-soft px-3 py-2 text-[13px] text-ink">{error}</p>}

                {editing && (
                  <div className="flex flex-col gap-2 rounded-card border border-accent-line bg-accent-soft p-4">
                    <input
                      value={editing.title ?? ''}
                      onChange={e => setEditing({ ...editing, title: e.target.value })}
                      placeholder="제목"
                      className="rounded-control border border-line bg-paper px-3 py-2 text-[14.5px] font-semibold text-ink outline-none focus:ring-2 focus:ring-accent"
                    />
                    <textarea
                      value={editing.body ?? ''}
                      onChange={e => setEditing({ ...editing, body: e.target.value })}
                      placeholder="내용 — 줄바꿈이 그대로 보입니다"
                      rows={8}
                      className="rounded-control border border-line bg-paper px-3 py-2 text-[14px] leading-relaxed text-ink outline-none focus:ring-2 focus:ring-accent"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-[13px] text-ink-2">
                          <input type="checkbox" checked={Boolean(editing.pinned)} onChange={e => setEditing({ ...editing, pinned: e.target.checked })} />
                          맨 위에 고정
                        </label>
                        <label className="flex items-center gap-2 text-[13px] text-ink-2" title="회원이 접속하면 이 글이 팝업으로 뜹니다. 닫으면 그날은 다시 안 뜹니다.">
                          <input type="checkbox" checked={Boolean(editing.popup)} onChange={e => setEditing({ ...editing, popup: e.target.checked })} />
                          접속 시 팝업으로 띄우기
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditing(null)} className="rounded-control border border-line px-3 py-2 text-[13px] text-ink-2 hover:text-ink">취소</button>
                        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-[13px] font-bold text-ground hover:opacity-90 disabled:opacity-40">
                          {saving && <Loader2 className="h-4 w-4 animate-spin" />}{editing.id ? '수정 저장' : '올리기'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {list === null && !error && (
                  <p className="flex items-center gap-2 py-8 text-[13px] text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중...</p>
                )}
                {list !== null && sorted.length === 0 && !editing && (
                  <p className="py-10 text-center text-[13.5px] text-ink-3">아직 올라온 공지가 없습니다.</p>
                )}
                {sorted.map(n => (
                  <article key={n.id} className="rounded-card border border-line bg-paper-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                          {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent" />}
                          <span className="break-keep">{n.title}</span>
                          {isAdmin && n.popup && <span className="rounded-control border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-2">팝업</span>}
                        </h4>
                        <p className="mt-0.5 text-[12px] text-ink-3">{fmt(n.published_at)} · {n.author}</p>
                      </div>
                      {isAdmin && (
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => setEditing({ ...n })} title="수정" className="rounded-control border border-line p-1.5 text-ink-2 hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => remove(n.id)} title="삭제" className="rounded-control border border-line p-1.5 text-ink-2 hover:text-critical"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-keep text-[14px] leading-relaxed text-ink-2">{n.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
