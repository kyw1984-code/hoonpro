import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Users, RefreshCw, CheckCheck, BarChart3, Image as ImageIcon, Save, AlertCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { UsageStats } from './UsageStats';
import { DEFAULT_IMAGE_SETTINGS, IMAGE_MODEL_OPTIONS, getImageModelOption, type ImageGenerationSettings } from '../../lib/imageModels';

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

export function AdminPanel() {
  const [tab, setTab] = useState<'users' | 'stats' | 'image-settings'>('users');
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
      const res = await fetch('/api/admin/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
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
      const res = await fetch('/api/admin/reset-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ userId }),
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
          onClick={() => setTab('image-settings')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'image-settings' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ImageIcon className="w-4 h-4" /> 이미지 모델 설정
        </button>
      </div>

      {tab === 'stats' ? <UsageStats /> : tab === 'image-settings' ? <ImageSettingsTab showToast={showToast} /> : <UsersTab
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

function ImageSettingsTab({ showToast }: { showToast: (message: string) => void }) {
  const [settings, setSettings] = useState<ImageGenerationSettings>(DEFAULT_IMAGE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const selected = getImageModelOption(settings.model);

  const fetchSettings = async () => {
    setLoading(true);
    setWarning(null);
    try {
      const res = await fetch('/api/admin/stats?mode=image-settings', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '이미지 설정을 불러오지 못했습니다.');
        return;
      }
      setSettings(data.settings || DEFAULT_IMAGE_SETTINGS);
      setWarning(data.warning || null);
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, []);

  const saveSettings = async () => {
    setSaving(true);
    setWarning(null);
    try {
      const option = getImageModelOption(settings.model);
      const nextSettings = { provider: option.provider, model: option.id };
      const res = await fetch('/api/admin/stats?mode=image-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ settings: nextSettings }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || '이미지 설정을 저장하지 못했습니다.');
        return;
      }
      setSettings(data.settings);
      showToast(data.message || '저장했습니다.');
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-slate-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      {warning && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">이미지 생성 모델</h2>
            <p className="text-sm text-slate-500 mt-1">여기서 선택한 모델이 썸네일 제작과 상세페이지 제작 이미지에 동일하게 적용됩니다.</p>
          </div>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            저장
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {IMAGE_MODEL_OPTIONS.map(option => {
            const active = settings.model === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSettings({ provider: option.provider, model: option.id })}
                className={`text-left rounded-2xl border p-4 transition-all ${
                  active ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 bg-white hover:border-blue-300'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className={`font-bold ${active ? 'text-blue-700' : 'text-slate-900'}`}>{option.label}</div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    option.provider === 'openai' ? 'bg-slate-900 text-white' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {option.provider}
                  </span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{option.description}</p>
                <p className="text-xs text-slate-500 mt-3 leading-relaxed">{option.costNote}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-slate-800 mb-3">현재 적용 및 예상비용 안내</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <InfoBox label="적용 모델" value={selected.label} />
          <InfoBox label="적용 범위" value="썸네일 + 상세페이지 이미지" />
          <InfoBox label="과금 방식" value={selected.provider === 'openai' ? '이미지 토큰 기준' : '토큰 사용량 추정'} />
        </div>
        <p className="text-xs text-slate-500 mt-4 leading-relaxed">
          OpenAI 공식 가격표 기준 GPT-Image-2는 이미지 입력 $8.00/1M tokens, 캐시 입력 $2.00/1M tokens, 이미지 출력 $30.00/1M tokens입니다.
          실제 비용은 프롬프트 길이, 레퍼런스 이미지 수, 출력 이미지 토큰량에 따라 달라집니다.
        </p>
        {selected.provider === 'openai' && (
          <p className="text-xs text-red-500 mt-2">
            Vercel 환경변수에 OPENAIAPIKEY가 등록되어 있어야 OpenAI 이미지 생성이 작동합니다.
          </p>
        )}
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-bold text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
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
                      <span>{user.today_calls} / 60</span>
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
