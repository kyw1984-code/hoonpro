/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect } from 'react';
import { DetailPlanner } from './components/Detail/DetailPlanner';
import { SourcingFinder } from './components/SourcingFinder';
import { ThumbnailGenerator } from './components/Thumbnail/ThumbnailGenerator';
import { AdAnalyzer } from './components/Analyzer/AdAnalyzer';
import { ProductNameGenerator } from './components/ProductName/ProductNameGenerator';
import { RankTracker } from './components/RankTracker';
import { ReviewAnalyzer } from './components/ReviewAnalyzer';
import { ApiKeyCheck } from './components/ApiKeyCheck';
import { Footer } from './components/Layout/Footer';
import { AuthGate } from './components/Auth/AuthGate';
import { AdminPanel } from './components/Admin/AdminPanel';
import { SubscriptionPage } from './components/Billing/SubscriptionPage';
import { AskHoonpro } from './components/QA/AskHoonpro';
import { LayoutTemplate, Image as ImageIcon, BarChart3, Tag, LogOut, ShieldCheck, Zap, TrendingUp, ListOrdered, MessageSquareText, MessageCircleQuestion, CreditCard, Lock } from 'lucide-react';
import { getUser, getToken, removeToken, type AuthUser } from './lib/auth';
import { fetchBillingStatus, type BillingStatus } from './lib/billing';

type Tab = 'thumbnail' | 'detail' | 'sourcing' | 'ranktracker' | 'review' | 'analyzer' | 'productname' | 'qa' | 'billing' | 'admin';

type TabDef = { id: Tab; label: string; icon: typeof ImageIcon };

const TABS: TabDef[] = [
  { id: 'thumbnail', label: '썸네일 제작', icon: ImageIcon },
  { id: 'detail', label: '상세페이지 제작', icon: LayoutTemplate },
  { id: 'sourcing', label: '훈프로 소싱AI', icon: TrendingUp },
  { id: 'ranktracker', label: '순위 추적', icon: ListOrdered },
  { id: 'review', label: '리뷰 분석', icon: MessageSquareText },
  { id: 'analyzer', label: '광고 성과 분석', icon: BarChart3 },
  { id: 'productname', label: '상품명 제조기', icon: Tag },
  { id: 'qa', label: '훈프로에게 질문', icon: MessageCircleQuestion },
];

// 밑줄형 탭 — 개수가 늘어도 줄바꿈으로 무너지지 않고 헤더 높이가 일정하게 유지된다.
const getTabButtonClass = (active: boolean): string => (
  `relative flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] transition-colors -mb-px ${
    active
      ? 'border-ink text-ink font-semibold'
      : 'border-transparent text-ink-2 font-medium hover:text-ink'
  }`
);

// 토스 카드 등록에서 돌아온 리다이렉트는 구독 탭에서 이어서 처리한다
const initialTab = (): Tab =>
  window.location.search.includes('billingAuth') ? 'billing' : 'thumbnail';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null);
  // '훈프로에게 질문' 수강생 공개 여부 — OFF면 수강생에게 탭 자체를 숨김 (관리자는 항상 표시)
  const [qaVisible, setQaVisible] = useState(false);

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

  // 유료화 강제(billing_enforced) 시 구독 없는 계정의 기능 잠금
  const [billingLocked, setBillingLocked] = useState(false);

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
    window.addEventListener('usage-updated', handler);
    window.addEventListener('billing-updated', billingHandler);
    return () => {
      window.removeEventListener('usage-updated', handler);
      window.removeEventListener('billing-updated', billingHandler);
    };
  }, []);

  const handleLogout = () => {
    removeToken();
    setUser(null);
    setRemainingCalls(null);
  };

  if (!user) {
    // 로그인 전 화면에도 사업자 정보·약관 표기 (전자상거래법·PG 심사 요건)
    return (
      <div className="flex min-h-screen flex-col bg-ground">
        <AuthGate onSuccess={() => setUser(getUser())} />
        <Footer />
      </div>
    );
  }

  return (
    <ApiKeyCheck>
      <div className="min-h-screen bg-paper-2 flex flex-col font-sans">
        <header className="bg-paper border-b border-line sticky top-0 z-20">
          {/* 상단 줄 — 브랜드와 계정 */}
          <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between gap-4 px-6">
            <div className="flex shrink-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-ink">
                <LayoutTemplate className="h-4 w-4 text-paper" />
              </div>
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">
                쇼크트리 훈프로 <span className="text-ink-3 font-medium">AI 자동화</span>
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {!user.isAdmin && remainingCalls !== null && (
                <span className="hidden items-center gap-1.5 rounded-full border border-line bg-paper-2 px-2.5 py-1 text-xs text-ink-2 sm:inline-flex">
                  <Zap className="h-3.5 w-3.5 text-caution" />
                  <span className="tabular">오늘 {remainingCalls}회</span>
                </span>
              )}
              <span className="hidden whitespace-nowrap text-[13px] font-medium text-ink sm:inline">{user.name}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 whitespace-nowrap rounded-control px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />로그아웃
              </button>
            </div>
          </div>

          {/* 아래 줄 — 탭 */}
          <div className="border-t border-line">
            <nav className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-6" aria-label="주요 기능">
              {TABS.filter(tab => tab.id !== 'qa' || qaVisible).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={getTabButtonClass(activeTab === tab.id)}
                >
                  <tab.icon className="h-4 w-4 shrink-0" />{tab.label}
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
            /* 유료화 이후 구독이 없으면 기능 대신 구독 시작 화면을 보여준다 (데이터는 보존됨) */
            <div className="py-8">
              <div className="mx-auto mb-5 flex w-full max-w-[720px] items-start gap-2.5 rounded-panel border border-line bg-paper px-6 py-4">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                <p className="text-[13px] leading-relaxed text-ink-2">
                  훈프로가 구독제로 전환됐습니다. 구독을 시작하면 모든 기능과 기존 데이터(관심 키워드·순위 추적 이력)를 그대로 이용할 수 있습니다.
                </p>
              </div>
              <SubscriptionPage />
            </div>
          ) : (
            <>
              {activeTab === 'thumbnail' && <ThumbnailGenerator />}
              {activeTab === 'detail' && <DetailPlanner />}
              {activeTab === 'sourcing' && <SourcingFinder />}
              {activeTab === 'ranktracker' && <RankTracker />}
              {activeTab === 'review' && <ReviewAnalyzer />}
              {activeTab === 'analyzer' && <AdAnalyzer />}
              {activeTab === 'productname' && <ProductNameGenerator />}
              {activeTab === 'qa' && qaVisible && <AskHoonpro />}
              {activeTab === 'billing' && <SubscriptionPage />}
              {activeTab === 'admin' && user.isAdmin && <AdminPanel />}
            </>
          )}
        </main>

        <Footer />
      </div>
    </ApiKeyCheck>
  );
}
