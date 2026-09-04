import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Lock, UserPlus, LogIn, ShieldCheck, ArrowRight, Sparkles, Activity,
  TrendingUp, Image as ImageIcon, LayoutTemplate, ListOrdered, MessageSquareText,
  BarChart3, MessageCircleQuestion, ChevronRight, Youtube, ExternalLink,
  KeyRound, ArrowLeft, Mail, Check,
} from 'lucide-react';
import { setToken } from '../../lib/auth';
import { certificationAvailable, requestCertification } from '../../lib/certification';
import { loadCachedCompany, fetchCompanyInfo, type CompanyInfo } from '../../lib/company';

interface Props {
  onSuccess: () => void;
}

type Mode = 'login' | 'signup';

/* ────────────────────────────────────────────────────────────────
 * 로그인 전 랜딩 (다크 테크)
 * - 미로그인 사용자에게 훈프로의 8가지 AI 도구를 라이브 데모처럼 보여주고
 *   그대로 로그인/가입까지 진행시킨다.
 * - 기존 API 호출 로직 100% 유지 (login / send-code / signup / PASS)
 * ──────────────────────────────────────────────────────────────── */

/* --- 라이브 데모: 소싱AI가 발굴한 상품 롤링 --- */
const DEMO_PRODUCTS = [
  { cat: 'SEASONAL · 가전', name: '초음파 대용량 가습기 5.5L',   price: '32,900원', q: '29,940', comp: '중간', trend: '+42%', score: 86 },
  { cat: 'OUTDOOR · 가방',  name: '경량 등산 백팩 40L 방수',     price: '58,000원', q: '15,280', comp: '낮음', trend: '+28%', score: 78 },
  { cat: 'HOME · 침구',     name: '극세사 겨울 담요 초대형',     price: '24,900원', q: '13,850', comp: '높음', trend: '+15%', score: 71 },
  { cat: 'SEASONAL · 가전', name: '전기장판 세탁가능 프리미엄',  price: '79,000원', q: '10,880', comp: '중간', trend: '+51%', score: 88 },
  { cat: 'OUTDOOR · 의류',  name: '고어텍스 등산복 자켓 방풍',   price: '149,000원', q: '10,010', comp: '높음', trend: '+9%',  score: 64 },
];

const KEYWORDS = [
  { t: '가습기',     n: '29,940', tag: 'HOT',      hot: true,  up: true },
  { t: '등산가방',   n: '15,280', tag: 'TREND',    up: true },
  { t: '담요',       n: '13,850', tag: 'SEASON' },
  { t: '전기장판',   n: '10,880', tag: 'HOT',      hot: true,  up: true },
  { t: '등산복',     n: '10,010', tag: 'TREND',    up: true },
  { t: '등산배낭',   n: '7,330',  tag: 'CATEGORY' },
  { t: '히터',       n: '6,610',  tag: 'SEASON',   up: true },
  { t: '온수매트',   n: '8,140',  tag: 'HOT',      hot: true },
];

const KEYWORD_SPOTS = [
  { x: 82, y: 6 }, { x: 92, y: 24 }, { x: 78, y: 44 },
  { x: 4,  y: 58 }, { x: 88, y: 60 }, { x: 2,  y: 82 },
  { x: 26, y: 2 }, { x: 52, y: 4 },
];

const TYPE_PHRASES = [
  'AI가 먼저 찾습니다',
  'AI가 자동 발굴합니다',
  'AI가 대신 분석합니다',
  'AI가 매일 리포트합니다',
];

const TOOLS = [
  { icon: TrendingUp,         label: '훈프로 소싱AI' },
  { icon: ImageIcon,          label: '썸네일 제작' },
  { icon: LayoutTemplate,     label: '상세페이지 제작' },
  { icon: ListOrdered,        label: '순위 추적' },
  { icon: MessageSquareText,  label: '리뷰 분석' },
  { icon: BarChart3,          label: '광고 성과 분석' },
  { icon: MessageCircleQuestion, label: '훈프로에게 질문' },
];

/* ──────────────── 컴포넌트 ──────────────── */
export function AuthGate({ onSuccess }: Props) {
  /* ---------- 로그인/가입 상태 (기존 로직 그대로) ---------- */
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  // 아이디/비밀번호 찾기 패널 — null이면 일반 로그인/가입 폼
  const [helper, setHelper] = useState<null | 'find-id' | 'reset'>(null);
  const [findName, setFindName] = useState('');
  const [findPhone, setFindPhone] = useState('');
  const [foundEmails, setFoundEmails] = useState<{ masked: string; joinedAt: string | null }[] | null>(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const [verificationRequired, setVerificationRequired] = useState(false);
  const [emailCodeRequired, setEmailCodeRequired] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [signupCode, setSignupCode] = useState('');
  const [ageChecked, setAgeChecked] = useState(false);

  useEffect(() => {
    fetch('/api/auth/signup?action=config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(res => res.json())
      .then(data => {
        setVerificationRequired(Boolean(data.verificationRequired) && certificationAvailable());
        setEmailCodeRequired(Boolean(data.emailCodeRequired));
      })
      .catch(() => { setVerificationRequired(false); setEmailCodeRequired(false); });
  }, []);

  // 요금제 — 비회원에게도 가격을 보여준다 (서버 값 우선, 실패 시 기본가)
  const [plans, setPlans] = useState<{ id: string; name: string; price: number; interval: string }[]>([
    { id: 'yearly', name: '훈프로 연간', price: 357600, interval: 'year' },
    { id: 'standard', name: '훈프로 월간', price: 39800, interval: 'month' },
  ]);
  useEffect(() => {
    fetch('/api/billing?action=plans')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.plans) && d.plans.length) setPlans(d.plans); })
      .catch(() => { /* 기본가 유지 */ });
  }, []);

  const yearly = plans.find(p => p.interval === 'year');
  const monthly = plans.find(p => p.interval === 'month');
  const yearlyDiscount = yearly && monthly
    ? Math.round((1 - yearly.price / 12 / monthly.price) * 100)
    : 0;

  // 사업자 정보 (전자상거래법 표기용) — 캐시된 값 먼저, 서버 응답으로 갱신
  const [company, setCompany] = useState<CompanyInfo>(loadCachedCompany);
  useEffect(() => {
    fetchCompanyInfo().then(setCompany).catch(() => { /* 기본값 유지 */ });
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
        body: JSON.stringify({ email: loginEmail.trim().toLowerCase(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 비밀번호 도입 이전 계정 — 재설정 화면으로 바로 안내
        if (data.passwordSetupRequired) {
          setResetEmail(loginEmail.trim().toLowerCase());
          setHelper('reset');
        }
        return setMessage({ text: data.error, type: 'error' });
      }
      setToken(data.token);
      onSuccess();
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // ── 아이디(이메일) 찾기 ──
  const handleFindId = async () => {
    if (!findName.trim() || !findPhone.trim()) {
      return setMessage({ text: '이름과 연락처를 모두 입력해주세요.', type: 'error' });
    }
    setLoading(true);
    setMessage(null);
    setFoundEmails(null);
    try {
      const res = await fetch('/api/auth/login?action=find-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: findName.trim(), phone: findPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setFoundEmails(data.emails ?? []);
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // ── 비밀번호 재설정: 코드 요청 ──
  const handleResetRequest = async () => {
    if (!resetEmail.trim()) return setMessage({ text: '이메일을 입력해주세요.', type: 'error' });
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/login?action=reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setResetSent(true);
      setMessage({ text: data.message, type: 'success' });
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // ── 비밀번호 재설정: 코드 확인 + 저장 ──
  const handleResetConfirm = async () => {
    if (!/^\d{6}$/.test(resetCode.trim())) return setMessage({ text: '인증코드 6자리를 입력해주세요.', type: 'error' });
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/login?action=reset-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase(), code: resetCode.trim(), password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      // 재설정 완료 → 로그인 폼으로 복귀 (이메일은 채워둔다)
      setLoginEmail(resetEmail.trim().toLowerCase());
      setLoginPassword('');
      setHelper(null);
      setResetSent(false); setResetCode(''); setResetPassword('');
      setMessage({ text: data.message, type: 'success' });
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const closeHelper = () => {
    setHelper(null);
    setMessage(null);
    setFoundEmails(null);
    setResetSent(false); setResetCode(''); setResetPassword('');
  };

  const handleSignup = async () => {
    if (verificationRequired) {
      if (!signupEmail.trim()) return setMessage({ text: '이메일을 입력해주세요.', type: 'error' });
    } else if (!signupName.trim() || !signupPhone.trim() || !signupEmail.trim()) {
      return setMessage({ text: '모든 항목을 입력해주세요.', type: 'error' });
    }
    if (emailCodeRequired && !verificationRequired) {
      if (!/^\d{6}$/.test(signupCode.trim())) return setMessage({ text: '이메일로 받은 6자리 인증코드를 입력해주세요.', type: 'error' });
      if (signupPassword.length < 8 || !/[A-Za-z]/.test(signupPassword) || !/[0-9]/.test(signupPassword)) {
        return setMessage({ text: '비밀번호는 영문·숫자를 포함해 8자 이상이어야 합니다.', type: 'error' });
      }
      if (!ageChecked) return setMessage({ text: '만 14세 이상 확인에 동의해주세요.', type: 'error' });
    }
    setLoading(true);
    setMessage(null);
    try {
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
          password: signupPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) return setMessage({ text: data.error, type: 'error' });
      setMessage({ text: data.message, type: 'success' });
      setSignupName(''); setSignupPhone(''); setSignupEmail('');
      setSignupCode(''); setAgeChecked(false); setCodeSent(false); setSignupPassword('');
    } catch {
      setMessage({ text: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  /* ---------- 랜딩 애니메이션 상태 ---------- */

  // 타이핑 헤드라인
  const [typed, setTyped] = useState('');
  const typeState = useRef({ idx: 0, char: 0, deleting: false });
  useEffect(() => {
    let cancelled = false;
    // 최초 진입 시 첫 문구를 완성 상태로 보여주고 잠시 뒤 회전 시작
    setTyped(TYPE_PHRASES[0]);
    typeState.current = { idx: 0, char: TYPE_PHRASES[0].length, deleting: true };
    const kick = setTimeout(function step() {
      if (cancelled) return;
      const s = typeState.current;
      const phrase = TYPE_PHRASES[s.idx];
      s.char += s.deleting ? -1 : 1;
      setTyped(phrase.slice(0, s.char));
      let delay = s.deleting ? 40 : 70;
      if (!s.deleting && s.char === phrase.length) { delay = 2200; s.deleting = true; }
      else if (s.deleting && s.char === 0) { s.deleting = false; s.idx = (s.idx + 1) % TYPE_PHRASES.length; delay = 400; }
      setTimeout(step, delay);
    }, 2500);
    return () => { cancelled = true; clearTimeout(kick); };
  }, []);

  // 상품 롤링
  const [prodIdx, setProdIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setProdIdx(i => (i + 1) % DEMO_PRODUCTS.length), 4200);
    return () => clearInterval(t);
  }, []);
  const prod = DEMO_PRODUCTS[prodIdx];

  // 라이브 카운터 (배지 · 상단)
  const [scanCount, setScanCount] = useState(142860);
  const [activeCount, setActiveCount] = useState(1284);
  useEffect(() => {
    const t = setInterval(() => {
      setScanCount(v => v + Math.floor(Math.random() * 7) + 1);
      setActiveCount(v => v + (Math.random() > 0.5 ? 1 : -1));
    }, 1800);
    return () => clearInterval(t);
  }, []);

  // 커서 글로우
  const cursorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cx = window.innerWidth / 2, cy = window.innerHeight / 2, tx = cx, ty = cy;
    let raf = 0;
    const move = (e: MouseEvent) => {
      tx = e.clientX; ty = e.clientY;
      if (cursorRef.current) cursorRef.current.style.opacity = '1';
    };
    const leave = () => { if (cursorRef.current) cursorRef.current.style.opacity = '0'; };
    const loop = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
      if (cursorRef.current) {
        cursorRef.current.style.left = cx + 'px';
        cursorRef.current.style.top = cy + 'px';
      }
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseleave', leave);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseleave', leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 로그인 카드로 스크롤
  const authRef = useRef<HTMLDivElement>(null);
  const scrollToAuth = () => {
    authRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const keywordBubbles = useMemo(() =>
    KEYWORDS.slice(0, KEYWORD_SPOTS.length).map((k, i) => {
      const p = KEYWORD_SPOTS[i];
      return {
        ...k,
        left: p.x + '%',
        top: p.y + '%',
        dx: (Math.random() * 30 - 15).toFixed(0) + 'px',
        dy: (Math.random() * 24 - 12).toFixed(0) + 'px',
        dur: 8 + Math.random() * 6,
        delay: Math.random() * 3,
        appearDelay: 300 + i * 140,
      };
    }), []);

  return (
    <div className="hp-landing relative min-h-screen w-full overflow-x-hidden text-[#f5f8ff]">
      {/* Scoped styles — 다크 테크 랜딩. 사이트 나머지에는 영향 없음 */}
      <style>{`
        .hp-landing {
          background: #101a2e;
          font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        }
        .hp-landing .hp-bg { position: fixed; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; }
        .hp-landing .hp-bg::before {
          content:""; position:absolute; inset:-1px;
          background:
            radial-gradient(1200px 800px at 15% 20%, rgba(124,245,255,.10), transparent 60%),
            radial-gradient(1000px 700px at 85% 30%, rgba(139,123,255,.12), transparent 60%),
            radial-gradient(900px 700px at 60% 90%, rgba(62,231,163,.06), transparent 60%),
            linear-gradient(180deg,#101a2e 0%,#152140 50%,#101a2e 100%);
        }
        .hp-landing .hp-grid {
          position:absolute; inset:-2px;
          background-image:
            linear-gradient(to right, rgba(255,255,255,.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,.06) 1px, transparent 1px);
          background-size:56px 56px;
          -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 40%, black 40%, transparent 100%);
                  mask-image: radial-gradient(ellipse 90% 70% at 50% 40%, black 40%, transparent 100%);
          animation: hpGridFloat 24s ease-in-out infinite alternate;
        }
        @keyframes hpGridFloat { to { transform: translate3d(-28px,-14px,0); } }
        .hp-landing .hp-blob { position:absolute; border-radius:50%; filter:blur(80px); opacity:.55; mix-blend-mode:screen; }
        .hp-landing .hp-b1 { width:520px; height:520px; background:#1a6bff; top:-120px; left:-120px; animation: hpF1 18s ease-in-out infinite alternate; }
        .hp-landing .hp-b2 { width:600px; height:600px; background:#7c3aed; top:20%; right:-160px; animation: hpF2 22s ease-in-out infinite alternate; }
        .hp-landing .hp-b3 { width:460px; height:460px; background:#06b6d4; bottom:-160px; left:30%; animation: hpF3 20s ease-in-out infinite alternate; }
        @keyframes hpF1 { to { transform: translate(120px,60px) scale(1.1); } }
        @keyframes hpF2 { to { transform: translate(-100px,80px) scale(1.05); } }
        @keyframes hpF3 { to { transform: translate(80px,-60px) scale(1.15); } }
        .hp-landing .hp-cursor {
          position:fixed; width:520px; height:520px; border-radius:50%;
          background: radial-gradient(circle, rgba(124,245,255,.10), rgba(139,123,255,.05) 40%, transparent 70%);
          transform: translate(-50%,-50%); pointer-events:none; z-index:1; opacity:0;
          transition: opacity .3s;
        }
        .hp-landing .hp-accent {
          background: linear-gradient(120deg,#7cf5ff 0%,#8b7bff 60%,#3ee7a3 100%);
          -webkit-background-clip: text; background-clip: text; color: transparent;
          background-size: 200% 100%; animation: hpHue 8s linear infinite;
        }
        @keyframes hpHue { to { background-position: 200% 0; } }
        .hp-landing .hp-caret {
          display:inline-block; width:3px; height:.9em; background:#7cf5ff;
          vertical-align:-2px; margin-left:4px; animation: hpBlink 1s steps(2) infinite;
        }
        @keyframes hpBlink { 50% { opacity:0; } }
        .hp-landing .hp-dot {
          width:8px; height:8px; border-radius:50%; background:#3ee7a3;
          box-shadow: 0 0 0 0 rgba(62,231,163,.7);
          animation: hpPulse 2s infinite;
        }
        @keyframes hpPulse {
          0%   { box-shadow: 0 0 0 0 rgba(62,231,163,.7); }
          70%  { box-shadow: 0 0 0 10px rgba(62,231,163,0); }
          100% { box-shadow: 0 0 0 0 rgba(62,231,163,0); }
        }
        .hp-landing .hp-badge-dot {
          width:6px; height:6px; border-radius:50%; background:#7cf5ff;
          box-shadow:0 0 12px #7cf5ff; animation: hpBlink 1.6s infinite;
        }
        .hp-landing .hp-bubble {
          position:absolute; padding:9px 14px; border-radius:99px;
          background: rgba(27,39,69,.82); border:1px solid #31406b;
          color:#b9c2d8; font-size:12px;
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          display:flex; align-items:center; gap:8px; white-space:nowrap;
          box-shadow: 0 8px 24px rgba(0,0,0,.4);
          opacity:0; transform: translateY(10px);
          transition: opacity .8s ease, transform .8s ease;
        }
        .hp-landing .hp-bubble.hp-in { opacity:1; transform: translateY(0); }
        .hp-landing .hp-bubble b { color:#fff; font-weight:600; font-variant-numeric: tabular-nums; }
        .hp-landing .hp-bubble .hp-tag { color:#7cf5ff; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; font-weight:600; }
        .hp-landing .hp-bubble.hp-hot { border-color: rgba(255,180,84,.3); }
        .hp-landing .hp-bubble.hp-hot .hp-tag { color:#ffb454; }
        .hp-landing .hp-bubble.hp-up::after { content:"↑"; color:#3ee7a3; font-weight:700; margin-left:2px; }
        @keyframes hpDrift {
          0%   { transform: translate(0,0); }
          50%  { transform: translate(var(--dx,20px), var(--dy,-14px)); }
          100% { transform: translate(0,0); }
        }
        .hp-landing .hp-scan::after {
          content:""; position:absolute; inset:0;
          background: linear-gradient(90deg, transparent, rgba(124,245,255,.15), transparent);
          transform: translateX(-100%); animation: hpScan 3.6s ease-in-out infinite;
        }
        @keyframes hpScan {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(100%); }
          100% { transform: translateX(100%); }
        }
        .hp-landing .hp-fade {
          animation: hpFadeIn .35s ease both;
        }
        @keyframes hpFadeIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
        .hp-landing .hp-cta:hover .hp-arrow { transform: translateX(4px); }
        .hp-landing input.hp-input:focus {
          border-color: #7cf5ff !important;
          background: rgba(124,245,255,.08) !important;
          box-shadow: 0 0 0 4px rgba(124,245,255,.10) !important;
        }
        .hp-landing .hp-chip:hover {
          border-color: rgba(124,245,255,.3) !important;
          color:#f5f8ff !important;
          background: rgba(124,245,255,.05) !important;
          transform: translateY(-1px);
        }
        .hp-landing .hp-login-card::before {
          content:""; position:absolute; inset:-1px; border-radius:22px; padding:1px;
          background: linear-gradient(135deg, rgba(124,245,255,.4), transparent 40%, transparent 60%, rgba(139,123,255,.3));
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events:none; opacity:.6;
        }
        .hp-landing .hp-submit {
          background: linear-gradient(135deg,#7cf5ff 0%,#8b7bff 100%);
          color:#152140; font-weight:700;
          box-shadow: 0 10px 30px -8px rgba(124,245,255,.4);
          transition: transform .15s, box-shadow .15s, opacity .2s;
        }
        .hp-landing .hp-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 14px 36px -8px rgba(124,245,255,.55);
        }
        .hp-landing .hp-submit:disabled { opacity: .5; cursor: not-allowed; }
        @media (prefers-reduced-motion: reduce) {
          .hp-landing *, .hp-landing *::before, .hp-landing *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>

      {/* 배경 레이어 */}
      <div className="hp-bg" aria-hidden="true">
        <div className="hp-grid" />
        <div className="hp-blob hp-b1" />
        <div className="hp-blob hp-b2" />
        <div className="hp-blob hp-b3" />
      </div>
      <div className="hp-cursor" ref={cursorRef} aria-hidden="true" />

      {/* 상단 네비 */}
      <header className="relative z-10 mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 md:px-12">
        <div className="flex items-center gap-3">
          <div
            className="grid h-9 w-9 place-items-center rounded-[10px] text-[15px] font-extrabold"
            style={{
              background: 'linear-gradient(135deg,#7cf5ff 0%,#8b7bff 100%)',
              color: '#131d36',
              boxShadow: '0 8px 28px rgba(124,245,255,.28), inset 0 1px 0 rgba(255,255,255,.4)',
            }}
          >훈</div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">쇼크트리 훈프로</div>
            <div className="text-[11px] text-[#b9c2d8]">Seller AI Automation</div>
          </div>
        </div>
        <div className="hidden items-center gap-4 md:flex">
          <a
            href="#pricing"
            onClick={e => { e.preventDefault(); document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            className="text-[13px] font-medium text-[#b9c2d8] transition-colors hover:text-white"
          >
            요금 안내
          </a>
          <div className="flex items-center gap-2 text-[13px] text-[#b9c2d8]">
            <span className="hp-dot" />
            <span>지금 <b className="font-semibold text-white tabular-nums">{activeCount.toLocaleString('ko-KR')}</b>명의 셀러가 사용 중</span>
          </div>
        </div>
        <button
          onClick={scrollToAuth}
          className="hp-cta group flex min-h-[44px] items-center gap-2 rounded-full border border-[#31406b] bg-[#1b2745]/70 px-4 text-[13px] font-medium text-white transition-colors hover:border-[#7cf5ff]/40 hover:bg-[#7cf5ff]/5 md:hidden"
        >
          로그인 <ArrowRight className="hp-arrow h-4 w-4 transition-transform" />
        </button>
      </header>

      {/* 메인 그리드 */}
      <main className="relative z-[5] mx-auto grid min-h-[calc(100vh-88px)] max-w-[1440px] grid-cols-1 items-center gap-10 px-4 pb-14 pt-2 sm:px-6 md:px-12 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
        {/* LEFT — 랜딩 */}
        <section className="relative">
          {/* 떠다니는 키워드 버블 */}
          <div className="pointer-events-none absolute inset-0 z-[2] hidden lg:block">
            {keywordBubbles.map((k, i) => (
              <div
                key={i}
                className={`hp-bubble hp-in ${k.hot ? 'hp-hot' : ''} ${k.up ? 'hp-up' : ''}`}
                style={{
                  left: k.left,
                  top: k.top,
                  animation: `hpDrift ${k.dur}s ease-in-out ${k.delay}s infinite`,
                  transitionDelay: `${k.appearDelay}ms`,
                  ['--dx' as any]: k.dx,
                  ['--dy' as any]: k.dy,
                }}
              >
                <span className="hp-tag">{k.tag}</span>
                <span>{k.t}</span>
                <b>{k.n}</b>
              </div>
            ))}
          </div>

          {/* 라이브 배지 */}
          <span
            className="relative z-[3] inline-flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-[12.5px] font-medium tracking-wide"
            style={{ background: 'rgba(124,245,255,.06)', borderColor: 'rgba(124,245,255,.22)', color: '#7cf5ff', backdropFilter: 'blur(8px)' }}
          >
            <span className="hp-badge-dot" />
            AI 소싱엔진 v3.2 · 오늘 <b className="mx-0.5 font-semibold text-white tabular-nums">{scanCount.toLocaleString('ko-KR')}</b>개 상품 분석 완료
          </span>

          {/* 헤드라인 */}
          <h1 className="relative z-[3] mt-6 text-[clamp(38px,4.6vw,64px)] font-bold leading-[1.05] tracking-[-0.03em]" style={{ textWrap: 'balance' as any }}>
            <span className="block">팔릴 상품을,</span>
            <span className="hp-accent">
              {typed}
              <span className="hp-caret" />
            </span>
          </h1>

          <p className="relative z-[3] mt-5 max-w-[560px] text-[17px] leading-[1.6] text-[#b9c2d8]">
            키워드 발굴부터 썸네일·상세페이지 제작, 순위·리뷰·광고 분석까지 —
            셀러의 반복 업무를 <b className="font-semibold text-white">8가지 AI 도구</b>가 한 화면에서 자동화합니다.
          </p>

          {/* 스탯 */}
          <div className="relative z-[3] mt-8 flex flex-wrap gap-9">
            {[
              { n: '142,860+', l: '누적 분석 상품' },
              { n: '24시간', l: '주 평균 절감' },
              { n: '3.4배', l: '평균 매출 성장' },
            ].map((s, i) => (
              <div key={i}>
                <div
                  className="text-[26px] font-bold tracking-[-0.02em] tabular-nums"
                  style={{ background: 'linear-gradient(180deg,#fff,#d2daed)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
                >{s.n}</div>
                <div className="mt-1 text-[12px] tracking-wide text-[#98a3bf]">{s.l}</div>
              </div>
            ))}
          </div>

          {/* 툴 칩 */}
          <div className="relative z-[3] mt-9 flex max-w-[560px] flex-wrap gap-2">
            {TOOLS.map((t, i) => (
              <span
                key={i}
                className="hp-chip inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] transition-all"
                style={{ background: 'rgba(255,255,255,.055)', borderColor: '#31406b', color: '#b9c2d8' }}
              >
                <t.icon className="h-3.5 w-3.5" style={{ color: '#7cf5ff' }} />
                {t.label}
              </span>
            ))}
          </div>

          {/* 라이브 데모 */}
          <div
            className="relative z-[3] mt-11 max-w-[600px] overflow-hidden rounded-[18px] border"
            style={{
              background: 'linear-gradient(180deg, rgba(20,27,49,.7), rgba(15,21,38,.7))',
              borderColor: '#31406b',
              backdropFilter: 'blur(14px)',
              boxShadow: '0 30px 80px -30px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.065)',
            }}
          >
            <div className="flex items-center justify-between border-b px-4 py-3.5" style={{ borderColor: '#31406b', background: 'rgba(255,255,255,.065)' }}>
              <div className="flex gap-1.5">
                <i className="block h-2.5 w-2.5 rounded-full" style={{ background: '#ff5f57' }} />
                <i className="block h-2.5 w-2.5 rounded-full" style={{ background: '#febc2e' }} />
                <i className="block h-2.5 w-2.5 rounded-full" style={{ background: '#28c840' }} />
              </div>
              <div className="text-[12px] tracking-wide text-[#98a3bf]">훈프로 소싱AI · 실시간 분석</div>
              <div className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]" style={{ background: 'rgba(62,231,163,.08)', borderColor: 'rgba(62,231,163,.2)', color: '#3ee7a3' }}>
                <span className="hp-badge-dot" style={{ background: '#3ee7a3', boxShadow: '0 0 8px #3ee7a3' }} />
                LIVE
              </div>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div className="flex items-start gap-3.5">
                <div className="hp-scan relative grid h-[82px] w-[82px] shrink-0 place-items-center overflow-hidden rounded-[12px] border" style={{ background: 'linear-gradient(135deg,#31406b,#1b2745)', borderColor: '#31406b' }}>
                  <Sparkles className="h-9 w-9" style={{ color: '#5d6f9e' }} />
                </div>
                <div key={prodIdx} className="hp-fade">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: '#7cf5ff' }}>{prod.cat}</div>
                  <div className="mt-1 text-[14px] font-medium leading-[1.4] text-white">{prod.name}</div>
                  <div className="mt-1.5 text-[13px] text-[#b9c2d8]">예상 판매가 <b className="font-bold text-white">{prod.price}</b></div>
                </div>
              </div>
              <div key={`a-${prodIdx}`} className="hp-fade flex flex-col gap-2.5">
                <AnalysisRow color="#7cf5ff" k="검색량" v={prod.q} />
                <AnalysisRow color="#8b7bff" k="경쟁강도" v={prod.comp} vClass="text-[#ffb454]" />
                <AnalysisRow color="#3ee7a3" k="수요 추세" v={`${prod.trend} ↑`} vClass="text-[#3ee7a3]" />
                <AnalysisRow color="#ffb454" k="기회 점수" v={`${prod.score} / 100`} />
                <div className="mt-0.5 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.05)' }}>
                  <div
                    className="h-full rounded-full transition-transform duration-[1200ms]"
                    style={{
                      background: 'linear-gradient(90deg,#7cf5ff,#8b7bff)',
                      transformOrigin: 'left',
                      transform: `scaleX(${prod.score / 100})`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 모바일에서만 보이는 CTA */}
          <button
            onClick={scrollToAuth}
            className="hp-cta group relative z-[3] mt-8 inline-flex items-center gap-2 rounded-full border px-5 py-3 text-[14px] font-semibold text-white transition-colors lg:hidden"
            style={{ borderColor: '#31406b', background: 'rgba(255,255,255,.055)' }}
          >
            지금 시작하기 <ArrowRight className="hp-arrow h-4 w-4 transition-transform" />
          </button>
        </section>

        {/* RIGHT — 로그인 카드 (기존 폼) */}
        <aside className="relative flex justify-center" ref={authRef}>
          <div
            className="hp-login-card relative w-full max-w-[420px] rounded-[22px] border p-5 sm:p-7 md:p-8"
            style={{
              background: 'linear-gradient(180deg, rgba(38,52,88,.88), rgba(25,36,66,.9))',
              borderColor: '#31406b',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 40px 100px -30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.045) inset, 0 1px 0 rgba(255,255,255,.06) inset',
            }}
          >
            {/* 아이콘 */}
            <div
              className="mx-auto mb-4 grid h-[52px] w-[52px] place-items-center rounded-[14px] border"
              style={{ background: 'linear-gradient(135deg,#212e50,#31406b)', borderColor: '#31406b', color: '#7cf5ff', boxShadow: '0 6px 24px rgba(124,245,255,.15)' }}
            >
              {helper ? <KeyRound className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </div>
            <h2 className="text-center text-[22px] font-bold tracking-[-0.02em] text-white">
              {helper === 'find-id' ? '아이디 찾기' : helper === 'reset' ? '비밀번호 찾기' : '훈프로 시작하기'}
            </h2>
            <p className="mt-1.5 text-center text-[13px] text-[#98a3bf]">
              {helper === 'find-id'
                ? '이름과 연락처로 가입 이메일을 확인합니다'
                : helper === 'reset'
                ? '이메일 인증으로 새 비밀번호를 설정합니다'
                : verificationRequired
                ? '휴대폰 인증 한 번으로 셀러 자동화가 켜집니다'
                : emailCodeRequired
                  ? '이메일 인증 즉시 모든 AI 도구가 열립니다'
                  : mode === 'signup'
                    ? '가입 후 관리자 승인이 완료되면 이용하실 수 있습니다'
                    : '이메일과 비밀번호로 로그인하세요'}
            </p>

            {/* 탭 — 아이디/비밀번호 찾기 중에는 숨김 */}
            {!helper && (
            <div className="mt-6 flex border-b" style={{ borderColor: '#31406b' }}>
              <button
                onClick={() => { setMode('login'); setMessage(null); }}
                className="-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-[13.5px] font-medium transition-colors"
                style={{
                  borderColor: mode === 'login' ? '#7cf5ff' : 'transparent',
                  color: mode === 'login' ? '#fff' : '#98a3bf',
                }}
              >
                <LogIn className="h-4 w-4" /> 로그인
              </button>
              <button
                onClick={() => { setMode('signup'); setMessage(null); }}
                className="-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-[13.5px] font-medium transition-colors"
                style={{
                  borderColor: mode === 'signup' ? '#7cf5ff' : 'transparent',
                  color: mode === 'signup' ? '#fff' : '#98a3bf',
                }}
              >
                <UserPlus className="h-4 w-4" /> 가입 신청
              </button>
            </div>
            )}

            {/* 폼 */}
            {helper ? (
              /* ─── 아이디 / 비밀번호 찾기 ─── */
              <div className="mt-5 space-y-3">
                <button
                  onClick={closeHelper}
                  className="mb-1 inline-flex items-center gap-1 text-[12.5px] text-[#b9c2d8] transition-colors hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> 로그인으로 돌아가기
                </button>

                {helper === 'find-id' ? (
                  <>
                    <p className="text-[13px] leading-relaxed text-[#b9c2d8]">
                      가입 시 입력한 <b className="text-[#f5f8ff]">이름과 연락처</b>로 가입된 이메일을 찾아드립니다.
                    </p>
                    <input
                      type="text"
                      value={findName}
                      onChange={e => setFindName(e.target.value)}
                      placeholder="성함"
                      autoFocus
                      className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                    />
                    <input
                      type="tel"
                      value={findPhone}
                      onChange={e => setFindPhone(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleFindId()}
                      placeholder="연락처 (예: 010-1234-5678)"
                      className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                    />
                    <button
                      onClick={handleFindId}
                      disabled={loading}
                      className="hp-submit hp-cta group flex w-full items-center justify-center gap-1.5 rounded-[11px] py-3 text-[14px]"
                    >
                      {loading ? '찾는 중...' : <>이메일 찾기 <ArrowRight className="hp-arrow h-4 w-4 transition-transform" /></>}
                    </button>

                    {foundEmails && foundEmails.length > 0 && (
                      <div className="rounded-[12px] border p-4" style={{ borderColor: 'rgba(62,231,163,.25)', background: 'rgba(62,231,163,.06)' }}>
                        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: '#3ee7a3' }}>
                          <Check className="h-3.5 w-3.5" /> 가입된 이메일을 찾았습니다
                        </p>
                        {foundEmails.map((e, i) => (
                          <div key={i} className="flex items-baseline justify-between py-1 text-[13.5px] text-white">
                            <span className="font-medium tabular">{e.masked}</span>
                            {e.joinedAt && <span className="text-[11.5px] text-[#98a3bf]">{e.joinedAt} 가입</span>}
                          </div>
                        ))}
                        <p className="mt-2 text-[11.5px] leading-relaxed text-[#b9c2d8]">
                          개인정보 보호를 위해 일부를 가렸습니다. 전체 주소가 기억나지 않으면 비밀번호 찾기로 재설정해주세요.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[13px] leading-relaxed text-[#b9c2d8]">
                      가입한 이메일로 <b className="text-[#f5f8ff]">인증코드</b>를 보내드립니다. 코드 확인 후 새 비밀번호를 설정하세요.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={resetEmail}
                        onChange={e => { setResetEmail(e.target.value); setResetSent(false); }}
                        onKeyDown={e => e.key === 'Enter' && handleResetRequest()}
                        placeholder="가입한 이메일 주소"
                        autoFocus
                        className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                      />
                      <button
                        onClick={handleResetRequest}
                        disabled={loading || !resetEmail.trim()}
                        className="shrink-0 whitespace-nowrap rounded-[11px] border px-3 py-3 text-[12.5px] font-medium text-white transition-colors hover:border-[#7cf5ff]/40 hover:bg-[#7cf5ff]/5 disabled:opacity-40"
                        style={{ borderColor: '#31406b', background: 'rgba(255,255,255,.045)' }}
                      >
                        {loading && !resetSent ? '발송 중...' : resetSent ? '재발송' : '코드 받기'}
                      </button>
                    </div>

                    {resetSent && (
                      <>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={resetCode}
                          onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="인증코드 6자리"
                          className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-center text-[15px] tracking-[0.4em] text-white outline-none transition-all placeholder:tracking-normal"
                          style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                        />
                        <input
                          type="password"
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleResetConfirm()}
                          placeholder="새 비밀번호 (영문·숫자 포함 8자 이상)"
                          autoComplete="new-password"
                          className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                        />
                        <button
                          onClick={handleResetConfirm}
                          disabled={loading}
                          className="hp-submit hp-cta group flex w-full items-center justify-center gap-1.5 rounded-[11px] py-3 text-[14px]"
                        >
                          {loading ? '설정 중...' : <>비밀번호 설정하기 <ArrowRight className="hp-arrow h-4 w-4 transition-transform" /></>}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ) : mode === 'login' ? (
              <div className="mt-5 space-y-3">
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="이메일 주소"
                  autoComplete="username"
                  autoFocus
                  className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                />
                <button
                  onClick={handleLogin}
                  disabled={loading}
                  className="hp-submit hp-cta group flex w-full items-center justify-center gap-1.5 rounded-[11px] py-3 text-[14px]"
                >
                  {loading ? '확인 중...' : (
                    <>입장하기 <ArrowRight className="hp-arrow h-4 w-4 transition-transform" /></>
                  )}
                </button>

                {/* 아이디 / 비밀번호 찾기 */}
                <div className="flex items-center justify-center text-[13px] text-[#98a3bf]">
                  <button
                    onClick={() => { setHelper('find-id'); setMessage(null); setFoundEmails(null); }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 px-3 transition-colors hover:text-white"
                  >
                    <Mail className="h-3.5 w-3.5" /> 아이디 찾기
                  </button>
                  <span style={{ color: '#31406b' }}>|</span>
                  <button
                    onClick={() => { setHelper('reset'); setMessage(null); setResetEmail(loginEmail.trim()); }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 px-3 transition-colors hover:text-white"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> 비밀번호 찾기
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {!verificationRequired && (
                  <>
                    <input
                      type="text"
                      value={signupName}
                      onChange={e => setSignupName(e.target.value)}
                      placeholder="성함"
                      autoFocus
                      className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                      style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                    />
                    <input
                      type="tel"
                      value={signupPhone}
                      onChange={e => setSignupPhone(e.target.value)}
                      placeholder="연락처 (예: 010-1234-5678)"
                      className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                      style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
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
                    autoFocus={verificationRequired}
                    className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                    style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                  />
                  {emailCodeRequired && !verificationRequired && (
                    <button
                      onClick={handleSendCode}
                      disabled={sendingCode || !signupEmail.trim()}
                      className="shrink-0 whitespace-nowrap rounded-[11px] border px-3 py-3 text-[12.5px] font-medium text-white transition-colors hover:border-[#7cf5ff]/40 hover:bg-[#7cf5ff]/5 disabled:opacity-40"
                      style={{ borderColor: '#31406b', background: 'rgba(255,255,255,.045)' }}
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
                      className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-center text-[15px] tracking-[0.4em] text-white outline-none transition-all placeholder:tracking-normal"
                      style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                    />
                    <input
                      type="password"
                      value={signupPassword}
                      onChange={e => setSignupPassword(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSignup()}
                      placeholder="비밀번호 (영문·숫자 포함 8자 이상)"
                      autoComplete="new-password"
                      className="hp-input w-full rounded-[11px] border px-3.5 py-3 text-[14px] text-white outline-none transition-all"
                      style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
                    />
                    <label className="flex cursor-pointer items-center gap-2 px-1 text-[12.5px] text-[#b9c2d8]">
                      <input
                        type="checkbox"
                        checked={ageChecked}
                        onChange={e => setAgeChecked(e.target.checked)}
                        className="h-3.5 w-3.5"
                        style={{ accentColor: '#7cf5ff' }}
                      />
                      만 14세 이상입니다.
                    </label>
                  </>
                )}
                <button
                  onClick={handleSignup}
                  disabled={loading}
                  className="hp-submit hp-cta group flex w-full items-center justify-center gap-1.5 rounded-[11px] py-3 text-[14px]"
                >
                  {verificationRequired && <ShieldCheck className="h-4 w-4" />}
                  {loading
                    ? (verificationRequired ? '인증 확인 중...' : '신청 중...')
                    : (
                      <>
                        {verificationRequired ? '휴대폰 본인인증하고 가입하기' : '가입 신청하기'}
                        <ArrowRight className="hp-arrow h-4 w-4 transition-transform" />
                      </>
                    )}
                </button>
                {verificationRequired && (
                  <p className="text-center text-[11px] leading-relaxed text-[#98a3bf]">
                    이름·연락처는 PASS 본인인증 결과로 자동 입력됩니다.<br />1인 1계정만 가입할 수 있습니다.
                  </p>
                )}
                <p className="text-center text-[11px] leading-relaxed text-[#98a3bf]">
                  가입하면{' '}
                  <a href="/terms.html" target="_blank" rel="noreferrer" className="underline hover:text-white">이용약관</a>과{' '}
                  <a href="/privacy.html" target="_blank" rel="noreferrer" className="underline hover:text-white">개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
                </p>
              </div>
            )}

            {/* 메시지 */}
            {message && (
              <p
                className="mt-4 rounded-[10px] px-3 py-2.5 text-center text-[13px]"
                style={{
                  background: message.type === 'error' ? 'rgba(255,80,80,.08)' : 'rgba(62,231,163,.08)',
                  color: message.type === 'error' ? '#ff8a8a' : '#3ee7a3',
                  border: `1px solid ${message.type === 'error' ? 'rgba(255,80,80,.2)' : 'rgba(62,231,163,.2)'}`,
                }}
              >
                {message.text}
              </p>
            )}

            {/* 신뢰 뱃지 */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3.5 border-t pt-5 text-[11px] text-[#98a3bf]" style={{ borderColor: '#31406b' }}>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3" style={{ color: '#3ee7a3' }} />
                SSL 암호화
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3 w-3" style={{ color: '#3ee7a3' }} />
                24시간 무중단
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3" style={{ color: '#3ee7a3' }} />
                즉시 이용
              </span>
            </div>
          </div>
        </aside>
      </main>

      {/* ─── 요금 안내 (비회원도 가입 전에 가격을 확인할 수 있어야 한다) ─── */}
      <section id="pricing" className="relative z-[5] border-t px-4 py-14 sm:px-6 md:px-12 md:py-20" style={{ borderColor: '#31406b' }}>
        <div className="mx-auto max-w-[880px]">
          <div className="text-center">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#7cf5ff' }}>PRICING</p>
            <h2 className="mt-2.5 text-[26px] font-bold tracking-[-0.02em] text-white md:text-[32px]">
              도구 하나 값으로, 팀 하나를 씁니다
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-[#b9c2d8]">
              7가지 AI 도구를 하나의 구독으로. 언제든 해지할 수 있고, 해지해도 남은 기간은 그대로 이용합니다.
            </p>
          </div>

          <div className="mt-9 grid gap-4 md:grid-cols-2">
            {/* 연간 — 추천 */}
            {yearly && (
              <div
                className="hp-login-card relative rounded-[20px] border p-7"
                style={{
                  background: 'linear-gradient(180deg, rgba(38,52,88,.92), rgba(25,36,66,.94))',
                  borderColor: '#31406b',
                  boxShadow: '0 30px 70px -30px rgba(0,0,0,.7)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-white">연간 결제</span>
                  {yearlyDiscount > 0 && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{ background: 'linear-gradient(135deg,#7cf5ff,#8b7bff)', color: '#152140' }}
                    >
                      {yearlyDiscount}% 할인
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-[38px] font-bold tracking-[-0.03em] text-white tabular">
                    {Math.round(yearly.price / 12).toLocaleString()}
                  </span>
                  <span className="text-[14px] font-medium text-[#b9c2d8]">원 / 월</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-[#98a3bf]">
                  연 {yearly.price.toLocaleString()}원 일시 결제 · 매년 자동갱신
                </p>
                {monthly && yearlyDiscount > 0 && (
                  <p className="mt-3 text-[12.5px] font-medium" style={{ color: '#3ee7a3' }}>
                    월간 결제 대비 연 {(monthly.price * 12 - yearly.price).toLocaleString()}원 절약
                  </p>
                )}
                <button
                  onClick={scrollToAuth}
                  className="hp-submit hp-cta group mt-6 flex w-full items-center justify-center gap-1.5 rounded-[11px] py-3 text-[14px]"
                >
                  연간으로 시작하기 <ArrowRight className="hp-arrow h-4 w-4 transition-transform" />
                </button>
              </div>
            )}

            {/* 월간 */}
            {monthly && (
              <div
                className="rounded-[20px] border p-7"
                style={{ background: 'rgba(255,255,255,.045)', borderColor: '#31406b' }}
              >
                <span className="text-[14px] font-semibold text-white">월간 결제</span>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-[38px] font-bold tracking-[-0.03em] text-white tabular">
                    {monthly.price.toLocaleString()}
                  </span>
                  <span className="text-[14px] font-medium text-[#b9c2d8]">원 / 월</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-[#98a3bf]">매월 자동결제 · 부담 없이 시작</p>
                <button
                  onClick={scrollToAuth}
                  className="mt-6 w-full rounded-[11px] border py-3 text-[14px] font-medium text-white transition-colors hover:border-[#7cf5ff]/40 hover:bg-[#7cf5ff]/5"
                  style={{ borderColor: '#31406b', background: 'rgba(255,255,255,.045)' }}
                >
                  월간으로 시작하기
                </button>
              </div>
            )}
          </div>

          {/* 포함 기능 */}
          <div className="mt-8 rounded-[16px] border p-6" style={{ borderColor: '#31406b', background: 'rgba(255,255,255,.045)' }}>
            <p className="mb-4 text-[12.5px] font-semibold text-white">두 플랜 모두 포함</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {TOOLS.map(t => (
                <div key={t.label} className="flex items-center gap-2 text-[13px] text-[#dae1f0]">
                  <Check className="h-3.5 w-3.5 shrink-0" style={{ color: '#3ee7a3' }} />
                  {t.label}
                </div>
              ))}
              <div className="flex items-center gap-2 text-[13px] text-[#dae1f0]">
                <Check className="h-3.5 w-3.5 shrink-0" style={{ color: '#3ee7a3' }} />
                내 작업 저장 · 불러오기
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-[12px] leading-relaxed text-[#98a3bf]">
            표시 금액은 부가세 포함입니다. 결제 후 7일 이내 미사용 시 전액 환불되며,
            그 외에는 <a href="/terms.html#refund" target="_blank" rel="noreferrer" className="underline hover:text-white">환불 정책</a>에 따라 처리됩니다.
            <br />결제일 7일 전 이메일로 미리 안내드립니다.
          </p>
        </div>
      </section>

      {/* 다크 테마 푸터 — 전자상거래법 표기 (미로그인 상태에서도 접근 가능해야 함) */}
      <footer className="relative z-[5] border-t" style={{ borderColor: '#31406b', background: 'rgba(7,9,18,.6)', backdropFilter: 'blur(10px)' }}>
        <div className="mx-auto max-w-[1440px] px-4 py-9 sm:px-6 md:px-12 md:py-10">
          {/* 상단 — 유튜브 / 홈페이지 링크 */}
          <div className="text-center">
            <p className="text-[13px] text-[#b9c2d8]">
              이 앱은 <b className="font-semibold text-white">쇼크트리 훈프로</b>에 의해 만들어졌습니다.
              <span className="mx-1">유튜브 구독 및 훈프로 홈페이지 가입 부탁드려요!</span>
            </p>
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
              <a
                href="https://www.youtube.com/@saupsin89"
                target="_blank"
                rel="noreferrer"
                className="hp-chip inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-[12.5px] font-medium transition-all"
                style={{ background: 'rgba(255,255,255,.055)', borderColor: '#31406b', color: '#f5f8ff' }}
              >
                <Youtube className="h-3.5 w-3.5" style={{ color: '#ff5b5b' }} />
                유튜브
              </a>
              <a
                href="https://hoonpro.liveklass.com/"
                target="_blank"
                rel="noreferrer"
                className="hp-chip inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-[12.5px] font-medium transition-all"
                style={{ background: 'rgba(255,255,255,.055)', borderColor: '#31406b', color: '#f5f8ff' }}
              >
                <ExternalLink className="h-3.5 w-3.5" style={{ color: '#7cf5ff' }} />
                훈프로 홈페이지
              </a>
            </div>
          </div>

          {/* 약관·정책 */}
          <div className="mt-7 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[13px]">
            <a href="/terms.html" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center px-1 text-[#b9c2d8] transition-colors hover:text-white hover:underline">이용약관</a>
            <span className="text-[#54628a]">|</span>
            <a href="/privacy.html" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center px-1 font-semibold text-[#f5f8ff] transition-colors hover:text-white hover:underline">개인정보처리방침</a>
            <span className="text-[#54628a]">|</span>
            <a href="/terms.html#refund" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center px-1 text-[#b9c2d8] transition-colors hover:text-white hover:underline">환불 정책</a>
          </div>

          {/* 사업자 정보 (전자상거래법 제10조) */}
          <div className="mt-5 space-y-1 text-center text-[12px] leading-relaxed text-[#98a3bf]">
            <p>
              상호: <span className="text-[#b9c2d8]">{company.name}</span>
              <span className="mx-2 text-[#54628a]">·</span>
              대표: <span className="text-[#b9c2d8]">{company.ceo}</span>
              <span className="mx-2 text-[#54628a]">·</span>
              사업자등록번호: <span className="text-[#b9c2d8] tabular-nums">{company.bizNumber}</span>
              <span className="mx-2 text-[#54628a]">·</span>
              통신판매업신고: <span className="text-[#b9c2d8]">{company.mailOrderNumber}</span>
            </p>
            <p>
              주소: <span className="text-[#b9c2d8]">{company.address}</span>
              <span className="mx-2 text-[#54628a]">·</span>
              이메일: <span className="text-[#b9c2d8]">{company.email}</span>
              <span className="mx-2 text-[#54628a]">·</span>
              전화: <span className="text-[#b9c2d8] tabular-nums">{company.phone}</span>
            </p>
            <p className="pt-1">© {new Date().getFullYear()} {company.name}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* 분석 로우 */
function AnalysisRow({ color, k, v, vClass }: { color: string; k: string; v: string; vClass?: string }) {
  return (
    <div
      className="flex items-center justify-between rounded-[9px] border px-3 py-2 text-[12.5px]"
      style={{ background: 'rgba(255,255,255,.05)', borderColor: 'rgba(255,255,255,.065)' }}
    >
      <span className="flex items-center gap-2 text-[#98a3bf]">
        <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: color }} />
        {k}
      </span>
      <span className={`font-semibold text-white tabular-nums ${vClass ?? ''}`}>{v}</span>
    </div>
  );
}
