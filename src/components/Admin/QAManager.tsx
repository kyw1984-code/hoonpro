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
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">훈프로에게 질문 — 지식 관리</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        강의 정리본을 업로드하면 자동으로 청크 분할·임베딩되어 수강생 질문 답변의 근거 자료로 사용됩니다.
        연락처·이메일 등 개인정보는 업로드 시 자동 마스킹됩니다.
      </p>

      <div className="flex gap-2 mb-5">
        {(['docs', 'logs'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              section === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <Upload className="w-4 h-4 text-blue-600" /> 자료 업로드
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="자료 제목 (예: 3주차 — 쿠팡 광고 세팅)"
            className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-400 outline-none text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSourceType('lecture')}
              className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                sourceType === 'lecture' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'
              }`}
            >
              📚 강의 정리본
            </button>
            <button
              onClick={() => setSourceType('kakao')}
              className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                sourceType === 'kakao' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'
              }`}
            >
              💬 카톡 Q&A
            </button>
          </div>
        </div>
        {sourceType === 'kakao' && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            카톡 내보내기 원본의 수강생 이름·연락처·이메일은 서버에서 자동 마스킹됩니다. (훈프로 발화는 말투 학습용으로 유지)
          </p>
        )}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={8}
          placeholder="자료 내용을 붙여넣거나 아래에서 텍스트 파일을 선택하세요. 문단(빈 줄) 단위로 청크가 분할되므로 주제별로 문단을 나눠주시면 검색 품질이 좋아집니다."
          className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-400 outline-none text-sm font-mono"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="text-xs text-slate-500 cursor-pointer hover:text-blue-600 transition-colors">
            <input type="file" accept=".txt,.md,.csv" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
            📎 텍스트 파일(.txt/.md) 불러오기
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{content.length.toLocaleString()}자</span>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-bold rounded-xl transition-colors"
            >
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> 임베딩 중...</> : <><Upload className="w-4 h-4" /> 업로드</>}
            </button>
          </div>
        </div>
      </div>

      {/* 자료 목록 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800">등록된 자료 ({docs.length})</h3>
          <button onClick={fetchDocs} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>
        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">
            등록된 자료가 없습니다. 강의 정리본을 업로드하면 챗봇이 답변할 수 있습니다.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['제목', '유형', '청크', '글자 수', '등록일', ''].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map(doc => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{doc.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        doc.source_type === 'kakao' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {doc.source_type === 'kakao' ? '💬 카톡' : '📚 강의'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{doc.chunk_count}</td>
                    <td className="px-4 py-3 text-slate-600">{(doc.char_count || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{new Date(doc.created_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(doc)}
                        disabled={deleting === doc.id}
                        className="p-1.5 text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
                        title="자료 삭제"
                      >
                        {deleting === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1"><MessageSquareText className="w-3.5 h-3.5" /> 최근 {stats.total}건</span>
          <span>자료 없음 {stats.unmatched}건</span>
          <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5 text-emerald-500" /> {stats.up}</span>
          <span className="flex items-center gap-1"><ThumbsDown className="w-3.5 h-3.5 text-red-400" /> {stats.down}</span>
        </div>
        <button onClick={fetchLogs} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">아직 질문 기록이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{log.question}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {log.users?.name || '(탈퇴 회원)'} · {new Date(log.created_at).toLocaleString('ko-KR')}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!log.matched && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[11px] rounded-full">자료 없음</span>}
                  {log.feedback === 1 && <ThumbsUp className="w-3.5 h-3.5 text-emerald-500" />}
                  {log.feedback === -1 && <ThumbsDown className="w-3.5 h-3.5 text-red-400" />}
                  {expanded === log.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </div>
              </button>
              {expanded === log.id && (
                <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                  <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{log.answer || '(답변 없음)'}</div>
                  {Array.isArray(log.sources) && log.sources.length > 0 && (
                    <div className="text-[11px] text-slate-400 mt-2">
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
