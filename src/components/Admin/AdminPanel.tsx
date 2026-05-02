import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Users, RefreshCw } from 'lucide-react';
import { getToken } from '../../lib/auth';

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

  const filtered = filter === 'all' ? users : users.filter(u => u.status === filter);
  const counts = {
    all: users.length,
    pending: users.filter(u => u.status === 'pending').length,
    approved: users.filter(u => u.status === 'approved').length,
    rejected: users.filter(u => u.status === 'rejected').length,
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">회원 관리</h2>
        </div>
        <button onClick={fetchUsers} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-2 mb-5">
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
                  <td className="px-4 py-3 text-slate-600">{user.today_calls} / 30</td>
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

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
