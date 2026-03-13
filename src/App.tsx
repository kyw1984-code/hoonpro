/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { DetailPlanner } from './components/Detail/DetailPlanner';
import { ThumbnailGenerator } from './components/Thumbnail/ThumbnailGenerator';
import { AdAnalyzer } from './components/Analyzer/AdAnalyzer';
import { ProductNameGenerator } from './components/ProductName/ProductNameGenerator';
import CoupangResearch from './components/CoupangReserch';
import { ApiKeyCheck } from './components/ApiKeyCheck';
import { Footer } from './components/Layout/Footer';
import { LayoutTemplate, Image as ImageIcon, BarChart3, Tag, Lock, Search } from 'lucide-react';

const PASSWORD = '202603';

function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = () => {
    if (input === PASSWORD) {
      sessionStorage.setItem('auth', 'true');
      onSuccess();
    } else {
      setError(true);
      setInput('');
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-10 w-full max-w-sm flex flex-col items-center">
        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
          <Lock className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">쇼크트리 훈프로</h1>
        <p className="text-sm text-slate-500 mb-8">접속하려면 비밀번호를 입력하세요.</p>
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="비밀번호 입력"
          className={`w-full p-3 border rounded-xl text-center text-lg tracking-widest outline-none focus:ring-2 transition-all ${
            error ? 'border-red-400 ring-2 ring-red-200 bg-red-50' : 'border-slate-300 focus:ring-blue-500'
          }`}
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mt-2">비밀번호가 틀렸습니다.</p>}
        <button
          onClick={handleSubmit}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors"
        >
          입장하기
        </button>
      </div>
    </div>
  );
}

type Tab = 'thumbnail' | 'detail' | 'analyzer' | 'productname' | 'coupang';

export default function App() {
  const [authed, setAuthed] = useState(sessionStorage.getItem('auth') === 'true');
  const [activeTab, setActiveTab] = useState<Tab>('thumbnail');

  if (!authed) return <PasswordGate onSuccess={() => setAuthed(true)} />;

  return (
    <ApiKeyCheck>
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <LayoutTemplate className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">쇼크트리 훈프로 AI 자동화 프로그램</h1>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('thumbnail')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'thumbnail' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ImageIcon className="w-4 h-4 mr-2" />
                썸네일 제작
              </button>
              <button
                onClick={() => setActiveTab('detail')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'detail' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutTemplate className="w-4 h-4 mr-2" />
                상세페이지 제작
              </button>
              <button
                onClick={() => setActiveTab('analyzer')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'analyzer' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                광고 성과 분석
              </button>
              <button
                onClick={() => setActiveTab('productname')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'productname' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Tag className="w-4 h-4 mr-2" />
                상품명 제조기
              </button>
              <button
                onClick={() => setActiveTab('coupang')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'coupang' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Search className="w-4 h-4 mr-2" />
                시장 분석기
              </button>
            </div>
          </div>
        </header>

        <main className={`flex-grow ${activeTab === 'analyzer' ? '' : 'py-8'}`}>
          {activeTab === 'thumbnail' && <ThumbnailGenerator />}
          {activeTab === 'detail' && <DetailPlanner />}
          {activeTab === 'analyzer' && <AdAnalyzer />}
          {activeTab === 'productname' && <ProductNameGenerator />}
          {activeTab === 'coupang' && <CoupangResearch />}
        </main>

        <Footer />
      </div>
    </ApiKeyCheck>
  );
}
