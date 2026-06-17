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
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex shrink-0 items-center gap-2">
              <div className="w-8 h-8 shrink-0 bg-blue-600 rounded-lg flex items-center justify-center">
                <LayoutTemplate className="w-5 h-5 text-white" />
              </div>
              <h1 className="whitespace-nowrap text-xl font-bold text-slate-900 tracking-tight">쇼크트리 훈프로 AI 자동화 프로그램</h1>
            </div>

            <div className="flex min-w-0 items-center gap-4">
              {/* 탭 네비게이션 */}
              <div className="flex max-w-full overflow-x-auto bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setActiveTab('thumbnail')}
                  className={`flex shrink-0 items-center whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'thumbnail' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <ImageIcon className="w-4 h-4 mr-2 shrink-0" />썸네일 제작
                </button>
                <button
                  onClick={() => setActiveTab('detail')}
                  className={`flex shrink-0 items-center whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'detail' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <LayoutTemplate className="w-4 h-4 mr-2 shrink-0" />상세페이지 제작
                </button>
                <button
                  onClick={() => setActiveTab('sourcing')}
                  className={`flex shrink-0 items-center whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'sourcing' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <TrendingUp className="w-4 h-4 mr-2 shrink-0" />소싱 파인더
                </button>
                <button
                  onClick={() => setActiveTab('analyzer')}
                  className={`flex shrink-0 items-center whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'analyzer' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <BarChart3 className="w-4 h-4 mr-2 shrink-0" />광고 성과 분석
                </button>
                <button
                  onClick={() => setActiveTab('productname')}
                  className={`flex shrink-0 items-center whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'productname' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <Tag className="w-4 h-4 mr-2 shrink-0" />상품명 제조기
                </button>
                {user.isAdmin && (
                  <button
                    onClick={() => setActiveTab('admin')}
                    className={`flex shrink-0 items-center whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'admin' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <ShieldCheck className="w-4 h-4 mr-2 shrink-0" />관리자
                  </button>
                )}
              </div>

              {/* 사용자 정보 */}
              <div className="flex shrink-0 items-center gap-3 pl-3 border-l border-slate-200">
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
