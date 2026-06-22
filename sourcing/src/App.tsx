import React, { useState } from 'react';
import { BarChart3, LogOut, Clock, ShieldCheck, TrendingUp, LayoutTemplate, Sparkles } from 'lucide-react';
import { AnalyzerDashboard } from './components/Analyzer/AnalyzerDashboard';
import { SourcingFinder } from './components/Sourcing/SourcingFinder';
import { DetailPromptViewer } from './components/DetailPrompt/DetailPromptViewer';
import { AdminPanel } from './components/Admin/AdminPanel';
import { Footer } from './components/Layout/Footer';
import { AuthGate } from './components/Auth/AuthGate';
import { getUser, removeToken, getRemainingDays, type AuthUser } from './lib/auth';

type Tab = 'sourcing' | 'analyzer' | 'detail' | 'admin';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);
  const [activeTab, setActiveTab] = useState<Tab>('sourcing');

  const handleLogout = () => {
    removeToken();
    setUser(null);
    setActiveTab('sourcing');
  };

  if (!user) {
    return <AuthGate onSuccess={() => setUser(getUser())} />;
  }

  const remainingDays = getRemainingDays(user);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <LayoutTemplate className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              훈프로 소싱·광고 분석 체험판
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('sourcing')}
                className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'sourcing' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TrendingUp className="w-4 h-4 mr-1.5" /> 소싱 파인더
              </button>
              <button
                onClick={() => setActiveTab('analyzer')}
                className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'analyzer' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-4 h-4 mr-1.5" /> 광고 분석기
              </button>
              <button
                onClick={() => setActiveTab('detail')}
                className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'detail'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-4 h-4 mr-1.5" /> 상세페이지 프롬프트
                <span className="ml-1.5 text-[10px] font-bold bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full">FREE</span>
              </button>
              {user.isAdmin && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'admin' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 mr-1.5" /> 관리자
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
              {!user.isAdmin && (
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                    remainingDays <= 1
                      ? 'bg-red-50 text-red-600'
                      : remainingDays <= 3
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  체험 {remainingDays}일 남음
                </div>
              )}
              <span className="text-sm text-slate-700 font-medium">{user.name}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {activeTab === 'sourcing' && <SourcingFinder />}
        {activeTab === 'analyzer' && <AnalyzerDashboard />}
        {activeTab === 'detail' && <DetailPromptViewer />}
        {activeTab === 'admin' && user.isAdmin && <AdminPanel />}
      </main>

      <Footer />
    </div>
  );
}
