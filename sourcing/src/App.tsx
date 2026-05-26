import React, { useState } from 'react';
import { BarChart3, LogOut, Clock } from 'lucide-react';
import { AnalyzerDashboard } from './components/Analyzer/AnalyzerDashboard';
import { Footer } from './components/Layout/Footer';
import { AuthGate } from './components/Auth/AuthGate';
import { getUser, removeToken, getRemainingDays, type AuthUser } from './lib/auth';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getUser);

  const handleLogout = () => {
    removeToken();
    setUser(null);
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
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              쿠팡 광고 성과 분석기
            </h1>
          </div>

          <div className="flex items-center gap-3">
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
      </header>

      <main className="flex-grow">
        <AnalyzerDashboard />
      </main>

      <Footer />
    </div>
  );
}
