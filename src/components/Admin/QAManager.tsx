import React, { useEffect, useState } from 'react';
import { BookOpen, Upload, Trash2, Loader2, RefreshCw, MessageSquareText, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp } from 'lucide-react';
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
  const [section, setSection] = useState<'docs' | 'logs'>('docs');

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-semibold text-ink">훈프로에게 질문 — 지식 관리</h2>
      </div>
      <p className="mb-5 text-[13px] text-ink-2">
        강의 정리본을 업로드하면 자동으로 청크 분할·임베딩되어 수강생 질문 답변의 근거 자료로 사용됩니다.
        연락처·이메일 등 개인정보는 업로드 시 자동 마스킹됩니다.
      </p>

      <div className="mb-5 flex gap-2">
        {(['docs', 'logs'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              section === s ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2 hover:bg-line/60'
            }`}
          >
            {s === 'docs' ? '자료 관리' : '질문 로그'}
          </button>
        ))}
      </div>

      {section === 'docs' ? <DocsSection showToast={showToast} /> : <LogsSection />}
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
      const res = await fetch('/api/qa?action=ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ title: title.trim(), sourceType, content }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '업로드에 실패했습니다.');
      showToast(data.message || '업로드 완료');
      setTitle('');
      setContent('');
      await fetchDocs();
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
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
      await fetchDocs();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 업로드 폼 */}
      <div className="space-y-4 rounded-panel border border-line bg-paper p-6">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Upload className="h-4 w-4 text-accent" /> 자료 업로드
        </h3>
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
              className={`rounded-control border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                sourceType === 'lecture' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:border-accent-line'
              }`}
            >
              📚 강의 정리본
            </button>
            <button
              onClick={() => setSourceType('kakao')}
              className={`rounded-control border px-3 py-2.5 text-[13px] font-medium transition-colors ${
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
              {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> 임베딩 중...</> : <><Upload className="h-4 w-4" /> 업로드</>}
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
            <table className="w-full text-[13px]">
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
                      <button
                        onClick={() => handleDelete(doc)}
                        disabled={deleting === doc.id}
                        className="p-1.5 text-ink-3 transition-colors hover:text-critical disabled:opacity-40"
                        title="자료 삭제"
                      >
                        {deleting === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
