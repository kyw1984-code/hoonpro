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
import { LayoutTemplate, Image as ImageIcon, BarChart3, Tag, LogOut, ShieldCheck, Zap, TrendingUp, ListOrdered, MessageSquareText, MessageCircleQuestion } from 'lucide-react';
import { AskHoonpro } from './components/QA/AskHoonpro';
import { getUser, getToken, removeToken, type AuthUser } from './lib/auth';

type Tab = 'thumbnail' | 'detail' | 'sourcing' | 'ranktracker' | 'review' | 'analyzer' | 'productname' | 'qa' | 'admin';

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

// 관리자가 저장한 탭 순서 (app_config.tab_order). 로컬 캐시로 첫 화면 깜빡임을 막는다.
const TAB_ORDER_KEY = 'hoonpro_tab_order';

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
  // 저장 이후 추가된 새 탭은 기본 순서를 유지하며 뒤쪽에 배치
  return [...TABS].sort((a, b) => {
    const ai = pos.has(a.id) ? pos.get(a.id)! : 100 + TABS.findIndex(t => t.id === a.id);
    const bi = pos.has(b.id) ? pos.get(b.id)! : 100 + TABS.findIndex(t => t.id === b.id);
    return ai - bi;
  });
};

// 밑줄형 탭 — 개수가 늘어도 줄바꿈으로 무너지지 않고 헤더 높이가 일정하게 유지된다.
const getTabButtonClass = (active: boolean): string => (
  `relative flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] transition-colors -mb-px ${
    active
      ? 'border-ink text-ink font-semibold'
      : 'border-transparent text-ink-2 font-medium hover:text-ink'
  }`
);

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);
  const [activeTab, setActiveTab] = useState<Tab>('thumbnail');
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null);
  // '훈프로에게 질문' 수강생 공개 여부 — OFF면 수강생에게 탭 자체를 숨김 (관리자는 항상 표시)
  const [qaVisible, setQaVisible] = useState(false);
  const [tabOrder, setTabOrder] = useState<string[] | null>(loadCachedTabOrder);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/config'); // 비관리자에게는 tabOrder만 공개
        const data = await res.json();
        if (res.ok && Array.isArray(data.tabOrder)) {
          setTabOrder(data.tabOrder);
          localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(data.tabOrder));
        }
      } catch { /* 실패 시 기본 순서 유지 */ }
    })();
  }, []);

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

  useEffect(() => {
    const handler = (e: Event) => {
      setRemainingCalls((e as CustomEvent).detail.remaining);
    };
    window.addEventListener('usage-updated', handler);
    return () => window.removeEventListener('usage-updated', handler);
  }, []);

  const handleLogout = () => {
    removeToken();
    setUser(null);
    setRemainingCalls(null);
  };

  if (!user) {
    return <AuthGate onSuccess={() => setUser(getUser())} />;
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
              {applyTabOrder(tabOrder).filter(tab => tab.id !== 'qa' || qaVisible).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={getTabButtonClass(activeTab === tab.id)}
                >
                  <tab.icon className="h-4 w-4 shrink-0" />{tab.label}
                </button>
              ))}
              {user.isAdmin && (
                <button
                  onClick={() => setActiveTab('admin')}
                  aria-current={activeTab === 'admin' ? 'page' : undefined}
                  className={`${getTabButtonClass(activeTab === 'admin')} ml-auto`}
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />관리자
                </button>
              )}
            </nav>
          </div>
        </header>

        <main className={`flex-grow ${activeTab === 'analyzer' || activeTab === 'sourcing' ? '' : 'py-8'}`}>
          {activeTab === 'thumbnail' && <ThumbnailGenerator />}
          {activeTab === 'detail' && <DetailPlanner />}
          {activeTab === 'sourcing' && <SourcingFinder />}
          {activeTab === 'ranktracker' && <RankTracker />}
          {activeTab === 'review' && <ReviewAnalyzer />}
          {activeTab === 'analyzer' && <AdAnalyzer />}
          {activeTab === 'productname' && <ProductNameGenerator />}
          {activeTab === 'qa' && qaVisible && <AskHoonpro />}
          {activeTab === 'admin' && user.isAdmin && <AdminPanel />}
        </main>

        <Footer />
      </div>
    </ApiKeyCheck>
  );
}
