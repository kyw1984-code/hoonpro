/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { lazy, Suspense, useState, useEffect, type ReactNode } from 'react';
import { SourcingFinder } from './components/SourcingFinder';
import { RankTracker } from './components/RankTracker';
import { ReviewAnalyzer } from './components/ReviewAnalyzer';
import { Footer } from './components/Layout/Footer';
import { HowTo } from './components/HowTo';
import { Notices } from './components/Notices';
import { Feedback } from './components/Feedback';
import { AuthGate } from './components/Auth/AuthGate';
import { AdReportReceiver } from './components/AdCenter/AdReportReceiver';
import { AD_COLLECT_QUERY } from './lib/adCollector';
import { WingStatsReceiver } from './components/Sourcing/WingStatsReceiver';
import { WING_STATS_QUERY } from './lib/wingStats';
import { WING_COLLECT_QUERY } from './lib/wingCollector';
import { WingCancelReceiver } from './components/Coupang/WingCancelReceiver';
import { AskHoonpro } from './components/QA/AskHoonpro';
import { HomeDashboard } from './components/Home/HomeDashboard';
import { CoupangDashboard } from './components/Coupang/CoupangDashboard';
import { Home, FolderOpen, Image as ImageIcon, BarChart3, LogOut, ShieldCheck, Zap, TrendingUp, ListOrdered, MessageSquareText, MessageCircleQuestion, CreditCard, Lock, ShoppingBag, Loader2, LayoutTemplate, PackagePlus, Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
// 썸네일·상세페이지 제작. 둘이 합쳐 4,400줄이라 반드시 늦게 불러온다.
// 평소에는 꺼져 있어 아무도 안 받고, 켠 날에만 누른 사람이 받는다.
const ThumbnailGenerator = lazy(() => import('./components/Thumbnail/ThumbnailGenerator').then(m => ({ default: m.ThumbnailGenerator })));
const DetailPlanner = lazy(() => import('./components/Detail/DetailPlanner').then(m => ({ default: m.DetailPlanner })));
const Listing = lazy(() => import('./components/Coupang/Listing').then(m => ({ default: m.Listing })));

/** 청크를 받는 동안 보여 줄 것 — 화면이 덜컥 비지 않게 자리를 잡아 둔다 */
function TabLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-ink-3">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-[13px]">불러오는 중...</span>
    </div>
  );
}

type Tab = 'home' | 'works' | 'thumbnail' | 'detail' | 'listing' | 'sourcing' | 'ranktracker' | 'review' | 'analyzer' | 'coupang' | 'qa' | 'billing' | 'admin';

type TabDef = { id: Tab; label: string; icon: typeof ImageIcon };

const TABS: TabDef[] = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'thumbnail', label: '썸네일 제작', icon: ImageIcon },
  { id: 'detail', label: '상세페이지 제작', icon: LayoutTemplate },
  { id: 'listing', label: '상품등록AI', icon: PackagePlus },
  { id: 'sourcing', label: '소싱AI', icon: TrendingUp },
  { id: 'ranktracker', label: '순위추적AI', icon: ListOrdered },
  { id: 'review', label: '리뷰 분석AI', icon: MessageSquareText },
  { id: 'analyzer', label: '광고분석AI', icon: BarChart3 },
  { id: 'coupang', label: '정산AI', icon: ShoppingBag },
  { id: 'qa', label: '훈프로 코칭AI', icon: MessageCircleQuestion },
  { id: 'works', label: '내 작업', icon: FolderOpen },
];

const TAB_ORDER_KEY = 'hoonpro_tab_order';
const HIDDEN_TABS_KEY = 'hoonpro_hidden_tabs';
const IMAGE_ENABLED_KEY = 'hoonpro_image_enabled';

/** 이미지 생성이 켜져 있었나 — 서버 답이 오기 전까지 쓸 마지막 값 */
const loadCachedImageEnabled = (): boolean => {
  try {
    return localStorage.getItem(IMAGE_ENABLED_KEY) === '1';
  } catch {
    // 기본은 꺼짐. 잘못 켜서 잠깐 보이는 것보다, 잘못 꺼서 안 보이는 쪽이 낫다.
    return false;
  }
};

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

/**
 * 왼쪽 메뉴의 무리. 탭이 한 줄에 다 안 들어가 가로로 밀어야 했고, 11개가 나열만
 * 돼 있어 처음 온 사람이 흐름을 못 읽었다. 하는 일로 묶어 세로로 놓는다.
 * 무리 안의 순서는 관리자가 정한 탭 순서(tab_order)를 그대로 따른다.
 */
const TAB_GROUPS: { label: string | null; ids: Tab[] }[] = [
  { label: null, ids: ['home'] },
  { label: '상품 찾기', ids: ['sourcing', 'ranktracker', 'review'] },
  { label: '만들고 등록하기', ids: ['listing', 'detail', 'thumbnail'] },
  { label: '판매 관리', ids: ['coupang', 'analyzer'] },
  { label: '도움', ids: ['qa', 'works'] },
];

const SIDEBAR_COLLAPSED_KEY = 'hoonpro_sidebar_collapsed';

const getNavItemClass = (active: boolean, collapsed: boolean): string => (
  `flex w-full items-center gap-2.5 rounded-control text-[14.5px] transition-colors ${
    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
  } ${
    active
      ? 'bg-accent-soft text-accent font-semibold'
      : 'text-ink-2 font-medium hover:bg-paper-2 hover:text-ink'
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
  // 왼쪽 메뉴 접기(아이콘만) — 표를 넓게 볼 때. 고른 상태를 기억한다
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const toggleNavCollapsed = () => setNavCollapsed(v => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '0' : '1'); } catch { /* 무시 */ }
    return !v;
  });
  // 좁은 화면(휴대폰)에서는 ☰ 버튼으로 여는 메뉴
  const [navOpen, setNavOpen] = useState(false);
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null);
  const [qaVisible, setQaVisible] = useState(false);
  const [tabOrder, setTabOrder] = useState<string[] | null>(loadCachedTabOrder);
  // 관리자가 숨긴 기능. 캐시로 먼저 그려야 새로고침할 때마다 숨긴 탭이
  // 잠깐 보였다 사라지는 깜빡임이 없다.
  const [hiddenTabs, setHiddenTabs] = useState<string[]>(loadCachedHiddenTabs);
  /**
   * 썸네일·상세페이지 제작을 지금 쓸 수 있나.
   *
   * 스위치는 [한도 설정]의 '이미지 생성' 하나다. 0이면 서버가 생성을 막고
   * 여기서 두 탭도 감춘다. 0보다 크면 둘 다 열린다. 스위치를 둘로 두면
   * 한쪽만 켰을 때 탭은 보이는데 누르면 "제공하지 않습니다"가 뜨거나,
   * 반대로 쓸 수는 있는데 들어갈 길이 없다.
   *
   * 캐시로 먼저 그린다. 새로고침할 때마다 꺼진 탭이 잠깐 보였다 사라지면
   * 그것대로 눈에 거슬린다.
   */
  const [imageEnabled, setImageEnabled] = useState<boolean>(loadCachedImageEnabled);

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
        if (typeof data.imageEnabled === 'boolean') {
          setImageEnabled(data.imageEnabled);
          localStorage.setItem(IMAGE_ENABLED_KEY, data.imageEnabled ? '1' : '0');
        }
      } catch { /* 실패 시 기본 순서·표시 유지 */ }
    })();
  }, []);

  // 관리자는 숨긴 기능도 볼 수 있어야 한다. 수강생에게 열기 전에 직접
  // 써 보고 판단해야 하므로, 감추는 대신 '숨김' 표시만 붙인다.
  const isHidden = (id: string) => {
    // 이미지 생성이 꺼져 있으면 만드는 탭 둘은 아무에게도 안 보인다.
    // 관리자에게도 감춘다 — 켜고 끄는 곳이 [한도 설정] 한 군데라야
    // "켰는데 왜 안 되지"가 생기지 않는다.
    if ((id === 'thumbnail' || id === 'detail') && !imageEnabled) return true;
    return !user?.isAdmin && hiddenTabs.includes(id);
  };

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

  // 로그인한 화면은 밝은 테마. 토큰만 바꾸므로 html에 붙여 두면 창(모달)까지 함께 밝아진다.
  // 로그인 전(랜딩·가입) 화면은 지금의 어두운 디자인을 그대로 둔다.
  useEffect(() => {
    const root = document.documentElement;
    if (user) root.classList.add('theme-light'); else root.classList.remove('theme-light');
    return () => root.classList.remove('theme-light');
  }, [user]);

  const handleLogout = () => {
    removeToken();
    setUser(null);
    setRemainingCalls(null);
  };

  // 토큰은 7일이면 끝난다. 탭을 그대로 열어 둔 채 넘기면 화면은 로그인 상태인데
  // 요청마다 "인증이 필요합니다"만 떴다 — getUser()가 만료 토큰을 지우는데 user
  // 상태는 그대로였기 때문. 탭으로 돌아올 때와 1분마다 확인해 로그인 화면으로 보낸다.
  useEffect(() => {
    if (!user) return;
    const check = () => {
      if (!getUser()) {
        setUser(null);
        setRemainingCalls(null);
        alert('로그인이 만료됐습니다. 다시 로그인해주세요.');
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  if (!user) {
    // AuthGate 내부에서 다크 테마 푸터를 렌더링
    return <AuthGate onSuccess={() => setUser(getUser())} />;
  }

  // 광고센터 북마클릿이 연 창. 보고서를 받아 저장하는 것 말고는 아무것도 안 보여준다 —
  // 여기서 탭까지 다 그리면 사용자가 원래 창과 헷갈린다.
  if (new URLSearchParams(window.location.search).get(AD_COLLECT_QUERY) === '1') {
    return <AdReportReceiver />;
  }
  // 소싱AI의 윙 판매 데이터 즐겨찾기가 연 창 — 조회수·판매량을 받아 저장만 한다
  if (new URLSearchParams(window.location.search).get(WING_STATS_QUERY) === '1') {
    return <WingStatsReceiver />;
  }
  // 윙 판매분석 즐겨찾기가 연 창 — 파일을 받아 취소를 반영하는 것만 한다
  if (new URLSearchParams(window.location.search).get(WING_COLLECT_QUERY) === '1') {
    return <WingCancelReceiver />;
  }

  // 왼쪽 메뉴 본문 — 넓은 화면의 고정 메뉴와 휴대폰의 열리는 메뉴가 같이 쓴다
  const renderNav = (collapsed: boolean, onPick: () => void) => {
    const visible = applyTabOrder(tabOrder)
      .filter(tab => tab.id !== 'qa' || qaVisible)
      .filter(tab => !isHidden(tab.id));
    const grouped = new Set<string>(TAB_GROUPS.flatMap(g => g.ids));
    const groups = [
      ...TAB_GROUPS.map(g => ({ label: g.label, tabs: visible.filter(t => g.ids.includes(t.id)) })),
      // 무리에 안 든 새 탭이 생겨도 사라지지 않게
      { label: '기타', tabs: visible.filter(t => !grouped.has(t.id)) },
    ].filter(g => g.tabs.length > 0);
    const item = (id: Tab, label: string, Icon: typeof ImageIcon, extra?: ReactNode) => (
      <button
        key={id}
        type="button"
        onClick={() => { setActiveTab(id); onPick(); }}
        aria-current={activeTab === id ? 'page' : undefined}
        title={collapsed ? label : undefined}
        className={getNavItemClass(activeTab === id, collapsed)}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && extra}
      </button>
    );
    return (
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-3">
        {groups.map((g, gi) => (
          <div key={g.label ?? 'top'} className={gi > 0 ? 'mt-4' : ''}>
            {g.label && (collapsed
              ? <div className="mx-2 mb-2 border-t border-line" />
              : <p className="mb-1 px-3 text-[11.5px] font-semibold tracking-wide text-ink-3">{g.label}</p>)}
            <div className="flex flex-col gap-0.5">
              {g.tabs.map(tab => item(tab.id, tab.label, tab.icon,
                user.isAdmin && hiddenTabs.includes(tab.id)
                  ? <span className="ml-auto rounded-control border border-line px-1 py-0.5 text-[9.5px] font-semibold text-ink-3" title="수강생에게는 보이지 않습니다">숨김</span>
                  : undefined))}
            </div>
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
          {item('billing', '구독 관리', CreditCard)}
          {user.isAdmin && item('admin', '관리자', ShieldCheck)}
        </div>
      </nav>
    );
  };

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
          <div className="flex h-14 items-center justify-between gap-2 px-3 sm:gap-4 sm:px-5">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="메뉴 열기"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-paper-2 hover:text-ink lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
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
                    color: 'var(--color-caution)',
                  }}
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>오늘 {remainingCalls}회</span>
                </span>
              )}
              {/* 공지사항 — 업데이트·점검 안내. 사용 방법 왼쪽, 늘 같은 자리 */}
              <Notices compact className="sm:hidden" />
              <Notices className="hidden sm:flex" />
              {/* 지금 보고 있는 화면의 사용 방법. 늘 같은 자리에 있어야 찾지 않는다 */}
              <HowTo id={activeTab} compact className="sm:hidden" />
              <HowTo id={activeTab} className="hidden sm:flex" />
              {/* 소통 창구는 여기 하나뿐이다. 전화·카톡 상담은 응답 시간이 기대치가 된다 */}
              <Feedback area={activeTab} />
              <span className="hidden whitespace-nowrap text-[13px] font-medium text-ink sm:inline">{user.name}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 whitespace-nowrap rounded-control px-2 py-1 text-[14px] text-ink-2 transition-colors hover:bg-white/5 hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />로그아웃
              </button>
            </div>
          </div>

        </header>

        <div className="flex flex-1">
          {/* ─── 왼쪽 메뉴 (넓은 화면) ─── */}
          <aside
            className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r border-line bg-paper lg:flex ${navCollapsed ? 'w-[68px]' : 'w-[216px]'}`}
            aria-label="주요 기능"
          >
            {renderNav(navCollapsed, () => {})}
            <button
              type="button"
              onClick={toggleNavCollapsed}
              className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12.5px] text-ink-3 hover:text-ink"
              title={navCollapsed ? '메뉴 펼치기' : '메뉴 접기'}
            >
              {navCollapsed ? <PanelLeftOpen className="mx-auto h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" />메뉴 접기</>}
            </button>
          </aside>

          {/* ─── 좁은 화면: ☰로 여는 메뉴 ─── */}
          {navOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-ink/40" onClick={() => setNavOpen(false)} />
              <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col bg-paper shadow-overlay" aria-label="주요 기능">
                <div className="flex h-14 items-center justify-between border-b border-line px-4">
                  <span className="text-[14px] font-semibold text-ink">메뉴</span>
                  <button type="button" onClick={() => setNavOpen(false)} aria-label="메뉴 닫기" className="rounded-control p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {renderNav(false, () => setNavOpen(false))}
              </aside>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
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
              {shownTab === 'thumbnail' && <ThumbnailGenerator />}
              {shownTab === 'detail' && <DetailPlanner />}
              {shownTab === 'listing' && <Listing />}
              {shownTab === 'sourcing' && <SourcingFinder />}
              {shownTab === 'ranktracker' && <RankTracker />}
              {shownTab === 'review' && <ReviewAnalyzer />}
              {shownTab === 'analyzer' && <AdAnalyzer />}
              {shownTab === 'coupang' && <CoupangDashboard hiddenTabs={user.isAdmin ? [] : hiddenTabs} adminHidden={user.isAdmin ? hiddenTabs : []} />}
              {shownTab === 'works' && <WorksLibrary onNavigate={(t) => setActiveTab(t as Tab)} />}
              {shownTab === 'qa' && qaVisible && <AskHoonpro />}
              {activeTab === 'billing' && <SubscriptionPage />}
              {activeTab === 'admin' && user.isAdmin && <AdminPanel />}
            </Suspense>
          )}
        </main>

      <Footer />
          </div>
        </div>
    </div>
  );
}
