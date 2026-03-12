/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { DetailPlanner } from './components/Detail/DetailPlanner';
import { ThumbnailGenerator } from './components/Thumbnail/ThumbnailGenerator';
import { AdAnalyzer } from './components/Analyzer/AdAnalyzer';
import { ApiKeyCheck } from './components/ApiKeyCheck';
import { Footer } from './components/Layout/Footer';
import { LayoutTemplate, Image as ImageIcon, BarChart3 } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'detail' | 'thumbnail' | 'analyzer'>('detail');

  return (
    <ApiKeyCheck>
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {/* Header */}
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
                onClick={() => setActiveTab('detail')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'detail' 
                    ? 'bg-white text-blue-700 shadow-sm' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutTemplate className="w-4 h-4 mr-2" />
                상세페이지 제작
              </button>
              <button
                onClick={() => setActiveTab('thumbnail')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'thumbnail' 
                    ? 'bg-white text-blue-700 shadow-sm' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ImageIcon className="w-4 h-4 mr-2" />
                썸네일 제작
              </button>
              <button
                onClick={() => setActiveTab('analyzer')}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'analyzer' 
                    ? 'bg-white text-blue-700 shadow-sm' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                광고 성과 분석
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className={`flex-grow ${activeTab === 'analyzer' ? '' : 'py-8'}`}>
          {activeTab === 'detail' && <DetailPlanner />}
          {activeTab === 'thumbnail' && <ThumbnailGenerator />}
          {activeTab === 'analyzer' && <AdAnalyzer />}
        </main>

        <Footer />
      </div>
    </ApiKeyCheck>
  );
}
