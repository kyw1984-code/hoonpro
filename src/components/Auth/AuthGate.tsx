import React, { useEffect, useState } from 'react';
import { Lock, UserPlus, LogIn, ShieldCheck } from 'lucide-react';
import { setToken } from '../../lib/auth';
import { certificationAvailable, requestCertification } from '../../lib/certification';

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

  // 서버 설정에 따라 가입 방식 전환: PASS 본인인증 / 이메일 인증코드 / 기본
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [emailCodeRequired, setEmailCodeRequired] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [signupCode, setSignupCode] = useState('');
  const [ageChecked, setAgeChecked] = useState(false);

  useEffect(() => {
    fetch('/api/auth/signup?action=config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(res => res.json())
      .then(data => {
        setVerificationRequired(Boolean(data.verificationRequired) && certificationAvailable());
        setEmailCodeRequired(Boolean(data.emailCodeRequired));
      })
      .catch(() => { setVerificationRequired(false); setEmailCodeRequired(false); });
  }, []);

  const handleSendCode = async () => {
    if (!signupEmail.trim()) return setMessage({ text: '이메일을 먼저 입력해주세요.', type: 'error' });
    setSendingCode(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/signup?action=send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: signupEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setCodeSent(true);
      setMessage({ text: data.message, type: 'success' });
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setSendingCode(false);
    }
  };

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
    if (verificationRequired) {
      if (!signupEmail.trim()) return setMessage({ text: '이메일을 입력해주세요.', type: 'error' });
    } else if (!signupName.trim() || !signupPhone.trim() || !signupEmail.trim()) {
      return setMessage({ text: '모든 항목을 입력해주세요.', type: 'error' });
    }
    if (emailCodeRequired && !verificationRequired) {
      if (!/^\d{6}$/.test(signupCode.trim())) return setMessage({ text: '이메일로 받은 6자리 인증코드를 입력해주세요.', type: 'error' });
      if (!ageChecked) return setMessage({ text: '만 14세 이상 확인에 동의해주세요.', type: 'error' });
    }
    setLoading(true);
    setMessage(null);
    try {
      // 본인인증 모드: PASS 인증 → imp_uid를 서버로 보내 CI 검증 후 즉시 가입 완료
      let impUid: string | undefined;
      if (verificationRequired) {
        try {
          impUid = await requestCertification();
        } catch (e: any) {
          return setMessage({ text: e?.message ?? '본인인증이 취소됐습니다.', type: 'error' });
        }
      }
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signupName.trim(),
          phone: signupPhone.trim(),
          email: signupEmail.trim().toLowerCase(),
          impUid,
          code: signupCode.trim() || undefined,
          ageConfirmed: ageChecked || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setMessage({ text: data.message, type: 'success' });
      setSignupName(''); setSignupPhone(''); setSignupEmail('');
      setSignupCode(''); setAgeChecked(false); setCodeSent(false);
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-5 py-12">
      <div className="w-full max-w-[380px]">
        {/* 브랜드 — 카드 밖에 두어 화면 전체가 하나의 표지처럼 읽히게 */}
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-card bg-ink">
            <Lock className="h-5 w-5 text-paper" />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">쇼크트리 훈프로</h1>
          <p className="mt-1 text-[13px] text-ink-3">셀러를 위한 AI 자동화 도구</p>
        </div>

        <div className="rounded-panel border border-line bg-paper p-7">
          {/* 탭 */}
          <div className="mb-6 flex gap-1 border-b border-line">
            <button
              onClick={() => { setMode('login'); setMessage(null); }}
              className={`-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[13px] transition-colors ${
                mode === 'login' ? 'border-ink font-semibold text-ink' : 'border-transparent font-medium text-ink-3 hover:text-ink'
              }`}
            >
              <LogIn className="h-4 w-4" /> 로그인
            </button>
            <button
              onClick={() => { setMode('signup'); setMessage(null); }}
              className={`-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[13px] transition-colors ${
                mode === 'signup' ? 'border-ink font-semibold text-ink' : 'border-transparent font-medium text-ink-3 hover:text-ink'
              }`}
            >
              <UserPlus className="h-4 w-4" /> 가입 신청
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
              className="w-full rounded-control border border-line bg-paper-2 px-3.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
              autoFocus
            />
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full rounded-control bg-ink py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {loading ? '확인 중...' : '입장하기'}
            </button>
          </div>
        ) : (
          <div className="w-full space-y-3">
            {!verificationRequired && (
              <>
                <input
                  type="text"
                  value={signupName}
                  onChange={e => setSignupName(e.target.value)}
                  placeholder="성함"
                  className="w-full rounded-control border border-line bg-paper-2 px-3.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
                  autoFocus
                />
                <input
                  type="tel"
                  value={signupPhone}
                  onChange={e => setSignupPhone(e.target.value)}
                  placeholder="연락처 (예: 010-1234-5678)"
                  className="w-full rounded-control border border-line bg-paper-2 px-3.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
                />
              </>
            )}
            <div className="flex gap-2">
              <input
                type="email"
                value={signupEmail}
                onChange={e => { setSignupEmail(e.target.value); setCodeSent(false); setSignupCode(''); }}
                onKeyDown={e => e.key === 'Enter' && (emailCodeRequired ? handleSendCode() : handleSignup())}
                placeholder="이메일 주소"
                className="w-full rounded-control border border-line bg-paper-2 px-3.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
                autoFocus={verificationRequired}
              />
              {emailCodeRequired && !verificationRequired && (
                <button
                  onClick={handleSendCode}
                  disabled={sendingCode || !signupEmail.trim()}
                  className="shrink-0 whitespace-nowrap rounded-control border border-line px-3 py-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
                >
                  {sendingCode ? '발송 중...' : codeSent ? '재발송' : '인증코드 받기'}
                </button>
              )}
            </div>
            {emailCodeRequired && !verificationRequired && codeSent && (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={signupCode}
                  onChange={e => setSignupCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleSignup()}
                  placeholder="인증코드 6자리"
                  className="w-full rounded-control border border-line bg-paper-2 px-3.5 py-2.5 text-center text-[15px] tracking-[0.4em] outline-none transition-colors placeholder:text-ink-3 placeholder:tracking-normal focus:border-accent focus:bg-paper"
                />
                <label className="flex cursor-pointer items-center gap-2 px-1 text-[12.5px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={ageChecked}
                    onChange={e => setAgeChecked(e.target.checked)}
                    className="h-3.5 w-3.5 accent-current"
                  />
                  만 14세 이상입니다.
                </label>
              </>
            )}
            <button
              onClick={handleSignup}
              disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 rounded-control bg-ink py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {verificationRequired && <ShieldCheck className="h-4 w-4" />}
              {loading
                ? (verificationRequired ? '인증 확인 중...' : '신청 중...')
                : (verificationRequired ? '휴대폰 본인인증하고 가입하기' : '가입 신청하기')}
            </button>
            {verificationRequired && (
              <p className="text-center text-[11px] leading-relaxed text-ink-3">
                이름·연락처는 PASS 본인인증 결과로 자동 입력됩니다.<br />1인 1계정만 가입할 수 있습니다.
              </p>
            )}
          </div>
        )}

          {message && (
            <p className={`mt-4 rounded-control px-3 py-2.5 text-center text-[13px] ${
              message.type === 'error' ? 'bg-critical-soft text-critical' : 'bg-positive-soft text-positive'
            }`}>
              {message.text}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-3">
          {verificationRequired
            ? '본인인증 완료 즉시 가입되며, 구독 후 모든 기능을 이용할 수 있습니다.'
            : '가입 신청 후 관리자 승인이 완료되면 이용하실 수 있습니다.'}
        </p>
      </div>
    </div>
  );
}
