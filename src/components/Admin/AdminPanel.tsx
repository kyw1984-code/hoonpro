import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Users, RefreshCw, CheckCheck, BarChart3, Image as ImageIcon, Loader2, Save, AlertTriangle, CreditCard, BookOpen, ArrowUp, ArrowDown, ListOrdered, Building2 } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { USD_TO_KRW } from '../../lib/pricing';
import { UsageStats } from './UsageStats';
import { BillingAdmin } from './BillingAdmin';
import { QAManager } from './QAManager';
import { CompanyInfoConfig } from './CompanyInfoConfig';

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
  pending: 'bg-caution-soft text-caution',
  approved: 'bg-positive-soft text-positive',
  rejected: 'bg-critical-soft text-critical',
};

const DAILY_USAGE_LIMIT = 40;

export function AdminPanel() {
  const [tab, setTab] = useState<'users' | 'billing' | 'stats' | 'config' | 'taborder' | 'company' | 'qa'>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin?action=users', {
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
      const res = await fetch('/api/admin?action=user-action', {
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
      const res = await fetch('/api/admin?action=user-action', {
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
      const res = await fetch('/api/admin?action=user-action', {
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
      {/* 모바일: 탭이 많아 가로로 넘치므로 스크롤 처리 (라벨은 줄바꿈 금지) */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line -mx-6 px-6 sm:mx-0 sm:px-0">
        <button
          onClick={() => setTab('users')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'users' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <Users className="w-4 h-4" /> 회원 관리
        </button>
        <button
          onClick={() => setTab('billing')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'billing' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <CreditCard className="w-4 h-4" /> 구독·쿠폰
        </button>
        <button
          onClick={() => setTab('stats')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'stats' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> API 사용량 통계
        </button>
        <button
          onClick={() => setTab('config')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'config' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <ImageIcon className="w-4 h-4" /> 이미지 설정
        </button>
        <button
          onClick={() => setTab('taborder')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'taborder' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <ListOrdered className="w-4 h-4" /> 탭 순서
        </button>
        <button
          onClick={() => setTab('company')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'company' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <Building2 className="w-4 h-4" /> 사업자 정보
        </button>
        <button
          onClick={() => setTab('qa')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'qa' ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink'
          }`}
        >
          <BookOpen className="w-4 h-4" /> 지식 관리
        </button>
      </div>

      {tab === 'stats' ? <UsageStats /> : tab === 'billing' ? <BillingAdmin showToast={showToast} /> : tab === 'company' ? <CompanyInfoConfig showToast={showToast} /> : tab === 'qa' ? <QAManager showToast={showToast} /> : tab === 'config' ? (
        <ImageConfigTab showToast={showToast} />
      ) : tab === 'taborder' ? (
        <TabOrderConfig showToast={showToast} />
      ) : <UsersTab
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-paper text-sm px-5 py-3 rounded-card shadow-raised z-50">
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
          <Users className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-ink">회원 관리 ({users.length})</h2>
        </div>
        <button onClick={fetchUsers} className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink transition-colors">
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
              className={`rounded-control px-3 py-1.5 text-[13px] font-medium transition-colors ${
                filter === f ? 'bg-accent text-paper' : 'bg-paper-2 text-ink-2 hover:bg-line'
              }`}
            >
              {f === 'all' ? '전체' : STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
        <button
          onClick={handleBulkApprove}
          disabled={actionLoading === 'bulk-approve' || counts.pending === 0}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-positive hover:bg-positive disabled:opacity-40 disabled:cursor-not-allowed text-paper text-sm font-medium rounded-full transition-colors"
        >
          <CheckCheck className="w-4 h-4" />
          대기 회원 일괄 승인 ({counts.pending})
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-3">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-ink-3">회원이 없습니다.</div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-paper">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-paper-2 border-b border-line">
              <tr>
                {['성함', '연락처', '이메일', '상태', '오늘 사용', '가입일', '관리'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-2 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-paper-2 transition-colors">
                  <td className="px-4 py-3 font-medium text-ink">{user.name}</td>
                  <td className="px-4 py-3 text-ink-2">{user.phone}</td>
                  <td className="px-4 py-3 text-ink-2">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[user.status]}`}>
                      {user.status === 'pending' && <Clock className="w-3 h-3" />}
                      {user.status === 'approved' && <CheckCircle className="w-3 h-3" />}
                      {user.status === 'rejected' && <XCircle className="w-3 h-3" />}
                      {STATUS_LABEL[user.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-2">
                    <div className="flex items-center gap-2">
                      <span>{user.today_calls} / {DAILY_USAGE_LIMIT}</span>
                      <button
                        onClick={() => handleReset(user.id, user.name)}
                        disabled={actionLoading === user.id + 'reset' || user.today_calls === 0}
                        className="px-2 py-0.5 bg-paper-2 hover:bg-line disabled:opacity-40 disabled:cursor-not-allowed text-ink text-xs rounded-control transition-colors"
                        title="오늘 사용 횟수 리셋"
                      >
                        리셋
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-2 text-xs">
                    {new Date(user.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {user.status !== 'approved' && (
                        <button
                          onClick={() => handleAction(user.id, 'approve')}
                          disabled={actionLoading === user.id + 'approve'}
                          className="px-3 py-1 bg-positive hover:bg-positive disabled:opacity-50 text-paper text-xs rounded-control transition-colors"
                        >
                          승인
                        </button>
                      )}
                      {user.status !== 'rejected' && (
                        <button
                          onClick={() => handleAction(user.id, 'reject')}
                          disabled={actionLoading === user.id + 'reject'}
                          className="px-3 py-1 bg-critical hover:bg-critical disabled:opacity-50 text-paper text-xs rounded-control transition-colors"
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

// ─── 탭 순서 설정 — App.tsx TABS와 id·라벨이 일치해야 함 ─────────────────────
const TAB_LABELS: { id: string; label: string }[] = [
  { id: 'home', label: '홈' },
  { id: 'thumbnail', label: '썸네일 제작' },
  { id: 'detail', label: '상세페이지 제작' },
  { id: 'sourcing', label: '훈프로 소싱AI' },
  { id: 'ranktracker', label: '순위 추적' },
  { id: 'review', label: '리뷰 분석' },
  { id: 'analyzer', label: '광고 성과 분석' },
  { id: 'qa', label: '훈프로 코칭AI' },
  { id: 'works', label: '내 작업' },
];

function TabOrderConfig({ showToast }: { showToast: (msg: string) => void }) {
  const defaultOrder = TAB_LABELS.map(t => t.id);
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin?action=config', { headers: { Authorization: `Bearer ${getToken()}` } });
        const data = await res.json();
        if (res.ok && Array.isArray(data.tabOrder) && data.tabOrder.length > 0) {
          // 저장된 순서 + 이후 추가된 새 탭은 뒤에 이어붙임
          const saved = data.tabOrder.filter((id: string) => defaultOrder.includes(id));
          setOrder([...saved, ...defaultOrder.filter(id => !saved.includes(id))]);
        }
      } catch { /* 기본 순서 유지 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setOrder(next);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin?action=config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ tabOrder: order }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '저장 실패');
      localStorage.setItem('hoonpro_tab_order', JSON.stringify(order));
      setDirty(false);
      showToast('탭 순서가 저장됐습니다. 사용자는 새로고침 시 적용됩니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-2">
        <ListOrdered className="w-5 h-5 text-accent" />
        <h2 className="text-lg font-semibold text-ink">탭 순서 설정</h2>
      </div>
      <p className="text-sm text-ink-2 mb-5">
        상단 탭이 <b>모든 사용자</b>에게 이 순서로 표시됩니다. '훈프로 코칭AI'는 공개 OFF 상태면 수강생에게 숨겨진 채 순서만 유지됩니다.
      </p>
      <div className="bg-paper rounded-card border border-line overflow-hidden">
        {order.map((id, idx) => {
          const label = TAB_LABELS.find(t => t.id === id)?.label || id;
          return (
            <div key={id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <span className="w-6 text-center font-mono text-[12px] text-ink-3 tabular-nums">{idx + 1}</span>
              <span className="flex-1 text-sm font-medium text-ink">{label}</span>
              <button onClick={() => move(idx, -1)} disabled={idx === 0}
                className="rounded-control border border-line p-1.5 text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-30">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1}
                className="rounded-control border border-line p-1.5 text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-30">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <button onClick={handleSave} disabled={saving || !dirty}
        className="mt-4 flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        순서 저장
      </button>
    </div>
  );
}

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
        const res = await fetch('/api/admin?action=config', { headers: { Authorization: `Bearer ${getToken()}` } });
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
      const res = await fetch('/api/admin?action=config', {
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

  if (loading) return <div className="text-center py-16 text-ink-3">불러오는 중...</div>;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="w-5 h-5 text-accent" />
        <h2 className="text-lg font-semibold text-ink">AI 생성 모델 설정</h2>
      </div>
      <p className="text-sm text-ink-2 mb-6">선택한 모델 계열은 <b>모든 사용자</b>의 카피, 기획안, 이미지 생성에 동일하게 적용됩니다. GPT 선택 시 GPT, Gemini 선택 시 Gemini로 전체 작업이 처리됩니다.</p>

      {!migrated && (
        <div className="flex items-start gap-2 bg-caution-soft border border-caution/30 text-caution text-sm rounded-card px-4 py-3 mb-5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span><b>app_config 테이블이 없습니다.</b> Supabase에서 <code>supabase-schema.sql</code> 마이그레이션을 먼저 실행하세요. (지금은 기본값으로 동작합니다.)</span>
        </div>
      )}

      <div className="bg-paper rounded-card border border-line p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-ink mb-2">AI 모델 계열</label>
          <div className="space-y-2">
            {MODEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setImageModel(opt.value)}
                className={`w-full text-left p-3 rounded-card border transition-all ${imageModel === opt.value ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line hover:border-accent-line'}`}
              >
                <div className={`font-semibold text-sm ${imageModel === opt.value ? 'text-accent' : 'text-ink'}`}>{opt.label}</div>
                <div className="text-xs text-ink-2">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-2">품질</label>
          <div className="grid grid-cols-3 gap-2">
            {QUALITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setImageQuality(opt.value)}
                className={`p-3 rounded-card border text-sm font-medium transition-all ${imageQuality === opt.value ? 'border-accent bg-accent-soft text-accent ring-1 ring-accent' : 'border-line text-ink hover:border-accent-line'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-paper-2 rounded-card px-4 py-3 text-sm">
          <span className="text-ink-2">장당 예상 비용 (세로 1024×1536 기준): </span>
          <span className="font-semibold text-ink">약 ${costUsd.toFixed(3)} / 장 (₩{costKrw.toLocaleString('ko-KR')})</span>
          <p className="text-xs text-ink-3 mt-1">12~15장 1페이지 기준 약 ${(costUsd * 13).toFixed(2)} 내외. GPT 모델은 OpenAI로, Gemini 모델은 Gemini API로 카피/기획/이미지가 모두 처리됩니다.</p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-accent hover:bg-accent-hover disabled:bg-line-strong text-paper font-medium py-3 rounded-card flex items-center justify-center gap-2 transition-colors"
        >
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중...</> : <><Save className="w-4 h-4" /> 저장</>}
        </button>
        <p className="text-xs text-ink-3 text-center">변경 후 모든 사용자에게 약 45초 이내 반영됩니다.</p>
      </div>
    </div>
  );
}
