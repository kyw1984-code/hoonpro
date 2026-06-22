import React, { useEffect, useState } from 'react';
import { Users, RefreshCw, Trash2, Plus, Minus, CheckCircle, XCircle, Clock, Check, X } from 'lucide-react';
import { getToken } from '../../lib/auth';

type Status = 'pending' | 'approved' | 'rejected';

interface UserRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  trial_started_at: string;
  trial_expires_at: string;
  created_at: string;
  remaining_days: number;
  is_expired: boolean;
  status: Status;
  approved_at: string | null;
}

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

export function AdminPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('pending');
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
    setTimeout(() => setToast(null), 2500);
  };

  const callAction = async (
    url: string,
    body: Record<string, unknown>,
    loadingKey: string,
  ) => {
    setActionLoading(loadingKey);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error);
      showToast(data.message);
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = (userId: string) =>
    callAction('/api/admin/approve-user', { userId }, userId + 'apr');

  const handleReject = (userId: string, name: string) => {
    if (!confirm(`${name} 회원의 가입을 거절하시겠습니까?`)) return;
    return callAction('/api/admin/reject-user', { userId }, userId + 'rej');
  };

  const handleExtend = (userId: string, days: number) =>
    callAction('/api/admin/extend-trial', { userId, days }, userId + 'ext' + days);

  const handleDelete = (userId: string, name: string) => {
    if (!confirm(`${name} 회원을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    return callAction('/api/admin/delete-user', { userId }, userId + 'del');
  };

  const counts = {
    pending: users.filter(u => u.status === 'pending').length,
    approved: users.filter(u => u.status === 'approved').length,
    rejected: users.filter(u => u.status === 'rejected').length,
    all: users.length,
  };

  const filtered = filter === 'all' ? users : users.filter(u => u.status === filter);

  const statusBadge = (u: UserRow) => {
    if (u.status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
          <Clock className="w-3 h-3" /> 승인 대기
        </span>
      );
    }
    if (u.status === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">
          <X className="w-3 h-3" /> 거절됨
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
          u.is_expired ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}
      >
        {u.is_expired ? <><XCircle className="w-3 h-3" /> 만료</> : <><CheckCircle className="w-3 h-3" /> 체험 중</>}
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">체험 회원 관리 ({users.length})</h2>
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        {([
          { k: 'pending', label: '승인 대기' },
          { k: 'approved', label: '승인됨' },
          { k: 'rejected', label: '거절됨' },
          { k: 'all', label: '전체' },
        ] as const).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === k
                ? k === 'pending' && counts.pending > 0
                  ? 'bg-amber-500 text-white'
                  : 'bg-blue-600 text-white'
                : k === 'pending' && counts.pending > 0
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label} ({counts[k]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">표시할 회원이 없습니다.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['성함', '연락처', '이메일', '가입일', '체험 만료', '상태', '관리'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(user => {
                const expiresDate = new Date(user.trial_expires_at);
                const isPending = user.status === 'pending';
                const isApproved = user.status === 'approved';
                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{user.name}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{user.phone}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{user.email}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {new Date(user.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {isApproved ? (
                        <>
                          {expiresDate.toLocaleDateString('ko-KR')}
                          <span className={`ml-2 ${user.is_expired ? 'text-red-500' : user.remaining_days <= 2 ? 'text-amber-600' : 'text-slate-400'}`}>
                            ({user.is_expired ? '만료' : `${user.remaining_days}일`})
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{statusBadge(user)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        {isPending && (
                          <>
                            <button
                              onClick={() => handleApprove(user.id)}
                              disabled={actionLoading === user.id + 'apr'}
                              className="flex items-center gap-1 px-2.5 py-1 bg-green-50 hover:bg-green-100 disabled:opacity-50 text-green-700 text-xs rounded-lg transition-colors font-medium"
                              title="승인 (7일 체험 시작)"
                            >
                              <Check className="w-3 h-3" /> 승인
                            </button>
                            <button
                              onClick={() => handleReject(user.id, user.name)}
                              disabled={actionLoading === user.id + 'rej'}
                              className="flex items-center gap-1 px-2.5 py-1 bg-orange-50 hover:bg-orange-100 disabled:opacity-50 text-orange-700 text-xs rounded-lg transition-colors font-medium"
                              title="거절"
                            >
                              <X className="w-3 h-3" /> 거절
                            </button>
                          </>
                        )}
                        {isApproved && (
                          <>
                            <button
                              onClick={() => handleExtend(user.id, 7)}
                              disabled={actionLoading === user.id + 'ext7'}
                              className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs rounded-lg transition-colors"
                              title="체험 기간 7일 연장"
                            >
                              <Plus className="w-3 h-3" /> 7일
                            </button>
                            <button
                              onClick={() => handleExtend(user.id, 30)}
                              disabled={actionLoading === user.id + 'ext30'}
                              className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 text-xs rounded-lg transition-colors"
                              title="체험 기간 30일 연장"
                            >
                              <Plus className="w-3 h-3" /> 30일
                            </button>
                            <button
                              onClick={() => handleExtend(user.id, -7)}
                              disabled={actionLoading === user.id + 'ext-7'}
                              className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-700 text-xs rounded-lg transition-colors"
                              title="체험 기간 7일 단축"
                            >
                              <Minus className="w-3 h-3" /> 7일
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(user.id, user.name)}
                          disabled={actionLoading === user.id + 'del'}
                          className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 text-xs rounded-lg transition-colors"
                          title="회원 삭제"
                        >
                          <Trash2 className="w-3 h-3" /> 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
