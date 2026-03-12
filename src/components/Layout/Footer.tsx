import React from 'react';

export const Footer: React.FC = () => {
    return (
        <footer className="bg-white border-t border-slate-200 py-6 mt-auto">
            <div className="max-w-7xl mx-auto px-6 text-center text-sm text-slate-500">
                <p className="font-medium text-slate-700 mb-2">
                    이 앱은 쇼크트리 훈프로에 의해 만들어졌습니다. 유튜브 구독 및 훈프로 홈페이지 가입 부탁드려요!
                </p>
                <div className="flex justify-center gap-4 mt-3">
                    <a 
                        href="https://www.youtube.com/@saupsin89" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                        유튜브
                    </a>
                    <span className="text-slate-300">|</span>
                    <a 
                        href="https://hoonpro.liveklass.com/" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                        훈프로 홈페이지
                    </a>
                </div>
                <p className="mt-4 text-xs text-slate-400">Powered by Google Gemini API & remove.bg</p>
            </div>
        </footer>
    );
};
