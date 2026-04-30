import React, { useState } from 'react';
import { Lock, UserPlus, LogIn } from 'lucide-react';
import { setToken } from '../../lib/auth';

interface Props {
  onSuccess: () => void;
}

type Mode = 'login' | 'signup';

export function AuthGate({ onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupEmail, setSignupEmail] = useState('');

  const handleLogin = async () => {
    if (!loginEmail.trim()) return setMessage({ text: '이메일을 입력해주세요.', type: 'error' });
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setToken(data.token);
      onSuccess();
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    if (!signupName.trim() || !signupPhone.trim() || !signupEmail.trim()) {
      return setMessage({ text: '모든 항목을 입력해주세요.', type: 'error' });
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: signupName.trim(), phone: signupPhone.trim(), email: signupEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setMessage({ text: data.message, type: 'success' });
      setSignupName(''); setSignupPhone(''); setSignupEmail('');
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-10 w-full max-w-sm flex flex-col items-center">
        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
          <Lock className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">쇼크트리 훈프로</h1>
        <p className="text-sm text-slate-500 mb-6">AI 자동화 프로그램</p>

        {/* 탭 */}
        <div className="flex w-full bg-slate-100 p-1 rounded-xl mb-6">
          <button
            onClick={() => { setMode('login'); setMessage(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'login' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
          >
            <LogIn className="w-4 h-4" /> 로그인
          </button>
          <button
            onClick={() => { setMode('signup'); setMessage(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'signup' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
          >
            <UserPlus className="w-4 h-4" /> 가입 신청
          </button>
        </div>

        {mode === 'login' ? (
          <div className="w-full space-y-3">
            <input
              type="email"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="이메일 주소"
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              autoFocus
            />
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
            >
              {loading ? '확인 중...' : '입장하기'}
            </button>
          </div>
        ) : (
          <div className="w-full space-y-3">
            <input
              type="text"
              value={signupName}
              onChange={e => setSignupName(e.target.value)}
              placeholder="성함"
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              autoFocus
            />
            <input
              type="tel"
              value={signupPhone}
              onChange={e => setSignupPhone(e.target.value)}
              placeholder="연락처 (예: 010-1234-5678)"
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <input
              type="email"
              value={signupEmail}
              onChange={e => setSignupEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSignup()}
              placeholder="이메일 주소"
              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button
              onClick={handleSignup}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors text-sm"
            >
              {loading ? '신청 중...' : '가입 신청하기'}
            </button>
          </div>
        )}

        {message && (
          <p className={`mt-4 text-sm text-center ${message.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
