/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { lazy, Suspense, useState, useEffect } from 'react';
import { SourcingFinder } from './components/SourcingFinder';
import { RankTracker } from './components/RankTracker';
import { ReviewAnalyzer } from './components/ReviewAnalyzer';
import { Footer } from './components/Layout/Footer';
import { HowTo } from './components/HowTo';
import { Feedback } from './components/Feedback';
import { AuthGate } from './components/Auth/AuthGate';
import { AdReportReceiver } from './components/AdCenter/AdReportReceiver';
import { AD_COLLECT_QUERY } from './lib/adCollector';
import { AskHoonpro } from './components/QA/AskHoonpro';
import { HomeDashboard } from './components/Home/HomeDashboard';
import { CoupangDashboard } from './components/Coupang/CoupangDashboard';
import { Home, FolderOpen, Image as ImageIcon, BarChart3, LogOut, ShieldCheck, Zap, TrendingUp, ListOrdered, MessageSquareText, MessageCircleQuestion, CreditCard, Lock, ShoppingBag, Loader2 } from 'lucide-react';
import { getUser, getToken, removeToken, type AuthUser } from './lib/auth';
import { fetchBillingStatus, type BillingStatus } from './lib/billing';


/**
 * 늦게 불러오는 화면들.
 *
 * 자바스크립트가 한 덩어리라 첫 화면을 열 때 모든 탭의 코드를 다 받았다.
 * 관리자 패널은 운영자만 열고, 구독 관리는 한 달에 한 번, 광고 분석은 보고서를
 * 올릴 때만 연다. 내 작업은 내린 기능의 보관함이라 여는 사람이 거의 없다.
 * 누른 사람만 받게 한다.
 */
const AdminPanel = lazy(() => import('./components/Admin/AdminPanel').then(m => ({ default: m.AdminPanel })));
const SubscriptionPage = lazy(() => import('./components/Billing/SubscriptionPage').then(m => ({ default: m.SubscriptionPage })));
const AdAnalyzer = lazy(() => import('./components/Analyzer/AdAnalyzer').then(m => ({ default: m.AdAnalyzer })));
const WorksLibrary = lazy(() => import('./components/Works/WorksLibrary').then(m => ({ default: m.WorksLibrary })));

/** 청크를 받는 동안 보여 줄 것 — 화면이 덜컥 비지 않게 자리를 잡아 둔다 */
function TabLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-ink-3">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-[13px]">불러오는 중...</span>
    </div>
  );
}

type Tab = 'home' | 'works' | 'sourcing' | 'ranktracker' | 'review' | 'analyzer' | 'coupang' | 'qa' | 'billing' | 'admin';

type TabDef = { id: Tab; label: string; icon: typeof ImageIcon };

const TABS: TabDef[] = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'sourcing', label: '훈프로 소싱AI', icon: TrendingUp },
  { id: 'ranktracker', label: '순위 추적', icon: ListOrdered },
  { id: 'review', label: '리뷰 분석', icon: MessageSquareText },
  { id: 'analyzer', label: '광고 성과 분석', icon: BarChart3 },
  { id: 'coupang', label: '훈프로 정산AI', icon: ShoppingBag },
  { id: 'qa', label: '훈프로 코칭AI', icon: MessageCircleQuestion },
  { id: 'works', label: '내 작업', icon: FolderOpen },
];

const TAB_ORDER_KEY = 'hoonpro_tab_order';
const HIDDEN_TABS_KEY = 'hoonpro_hidden_tabs';

const loadCachedHiddenTabs = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_TABS_KEY) || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const loadCachedTabOrder = (): string[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

const applyTabOrder = (order: string[] | null): TabDef[] => {
  if (!order || order.length === 0) return TABS;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...TABS].sort((a, b) => {
    const ai = pos.has(a.id) ? pos.get(a.id)! : 100 + TABS.findIndex(t => t.id === a.id);
    const bi = pos.has(b.id) ? pos.get(b.id)! : 100 + TABS.findIndex(t => t.id === b.id);
    return ai - bi;
  });
};

/**
 * 다크 테크 탭 — 활성 탭에 시안 언더라인 + 상단 미세 글로우
 */
const getTabButtonClass = (active: boolean): string => (
  `relative flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] transition-all -mb-px ${
    active
      ? 'border-accent text-ink font-semibold'
      : 'border-transparent text-ink-3 font-medium hover:text-ink hover:bg-white/[0.02]'
  }`
);

// 주소의 tab= 으로 첫 화면을 고를 수 있다. 광고센터 수신 창의 [순이익 보러 가기]처럼
// 다른 창에서 특정 화면으로 보내야 할 때 쓴다. 모르는 값이면 홈이다.
const initialTab = (): Tab => {
  if (window.location.search.includes('billingAuth')) return 'billing';
  const wanted = new URLSearchParams(window.location.search).get('tab');
  if (wanted && (TABS as ReadonlyArray<{ id: string }>).some(t => t.id === wanted)) return wanted as Tab;
  return 'home';
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null);
  const [qaVisible, setQaVisible] = useState(false);
  const [tabOrder, setTabOrder] = useState<string[] | null>(loadCachedTabOrder);
  // 관리자가 숨긴 기능. 캐시로 먼저 그려야 새로고침할 때마다 숨긴 탭이
  // 잠깐 보였다 사라지는 깜빡임이 없다.
  const [hiddenTabs, setHiddenTabs] = useState<string[]>(loadCachedHiddenTabs);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin?action=config');
        const data = await res.json();
        if (!res.ok) return;
        if (Array.isArray(data.tabOrder)) {
          setTabOrder(data.tabOrder);
          localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(data.tabOrder));
        }
        if (Array.isArray(data.hiddenTabs)) {
          setHiddenTabs(data.hiddenTabs.map(String));
          localStorage.setItem(HIDDEN_TABS_KEY, JSON.stringify(data.hiddenTabs));
        }
      } catch { /* 실패 시 기본 순서·표시 유지 */ }
    })();
  }, []);

  // 관리자는 숨긴 기능도 볼 수 있어야 한다. 수강생에게 열기 전에 직접
  // 써 보고 판단해야 하므로, 감추는 대신 '숨김' 표시만 붙인다.
  const isHidden = (id: string) => !user?.isAdmin && hiddenTabs.includes(id);

  // 보고 있던 탭이 숨겨지면 빈 화면에 남는다. 홈으로 돌려보낸다.
  useEffect(() => {
    if (isHidden(activeTab)) setActiveTab('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenTabs, activeTab, user]);

  // 위 효과가 돌기 전 한 프레임 동안 숨긴 화면이 비치는 것을 막는다
  const shownTab: Tab = isHidden(activeTab) ? 'home' : activeTab;

  useEffect(() => {
    if (!user) return;
    if (user.isAdmin) {
      setQaVisible(true);
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/qa?action=status', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();
        setQaVisible(res.ok && data.canUse === true);
      } catch {
        setQaVisible(false);
      }
    })();
  }, [user]);

  const [billingLocked, setBillingLocked] = useState(false);
  // 402(구독 필요)에 막혔을 때 띄우는 안내 — 구독 관리로 바로 이동시킨다
  const [subPrompt, setSubPrompt] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const applyBillingStatus = (s: BillingStatus, u: AuthUser | null) => {
    const subOk = s.subscription && ['trial', 'active', 'past_due'].includes(s.subscription.status);
    setBillingLocked(Boolean(s.billingEnforced) && !subOk && !u?.isAdmin);
  };

  useEffect(() => {
    if (!user) return;
    fetchBillingStatus()
      .then(s => applyBillingStatus(s, user))
      .catch(() => setBillingLocked(false));
  }, [user]);

  useEffect(() => {
    const handler = (e: Event) => {
      setRemainingCalls((e as CustomEvent).detail.remaining);
    };
    const billingHandler = (e: Event) => {
      applyBillingStatus((e as CustomEvent).detail as BillingStatus, getUser());
    };
    const subRequiredHandler = (e: Event) => {
      setSubPrompt((e as CustomEvent).detail?.message || '구독 후 이용할 수 있습니다.');
    };
    const unavailableHandler = (e: Event) => {
      setUnavailable((e as CustomEvent).detail?.message || '이 기능은 현재 제공하지 않습니다.');
    };
    window.addEventListener('usage-updated', handler);
    window.addEventListener('billing-updated', billingHandler);
    window.addEventListener('subscription-required', subRequiredHandler);
    window.addEventListener('feature-unavailable', unavailableHandler);
    return () => {
      window.removeEventListener('usage-updated', handler);
      window.removeEventListener('billing-updated', billingHandler);
      window.removeEventListener('subscription-required', subRequiredHandler);
      window.removeEventListener('feature-unavailable', unavailableHandler);
    };
  }, []);

  const handleLogout = () => {
    removeToken();
    setUser(null);
    setRemainingCalls(null);
  };

  if (!user) {
    // AuthGate 내부에서 다크 테마 푸터를 렌더링
    return <AuthGate onSuccess={() => setUser(getUser())} />;
  }

  // 광고센터 북마클릿이 연 창. 보고서를 받아 저장하는 것 말고는 아무것도 안 보여준다 —
  // 여기서 탭까지 다 그리면 사용자가 원래 창과 헷갈린다.
  if (new URLSearchParams(window.location.search).get(AD_COLLECT_QUERY) === '1') {
    return <AdReportReceiver />;
  }

  return (
    <div className="min-h-screen bg-ground flex flex-col font-sans">
        {/* ─── 구독 필요 안내 ─── */}
        {unavailable && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setUnavailable(null)}
          >
            <div
              className="w-full max-w-[400px] rounded-panel border border-line bg-paper p-6 shadow-overlay"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-control bg-paper-2">
                <Lock className="h-5 w-5 text-ink-3" />
              </div>
              <h2 className="text-[17px] font-semibold text-ink">이용할 수 없는 기능입니다</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{unavailable}</p>
              <button
                type="button"
                onClick={() => setUnavailable(null)}
                className="mt-5 min-h-[44px] w-full rounded-control border border-line px-4 text-[14px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                확인
              </button>
            </div>
          </div>
        )}

        {subPrompt && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setSubPrompt(null)}
          >
            <div
              className="w-full max-w-[400px] rounded-panel border border-line bg-paper p-6 shadow-overlay"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft">
                <Lock className="h-5 w-5 text-accent" />
              </div>
              <h2 className="text-[17px] font-semibold text-ink">구독이 필요합니다</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{subPrompt}</p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setSubPrompt(null); setActiveTab('billing'); }}
                  className="min-h-[44px] flex-1 rounded-control bg-accent px-4 text-[14px] font-bold text-ground transition-opacity hover:opacity-90"
                >
                  구독하러 가기
                </button>
                <button
                  type="button"
                  onClick={() => setSubPrompt(null)}
                  className="min-h-[44px] rounded-control border border-line px-4 text-[14px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── 다크 테크 헤더 ─── */}
        <header className="sticky top-0 z-20 backdrop-blur-xl bg-ground/75 border-b border-line">
          {/* 상단 줄 — 브랜드와 계정 */}
          <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              aria-label="홈으로 이동"
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-opacity hover:opacity-80"
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-[13px] font-extrabold"
                style={{
                  background: 'linear-gradient(135deg,#7cf5ff 0%,#8b7bff 100%)',
                  color: '#131d36',
                  boxShadow: '0 4px 14px rgba(124,245,255,.25)',
                }}
              >
                훈
              </div>
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">
                쇼크트리 훈프로 <span className="hidden text-ink-3 font-medium sm:inline">AI 자동화</span>
              </h1>
            </button>

            <div className="flex shrink-0 items-center gap-3">
              {/* 무제한은 -1로 온다. 그대로 두면 "오늘 -1회"가 된다 */}
              {!user.isAdmin && remainingCalls !== null && remainingCalls >= 0 && (
                <span
                  className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:inline-flex tabular"
                  style={{
                    background: 'rgba(255,180,84,.08)',
                    border: '1px solid rgba(255,180,84,.22)',
                    color: '#ffb454',
                  }}
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>오늘 {remainingCalls}회</span>
                </span>
              )}
              {/* 지금 보고 있는 화면의 사용 방법. 늘 같은 자리에 있어야 찾지 않는다 */}
              <HowTo id={activeTab} compact className="sm:hidden" />
              <HowTo id={activeTab} className="hidden sm:flex" />
              {/* 소통 창구는 여기 하나뿐이다. 전화·카톡 상담은 응답 시간이 기대치가 된다 */}
              <Feedback area={activeTab} />
              <span className="hidden whitespace-nowrap text-[13px] font-medium text-ink sm:inline">{user.name}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 whitespace-nowrap rounded-control px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-white/5 hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />로그아웃
              </button>
            </div>
          </div>

          {/* 아래 줄 — 탭 */}
          <div className="border-t border-line">
            <nav className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-4 sm:px-6" aria-label="주요 기능">
              {applyTabOrder(tabOrder)
                .filter(tab => tab.id !== 'qa' || qaVisible)
                .filter(tab => !isHidden(tab.id))
                .map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={getTabButtonClass(activeTab === tab.id)}
                >
                  <tab.icon className="h-4 w-4 shrink-0" />{tab.label}
                  {user.isAdmin && hiddenTabs.includes(tab.id) && (
                    <span
                      className="rounded-control border border-line px-1 py-0.5 text-[9.5px] font-semibold text-ink-3"
                      title="수강생에게는 보이지 않습니다"
                    >
                      숨김
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={() => setActiveTab('billing')}
                aria-current={activeTab === 'billing' ? 'page' : undefined}
                className={`${getTabButtonClass(activeTab === 'billing')} ml-auto`}
              >
                <CreditCard className="h-4 w-4 shrink-0" />구독 관리
              </button>
              {user.isAdmin && (
                <button
                  onClick={() => setActiveTab('admin')}
                  aria-current={activeTab === 'admin' ? 'page' : undefined}
                  className={getTabButtonClass(activeTab === 'admin')}
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />관리자
                </button>
              )}
            </nav>
          </div>
        </header>

        <main className={`flex-grow ${activeTab === 'analyzer' || activeTab === 'sourcing' ? '' : 'py-8'}`}>
          {billingLocked && activeTab !== 'billing' && activeTab !== 'admin' ? (
            <div className="py-8">
              <div className="mx-auto mb-5 flex w-full max-w-[720px] items-start gap-2.5 rounded-panel border border-line bg-paper px-6 py-4">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                <p className="text-[13px] leading-relaxed text-ink-2">
                  훈프로가 구독제로 전환됐습니다. 구독을 시작하면 모든 기능과 기존 데이터(관심 키워드·순위 추적 이력)를 그대로 이용할 수 있습니다.
                </p>
              </div>
              <Suspense fallback={<TabLoading />}><SubscriptionPage /></Suspense>
            </div>
          ) : (
            // 늦게 불러오는 화면은 Suspense 안에 둔다. 청크를 받는 동안
            // 화면이 덜컥 비지 않게 자리를 잡아 준다.
            <Suspense fallback={<TabLoading />}>
              {shownTab === 'home' && <HomeDashboard onNavigate={(t) => setActiveTab(t as Tab)} hiddenTabs={user.isAdmin ? [] : hiddenTabs} />}
              {shownTab === 'sourcing' && <SourcingFinder />}
              {shownTab === 'ranktracker' && <RankTracker />}
              {shownTab === 'review' && <ReviewAnalyzer />}
              {shownTab === 'analyzer' && <AdAnalyzer />}
              {shownTab === 'coupang' && <CoupangDashboard />}
              {shownTab === 'works' && <WorksLibrary />}
              {shownTab === 'qa' && qaVisible && <AskHoonpro />}
              {activeTab === 'billing' && <SubscriptionPage />}
              {activeTab === 'admin' && user.isAdmin && <AdminPanel />}
            </Suspense>
          )}
        </main>

      <Footer />
    </div>
  );
}
