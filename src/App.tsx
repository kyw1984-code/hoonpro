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
import { ApiKeyCheck } from './components/ApiKeyCheck';
import { Footer } from './components/Layout/Footer';
import { AuthGate } from './components/Auth/AuthGate';
import { AdminPanel } from './components/Admin/AdminPanel';
import { LayoutTemplate, Image as ImageIcon, BarChart3, Tag, LogOut, ShieldCheck, Zap, TrendingUp } from 'lucide-react';
import { getUser, removeToken, type AuthUser } from './lib/auth';

type Tab = 'thumbnail' | 'detail' | 'sourcing' | 'analyzer' | 'productname' | 'admin';

const getTabButtonClass = (active: boolean): string => (
  `flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all lg:text-sm ${
    active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
  }`
);

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);
  const [activeTab, setActiveTab] = useState<Tab>('thumbnail');
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null);

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
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex shrink-0 items-center gap-2">
              <div className="w-8 h-8 shrink-0 bg-blue-600 rounded-lg flex items-center justify-center">
                <LayoutTemplate className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight lg:text-xl">쇼크트리 훈프로 AI 자동화 프로그램</h1>
            </div>

            <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center">
              {/* 탭 네비게이션 */}
              <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-3 lg:grid-cols-6 xl:w-auto">
                <button
                  onClick={() => setActiveTab('thumbnail')}
                  className={getTabButtonClass(activeTab === 'thumbnail')}
                >
                  <ImageIcon className="w-4 h-4 shrink-0" />썸네일 제작
                </button>
                <button
                  onClick={() => setActiveTab('detail')}
                  className={getTabButtonClass(activeTab === 'detail')}
                >
                  <LayoutTemplate className="w-4 h-4 shrink-0" />상세페이지 제작
                </button>
                <button
                  onClick={() => setActiveTab('sourcing')}
                  className={getTabButtonClass(activeTab === 'sourcing')}
                >
                  <TrendingUp className="w-4 h-4 shrink-0" />소싱 파인더
                </button>
                <button
                  onClick={() => setActiveTab('analyzer')}
                  className={getTabButtonClass(activeTab === 'analyzer')}
                >
                  <BarChart3 className="w-4 h-4 shrink-0" />광고 성과 분석
                </button>
                <button
                  onClick={() => setActiveTab('productname')}
                  className={getTabButtonClass(activeTab === 'productname')}
                >
                  <Tag className="w-4 h-4 shrink-0" />상품명 제조기
                </button>
                {user.isAdmin && (
                  <button
                    onClick={() => setActiveTab('admin')}
                    className={getTabButtonClass(activeTab === 'admin')}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />관리자
                  </button>
                )}
              </div>

              {/* 사용자 정보 */}
              <div className="flex shrink-0 items-center justify-end gap-3 xl:border-l xl:border-slate-200 xl:pl-3">
                {!user.isAdmin && remainingCalls !== null && (
                  <div className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>오늘 {remainingCalls}회 남음</span>
                  </div>
                )}
                <span className="whitespace-nowrap text-sm text-slate-700 font-medium">{user.name}</span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-400 hover:text-red-500 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />로그아웃
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className={`flex-grow ${activeTab === 'analyzer' || activeTab === 'sourcing' ? '' : 'py-8'}`}>
          {activeTab === 'thumbnail' && <ThumbnailGenerator />}
          {activeTab === 'detail' && <DetailPlanner />}
          {activeTab === 'sourcing' && <SourcingFinder />}
          {activeTab === 'analyzer' && <AdAnalyzer />}
          {activeTab === 'productname' && <ProductNameGenerator />}
          {activeTab === 'admin' && user.isAdmin && <AdminPanel />}
        </main>

        <Footer />
      </div>
    </ApiKeyCheck>
  );
}
