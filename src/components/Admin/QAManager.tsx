import React, { useEffect, useState } from 'react';
import { BookOpen, Upload, Trash2, Loader2, RefreshCw, MessageSquareText, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, Pencil, X, Save, Send, HelpCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';

interface DocRow {
  id: string;
  title: string;
  source_type: 'lecture' | 'kakao';
  chunk_count: number;
  char_count: number;
  created_at: string;
}

interface LogRow {
  id: string;
  question: string;
  answer: string | null;
  sources: { title: string }[] | null;
  matched: boolean;
  feedback: 1 | -1 | null;
  model: string | null;
  created_at: string;
  users: { name: string } | null;
}

export function QAManager({ showToast }: { showToast: (msg: string) => void }) {
  const [section, setSection] = useState<'docs' | 'pending' | 'logs'>('docs');
  // 미답변 건수 — 탭에 숫자를 붙여야 들어가 볼 이유가 생긴다
  const [pendingCount, setPendingCount] = useState(0);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/qa?action=status', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();
        if (res.ok) setEnabled(data.enabled === true);
      } catch {
        // 조회 실패 시 토글 비표시 유지
      }
    })();
  }, []);

  const handleToggle = async () => {
    if (enabled === null || toggling) return;
    const next = !enabled;
    if (!next && !confirm('수강생의 "훈프로 코칭AI" 사용을 중지하시겠습니까?\n수강생 화면에서 탭이 숨겨집니다. (관리자는 계속 사용 가능)')) return;
    if (next && !confirm('수강생에게 "훈프로 코칭AI" 탭을 공개하시겠습니까?')) return;
    setToggling(true);
    try {
      const res = await fetch('/api/qa?action=toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '설정 저장에 실패했습니다.');
      setEnabled(next);
      showToast(data.message);
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-semibold text-ink">훈프로 코칭AI — 지식 관리</h2>
      </div>
      <p className="mb-5 text-[13px] text-ink-2">
        강의 정리본을 업로드하면 자동으로 청크 분할·임베딩되어 수강생 질문 답변의 근거 자료로 사용됩니다.
        연락처·이메일 등 개인정보는 업로드 시 자동 마스킹됩니다.
      </p>

      {/* 수강생 공개 ON/OFF */}
      {enabled !== null && (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-card border border-line bg-paper px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-ink">
              수강생 공개 {enabled
                ? <span className="ml-1 rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-medium text-positive">ON</span>
                : <span className="ml-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-medium text-caution">OFF · 관리자만 사용 중</span>}
            </div>
            <p className="mt-1 text-xs text-ink-3">
              OFF면 수강생 화면에서 탭이 숨겨지고 질문도 차단됩니다. 자료를 충분히 쌓은 뒤 공개하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-positive' : 'bg-line-strong'}`}
            aria-pressed={enabled}
          >
            <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-paper shadow-raised transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      )}

      <div className="mb-5 flex gap-2">
        {(['docs', 'pending', 'logs'] as const).map(sec => (
          <button
            key={sec}
            onClick={() => setSection(sec)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              section === sec ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2 hover:bg-line/60'
            }`}
          >
            {sec === 'docs' ? '자료 관리' : sec === 'pending' ? '미답변' : '질문 로그'}
            {sec === 'pending' && pendingCount > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                section === sec ? 'bg-paper text-ink' : 'bg-critical text-white'
              }`}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {section === 'docs' ? <DocsSection showToast={showToast} />
        : section === 'pending' ? <PendingSection showToast={showToast} onCount={setPendingCount} />
        : <LogsSection />}
    </div>
  );
}

// ───────────────────────── 자료 업로드 + 목록 ─────────────────────────
function DocsSection({ showToast }: { showToast: (msg: string) => void }) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<'lecture' | 'kakao'>('lecture');
  const [content, setContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // 수정 모드: 대상 자료 ID (null이면 신규 업로드)
  const [editingDoc, setEditingDoc] = useState<{ id: string; title: string } | null>(null);
  const [editLoading, setEditLoading] = useState<string | null>(null);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/qa?action=docs', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '자료 목록을 불러오지 못했습니다.');
        return;
      }
      setDocs(Array.isArray(data.docs) ? data.docs : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); }, []);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result || ''));
      if (!title) setTitle(file.name.replace(/\.(txt|md|csv)$/i, ''));
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!title.trim()) return showToast('자료 제목을 입력해주세요.');
    if (content.trim().length < 50) return showToast('자료 내용이 너무 짧습니다. (최소 50자)');
    setUploading(true);
    try {
      // 수정 모드면 원문 교체+재임베딩, 아니면 신규 업로드
      const url = editingDoc ? '/api/qa?action=update' : '/api/qa?action=ingest';
      const body = editingDoc
        ? { docId: editingDoc.id, title: title.trim(), content }
        : { title: title.trim(), sourceType, content };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '저장에 실패했습니다.');
      showToast(data.message || '저장 완료');
      setTitle('');
      setContent('');
      setEditingDoc(null);
      await fetchDocs();
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = async (doc: DocRow) => {
    setEditLoading(doc.id);
    try {
      const res = await fetch(`/api/qa?action=doc&docId=${doc.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '원문을 불러오지 못했습니다.');
      setEditingDoc({ id: doc.id, title: doc.title });
      setTitle(data.doc.title);
      setSourceType(data.doc.source_type === 'kakao' ? 'kakao' : 'lecture');
      setContent(data.doc.content);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setEditLoading(null);
    }
  };

  const cancelEdit = () => {
    setEditingDoc(null);
    setTitle('');
    setContent('');
  };

  const handleDelete = async (doc: DocRow) => {
    if (!confirm(`"${doc.title}" 자료를 삭제하시겠습니까?\n청크 ${doc.chunk_count}개가 함께 삭제되며 되돌릴 수 없습니다.`)) return;
    setDeleting(doc.id);
    try {
      const res = await fetch('/api/qa?action=delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ docId: doc.id }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '삭제에 실패했습니다.');
      showToast(data.message || '삭제됐습니다.');
      if (editingDoc?.id === doc.id) cancelEdit(); // 수정 중이던 자료가 삭제되면 편집 상태 해제
      await fetchDocs();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 업로드 폼 */}
      <div className="space-y-4 rounded-panel border border-line bg-paper p-6">
        <h3 className="flex items-center justify-between gap-1.5 text-[13px] font-semibold text-ink">
          <span className="flex items-center gap-1.5">
            {editingDoc
              ? <><Pencil className="h-4 w-4 text-accent" /> 자료 수정 — "{editingDoc.title}"</>
              : <><Upload className="h-4 w-4 text-accent" /> 자료 업로드</>}
          </span>
          {editingDoc && (
            <button onClick={cancelEdit} className="flex items-center gap-1 text-xs font-medium text-ink-3 transition-colors hover:text-ink">
              <X className="h-3.5 w-3.5" /> 수정 취소
            </button>
          )}
        </h3>
        {editingDoc && (
          <p className="rounded-control border border-accent-line bg-accent-soft px-3 py-2 text-xs text-accent">
            내용을 고친 뒤 [수정 저장]을 누르면 기존 청크를 지우고 새로 임베딩합니다. 제목도 함께 수정할 수 있습니다.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="자료 제목 (예: 3주차 — 쿠팡 광고 세팅)"
            className="rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSourceType('lecture')}
              disabled={!!editingDoc}
              className={`rounded-control border px-3 py-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                sourceType === 'lecture' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:border-accent-line'
              }`}
            >
              📚 강의 정리본
            </button>
            <button
              onClick={() => setSourceType('kakao')}
              disabled={!!editingDoc}
              className={`rounded-control border px-3 py-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                sourceType === 'kakao' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:border-accent-line'
              }`}
            >
              💬 카톡 Q&A
            </button>
          </div>
        </div>
        {sourceType === 'kakao' && (
          <p className="rounded-control border border-caution/30 bg-caution-soft px-3 py-2 text-xs text-caution">
            카톡 내보내기 원본의 수강생 이름·연락처·이메일은 서버에서 자동 마스킹됩니다. (훈프로 발화는 말투 학습용으로 유지)
          </p>
        )}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={8}
          placeholder="자료 내용을 붙여넣거나 아래에서 텍스트 파일을 선택하세요. 문단(빈 줄) 단위로 청크가 분할되므로 주제별로 문단을 나눠주시면 검색 품질이 좋아집니다."
          className="w-full rounded-control border border-line bg-paper px-3 py-2.5 font-mono text-[13px] text-ink outline-none transition-colors focus:border-accent"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="cursor-pointer text-xs text-ink-2 transition-colors hover:text-accent">
            <input type="file" accept=".txt,.md,.csv" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            📎 텍스트 파일(.txt/.md) 불러오기
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-3 tabular">{content.length.toLocaleString()}자</span>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {uploading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> 임베딩 중...</>
                : editingDoc
                  ? <><Save className="h-4 w-4" /> 수정 저장</>
                  : <><Upload className="h-4 w-4" /> 업로드</>}
            </button>
          </div>
        </div>
      </div>

      {/* 자료 목록 */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink">등록된 자료 ({docs.length})</h3>
          <button onClick={fetchDocs} className="flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink">
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </button>
        </div>
        {loading ? (
          <div className="py-10 text-center text-[13px] text-ink-3">불러오는 중...</div>
        ) : docs.length === 0 ? (
          <div className="rounded-panel border border-line bg-paper py-10 text-center text-[13px] text-ink-3">
            등록된 자료가 없습니다. 강의 정리본을 업로드하면 챗봇이 답변할 수 있습니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-panel border border-line bg-paper">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="border-b border-line bg-paper-2">
                <tr>
                  {['제목', '유형', '청크', '글자 수', '등록일', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {docs.map(doc => (
                  <tr key={doc.id} className="transition-colors hover:bg-paper-2">
                    <td className="px-4 py-3 font-medium text-ink">{doc.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        doc.source_type === 'kakao' ? 'bg-caution-soft text-caution' : 'bg-accent-soft text-accent'
                      }`}>
                        {doc.source_type === 'kakao' ? '💬 카톡' : '📚 강의'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-2 tabular">{doc.chunk_count}</td>
                    <td className="px-4 py-3 text-ink-2 tabular">{(doc.char_count || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-ink-3">{new Date(doc.created_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(doc)}
                          disabled={editLoading === doc.id}
                          className="p-1.5 text-ink-3 transition-colors hover:text-accent disabled:opacity-40"
                          title="내용 수정 (재업로드 없이 원문 편집)"
                        >
                          {editLoading === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleDelete(doc)}
                          disabled={deleting === doc.id}
                          className="p-1.5 text-ink-3 transition-colors hover:text-critical disabled:opacity-40"
                          title="자료 삭제"
                        >
                          {deleting === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── 질문 로그 ─────────────────────────
function LogsSection() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/qa?action=logs', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const stats = {
    total: logs.length,
    unmatched: logs.filter(l => !l.matched).length,
    up: logs.filter(l => l.feedback === 1).length,
    down: logs.filter(l => l.feedback === -1).length,
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
          <span className="flex items-center gap-1"><MessageSquareText className="h-3.5 w-3.5" /> 최근 {stats.total}건</span>
          <span>자료 없음 {stats.unmatched}건</span>
          <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5 text-positive" /> {stats.up}</span>
          <span className="flex items-center gap-1"><ThumbsDown className="h-3.5 w-3.5 text-critical" /> {stats.down}</span>
        </div>
        <button onClick={fetchLogs} className="flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink">
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[13px] text-ink-3">불러오는 중...</div>
      ) : logs.length === 0 ? (
        <div className="rounded-panel border border-line bg-paper py-10 text-center text-[13px] text-ink-3">아직 질문 기록이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="overflow-hidden rounded-card border border-line bg-paper">
              <button
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{log.question}</div>
                  <div className="mt-0.5 text-xs text-ink-3">
                    {log.users?.name || '(탈퇴 회원)'} · {new Date(log.created_at).toLocaleString('ko-KR')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!log.matched && <span className="rounded-full bg-caution-soft px-2 py-0.5 text-[11px] text-caution">자료 없음</span>}
                  {log.feedback === 1 && <ThumbsUp className="h-3.5 w-3.5 text-positive" />}
                  {log.feedback === -1 && <ThumbsDown className="h-3.5 w-3.5 text-critical" />}
                  {expanded === log.id ? <ChevronUp className="h-4 w-4 text-ink-3" /> : <ChevronDown className="h-4 w-4 text-ink-3" />}
                </div>
              </button>
              {expanded === log.id && (
                <div className="border-t border-line px-4 pb-4 pt-3">
                  <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{log.answer || '(답변 없음)'}</div>
                  {Array.isArray(log.sources) && log.sources.length > 0 && (
                    <div className="mt-2 text-[11px] text-ink-3">
                      출처: {log.sources.map(s => s.title).join(', ')} {log.model ? `· ${log.model}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 답 못 한 질문에 직접 답을 단다.
 *
 * 코칭AI가 모르면 예전에는 "단톡방에 물어보세요"로 끝났다. 정작 단톡방에서
 * 질문을 어려워하는 분들 때문에 만든 기능인데 같은 자리로 돌려보낸 셈이었다.
 * 여기 쌓인 질문에 답을 달면 질문자에게 메일과 앱 알림으로 간다.
 */
function PendingSection({ showToast, onCount }: { showToast: (m: string) => void; onCount: (n: number) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/qa?action=pending', { headers: { Authorization: `Bearer ${getToken()}` } });
      const data = await res.json();
      const list = Array.isArray(data.pending) ? data.pending : [];
      setRows(list);
      onCount(list.length);
    } catch {
      setRows([]);
    }
  };
  useEffect(() => { void load(); }, []);

  const send = async (id: string) => {
    const answer = (drafts[id] ?? '').trim();
    if (answer.length < 2) { showToast('답변 내용을 입력해주세요.'); return; }
    setSending(id);
    try {
      const res = await fetch('/api/qa?action=answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ id, answer }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { showToast(data.error ?? '전달하지 못했습니다.'); return; }
      // 메일이 안 갔어도 답변은 저장됐다. 그 차이를 그대로 알린다 —
      // '보냈습니다'로 뭉뚱그리면 안 간 걸 모른다.
      showToast(data.mailed
        ? '답변을 메일로 보냈습니다. 앱에서도 볼 수 있습니다.'
        : '답변을 저장했습니다. 메일은 나가지 않았지만 질문자가 앱에서 볼 수 있습니다.');
      setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch (e: any) {
      showToast(e?.message ?? '전달하지 못했습니다.');
    } finally {
      setSending(null);
    }
  };

  if (rows === null) {
    return <div className="flex items-center gap-2 py-12 text-ink-3"><Loader2 className="h-5 w-5 animate-spin" /><span className="text-[13px]">불러오는 중...</span></div>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold text-ink">답변 대기 {rows.length}건</h3>
        <button onClick={() => void load()} className="ml-auto flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink">
          <RefreshCw className="h-3.5 w-3.5" />새로고침
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-paper px-4 py-10 text-center text-[13px] text-ink-3">
          답변을 기다리는 질문이 없습니다. 코칭AI가 모르는 질문이 들어오면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(r => (
            <div key={r.id} className="rounded-card border border-line bg-paper p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[13px] font-semibold text-ink">{r.users?.name ?? '(탈퇴한 회원)'}</span>
                <span className="text-[11.5px] text-ink-3">{r.users?.email ?? ''}</span>
                <span className="ml-auto text-[11.5px] tabular-nums text-ink-3">
                  {new Date(r.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
              <p className="mb-3 whitespace-pre-wrap rounded-control border-l-2 border-accent-line bg-paper-2 px-3 py-2 text-[13.5px] leading-relaxed text-ink">
                {r.question}
              </p>
              <textarea
                value={drafts[r.id] ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                rows={4}
                placeholder="여기에 답변을 쓰면 질문자에게 메일과 앱 알림으로 전달됩니다."
                className="w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => void send(r.id)}
                  disabled={sending === r.id}
                  className="inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-paper disabled:opacity-50"
                >
                  {sending === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  답변 전달
                </button>
                {!r.users?.email && (
                  <span className="text-[11.5px] text-caution">메일 주소가 없어 앱 알림으로만 전달됩니다.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        코칭AI가 자료에서 근거를 못 찾은 질문만 모입니다. 답을 달면 질문자에게 메일이 가고, 앱 코칭AI 화면 위에도 뜹니다.
        같은 질문이 반복되면 [자료 관리]에 그 내용을 넣어두세요 — 다음부터는 AI가 바로 답합니다.
      </p>
    </div>
  );
}
