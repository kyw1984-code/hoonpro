import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Users, RefreshCw, CheckCheck, BarChart3, Image as ImageIcon, Loader2, Save, AlertTriangle } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { USD_TO_KRW } from '../../lib/pricing';
import { UsageStats } from './UsageStats';

interface UserRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  today_calls: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '거절',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const DAILY_USAGE_LIMIT = 40;

export function AdminPanel() {
  const [tab, setTab] = useState<'users' | 'stats' | 'config'>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleAction = async (userId: string, action: 'approve' | 'reject') => {
    setActionLoading(userId + action);
    try {
      const res = await fetch('/api/admin/user-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ userId, action }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error);
      showToast(data.message);
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkApprove = async () => {
    if (counts.pending === 0) return showToast('승인 대기 중인 회원이 없습니다.');
    if (!confirm(`승인 대기 중인 ${counts.pending}명을 일괄 승인하시겠습니까?`)) return;
    setActionLoading('bulk-approve');
    try {
      const res = await fetch('/api/admin/user-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ action: 'bulk-approve' }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error);
      showToast(data.message);
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleReset = async (userId: string, userName: string) => {
    if (!confirm(`${userName}님의 오늘 사용 횟수를 리셋하시겠습니까?`)) return;
    setActionLoading(userId + 'reset');
    try {
      const res = await fetch('/api/admin/user-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ action: 'reset', userId }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error);
      showToast(data.message);
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = filter === 'all' ? users : users.filter(u => u.status === filter);
  const counts = {
    all: users.length,
    pending: users.filter(u => u.status === 'pending').length,
    approved: users.filter(u => u.status === 'approved').length,
    rejected: users.filter(u => u.status === 'rejected').length,
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* 탭 네비게이션 */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        <button
          onClick={() => setTab('users')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" /> 회원 관리
        </button>
        <button
          onClick={() => setTab('stats')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'stats' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> API 사용량 통계
        </button>
        <button
          onClick={() => setTab('config')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'config' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ImageIcon className="w-4 h-4" /> 이미지 설정
        </button>
      </div>

      {tab === 'stats' ? <UsageStats /> : tab === 'config' ? <ImageConfigTab showToast={showToast} /> : <UsersTab
        users={users}
        loading={loading}
        filter={filter}
        setFilter={setFilter}
        counts={counts}
        filtered={filtered}
        actionLoading={actionLoading}
        fetchUsers={fetchUsers}
        handleAction={handleAction}
        handleBulkApprove={handleBulkApprove}
        handleReset={handleReset}
      />}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

interface UsersTabProps {
  users: UserRow[];
  loading: boolean;
  filter: 'all' | 'pending' | 'approved' | 'rejected';
  setFilter: (f: 'all' | 'pending' | 'approved' | 'rejected') => void;
  counts: { all: number; pending: number; approved: number; rejected: number };
  filtered: UserRow[];
  actionLoading: string | null;
  fetchUsers: () => void;
  handleAction: (userId: string, action: 'approve' | 'reject') => void;
  handleBulkApprove: () => void;
  handleReset: (userId: string, userName: string) => void;
}

function UsersTab({ users, loading, filter, setFilter, counts, filtered, actionLoading, fetchUsers, handleAction, handleBulkApprove, handleReset }: UsersTabProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">회원 관리 ({users.length})</h2>
        </div>
        <button onClick={fetchUsers} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f === 'all' ? '전체' : STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
        <button
          onClick={handleBulkApprove}
          disabled={actionLoading === 'bulk-approve' || counts.pending === 0}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-full transition-colors"
        >
          <CheckCheck className="w-4 h-4" />
          대기 회원 일괄 승인 ({counts.pending})
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">회원이 없습니다.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['성함', '연락처', '이메일', '상태', '오늘 사용', '가입일', '관리'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">{user.name}</td>
                  <td className="px-4 py-3 text-slate-600">{user.phone}</td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[user.status]}`}>
                      {user.status === 'pending' && <Clock className="w-3 h-3" />}
                      {user.status === 'approved' && <CheckCircle className="w-3 h-3" />}
                      {user.status === 'rejected' && <XCircle className="w-3 h-3" />}
                      {STATUS_LABEL[user.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex items-center gap-2">
                      <span>{user.today_calls} / {DAILY_USAGE_LIMIT}</span>
                      <button
                        onClick={() => handleReset(user.id, user.name)}
                        disabled={actionLoading === user.id + 'reset' || user.today_calls === 0}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 text-xs rounded-md transition-colors"
                        title="오늘 사용 횟수 리셋"
                      >
                        리셋
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(user.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {user.status !== 'approved' && (
                        <button
                          onClick={() => handleAction(user.id, 'approve')}
                          disabled={actionLoading === user.id + 'approve'}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                        >
                          승인
                        </button>
                      )}
                      {user.status !== 'rejected' && (
                        <button
                          onClick={() => handleAction(user.id, 'reject')}
                          disabled={actionLoading === user.id + 'reject'}
                          className="px-3 py-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                        >
                          거절
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 이미지 모델/품질 설정 탭 ─────────────────────────
const MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'GPT Image 2 (최신 권장)', desc: '최신 GPT Image · 다양한 해상도 · 품질/비용 균형' },
  { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2 (고정 버전)', desc: '동일 세대 날짜 고정 버전 · 재현성 관리용' },
  { value: 'gpt-image-1.5', label: 'GPT Image 1.5 (이전 고품질)', desc: '프롬프트 준수 우수 · 기존 안정 버전' },
  { value: 'gpt-image-1-mini', label: 'GPT Image 1 Mini (저비용)', desc: '비용 절감용 · 대량 초안 생성에 적합' },
  { value: 'gpt-image-1', label: 'GPT Image 1 (구버전)', desc: '2026-10-23 폐기 예정' },
  { value: 'chatgpt-image-latest', label: 'ChatGPT Image Latest', desc: 'ChatGPT 이미지 계열 최신 alias · 변경 가능성 있음' },
  { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image (Nano Banana 2)', desc: 'Gemini 최신 고효율 이미지 · 선택 시 카피/기획도 Gemini로 처리' },
  { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image (Nano Banana Pro)', desc: 'Gemini 고품질 이미지 · 복잡한 지시/텍스트/제품 연출에 강함' },
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', desc: '빠른 이미지 생성/편집 · 기존 Nano Banana 계열' },
  { value: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image Preview', desc: '프리뷰 호환용 · 가능하면 안정 버전 권장' },
];
const QUALITY_OPTIONS = [
  { value: 'low', label: '낮음 (저비용)' },
  { value: 'medium', label: '보통 (비용 절감)' },
  { value: 'high', label: '높음 (상세페이지 권장)' },
];
// 장당 예상 비용(USD, 1024×1536 세로 기준 근사치)
const COST_TABLE: Record<string, Record<string, number>> = {
  'gpt-image-2': { low: 0.005, medium: 0.041, high: 0.165 },
  'gpt-image-2-2026-04-21': { low: 0.005, medium: 0.041, high: 0.165 },
  'gpt-image-1.5': { low: 0.013, medium: 0.05, high: 0.2 },
  'gpt-image-1-mini': { low: 0.006, medium: 0.015, high: 0.052 },
  'gpt-image-1': { low: 0.016, medium: 0.063, high: 0.25 },
  'chatgpt-image-latest': { low: 0.013, medium: 0.05, high: 0.2 },
  'gemini-3.1-flash-image': { low: 0.02, medium: 0.04, high: 0.08 },
  'gemini-3-pro-image': { low: 0.04, medium: 0.08, high: 0.16 },
  'gemini-2.5-flash-image': { low: 0.02, medium: 0.039, high: 0.08 },
  'gemini-2.5-flash-image-preview': { low: 0.02, medium: 0.039, high: 0.08 },
};

function ImageConfigTab({ showToast }: { showToast: (msg: string) => void }) {
  const [imageModel, setImageModel] = useState('gpt-image-2');
  const [imageQuality, setImageQuality] = useState('high');
  const [aiIntegratedTextEnabled, setAiIntegratedTextEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [migrated, setMigrated] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/config', { headers: { Authorization: `Bearer ${getToken()}` } });
        const data = await res.json();
        if (res.ok) {
          setImageModel(data.imageModel);
          setImageQuality(data.imageQuality);
          setAiIntegratedTextEnabled(data.aiIntegratedTextEnabled === true);
          setMigrated(data.migrated !== false);
        } else {
          showToast(data.error || '설정을 불러오지 못했습니다.');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ imageModel, imageQuality, aiIntegratedTextEnabled }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error);
      showToast(data.message || '저장됐습니다.');
    } finally {
      setSaving(false);
    }
  };

  const costUsd = COST_TABLE[imageModel]?.[imageQuality] ?? 0;
  const costKrw = Math.round(costUsd * USD_TO_KRW);

  if (loading) return <div className="text-center py-16 text-slate-400">불러오는 중...</div>;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">AI 생성 모델 설정</h2>
      </div>
      <p className="text-sm text-slate-500 mb-6">선택한 모델 계열은 <b>모든 사용자</b>의 카피, 기획안, 이미지 생성에 동일하게 적용됩니다. GPT 선택 시 GPT, Gemini 선택 시 Gemini로 전체 작업이 처리됩니다.</p>

      {!migrated && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl px-4 py-3 mb-5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span><b>app_config 테이블이 없습니다.</b> Supabase에서 <code>supabase-schema.sql</code> 마이그레이션을 먼저 실행하세요. (지금은 기본값으로 동작합니다.)</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">AI 모델 계열</label>
          <div className="space-y-2">
            {MODEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setImageModel(opt.value)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${imageModel === opt.value ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}`}
              >
                <div className={`font-bold text-sm ${imageModel === opt.value ? 'text-blue-700' : 'text-slate-800'}`}>{opt.label}</div>
                <div className="text-xs text-slate-500">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">품질</label>
          <div className="grid grid-cols-3 gap-2">
            {QUALITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setImageQuality(opt.value)}
                className={`p-3 rounded-xl border text-sm font-medium transition-all ${imageQuality === opt.value ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-700 hover:border-blue-300'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm">
          <span className="text-slate-500">장당 예상 비용 (세로 1024×1536 기준): </span>
          <span className="font-bold text-slate-900">약 ${costUsd.toFixed(3)} / 장 (₩{costKrw.toLocaleString('ko-KR')})</span>
          <p className="text-xs text-slate-400 mt-1">12~15장 1페이지 기준 약 ${(costUsd * 13).toFixed(2)} 내외. GPT 모델은 OpenAI로, Gemini 모델은 Gemini API로 카피/기획/이미지가 모두 처리됩니다.</p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <div className="text-sm font-bold text-slate-900">AI 통합 텍스트 실험 허용</div>
            <p className="mt-1 text-xs text-slate-500">OFF이면 제작 화면에서 실험 모드가 잠기고 안전 모드만 사용할 수 있습니다.</p>
          </div>
          <button
            type="button"
            onClick={() => setAiIntegratedTextEnabled(v => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${aiIntegratedTextEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
            aria-pressed={aiIntegratedTextEnabled}
          >
            <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${aiIntegratedTextEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중...</> : <><Save className="w-4 h-4" /> 저장</>}
        </button>
        <p className="text-xs text-slate-400 text-center">변경 후 모든 사용자에게 약 45초 이내 반영됩니다.</p>
      </div>
    </div>
  );
}
