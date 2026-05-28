import React, { useEffect, useState } from 'react';
import { Users, RefreshCw, Clock, Trash2, Plus, Minus, CheckCircle, XCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';

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
}

export function AdminPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'expired'>('all');
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

  const handleExtend = async (userId: string, days: number) => {
    setActionLoading(userId + 'ext' + days);
    try {
      const res = await fetch('/api/admin/extend-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ userId, days }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error);
      showToast(data.message);
      await fetchUsers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (userId: string, name: string) => {
    if (!confirm(`${name} 회원을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    setActionLoading(userId + 'del');
    try {
      const res = await fetch('/api/admin/delete-user', {
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

  const counts = {
    all: users.length,
    active: users.filter(u => !u.is_expired).length,
    expired: users.filter(u => u.is_expired).length,
  };
  const filtered = filter === 'all'
    ? users
    : filter === 'active'
      ? users.filter(u => !u.is_expired)
      : users.filter(u => u.is_expired);

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
          { k: 'all', label: '전체' },
          { k: 'active', label: '체험 중' },
          { k: 'expired', label: '만료' },
        ] as const).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                return (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{user.name}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{user.phone}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{user.email}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {new Date(user.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {expiresDate.toLocaleDateString('ko-KR')}
                      <span className={`ml-2 ${user.is_expired ? 'text-red-500' : user.remaining_days <= 2 ? 'text-amber-600' : 'text-slate-400'}`}>
                        ({user.is_expired ? '만료' : `${user.remaining_days}일`})
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.is_expired ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {user.is_expired
                          ? <><XCircle className="w-3 h-3" /> 만료</>
                          : <><CheckCircle className="w-3 h-3" /> 체험 중</>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
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
