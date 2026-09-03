import React, { useEffect, useState } from 'react';
import { loadCachedCompany, fetchCompanyInfo, type CompanyInfo } from '../../lib/company';

export const Footer: React.FC = () => {
    // 관리자가 입력한 사업자 정보를 표시 (로컬 캐시로 먼저 그리고, 서버 값으로 갱신)
    const [company, setCompany] = useState<CompanyInfo>(loadCachedCompany);

    useEffect(() => {
        fetchCompanyInfo().then(setCompany).catch(() => { /* 기본값 유지 */ });
    }, []);

    return (
        <footer className="bg-paper border-t border-line py-8 mt-auto">
            <div className="max-w-7xl mx-auto px-6 text-center">
                <p className="text-sm font-medium text-ink mb-2">
                    이 앱은 쇼크트리 훈프로에 의해 만들어졌습니다. 유튜브 구독 및 훈프로 홈페이지 가입 부탁드려요!
                </p>
                <div className="flex justify-center gap-4 text-sm">
                    <a
                        href="https://www.youtube.com/@saupsin89"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:text-accent-hover hover:underline"
                    >
                        유튜브
                    </a>
                    <span className="text-ink-3">|</span>
                    <a
                        href="https://hoonpro.liveklass.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:text-accent-hover hover:underline"
                    >
                        훈프로 홈페이지
                    </a>
                </div>

                {/* 약관·정책 (전자상거래법·PG 심사 요건: 로그인 없이 접근 가능한 정적 페이지) */}
                <div className="mt-5 flex justify-center gap-4 text-[13px]">
                    <a href="/terms.html" target="_blank" rel="noreferrer" className="text-ink-2 hover:text-ink hover:underline">이용약관</a>
                    <span className="text-ink-3">|</span>
                    <a href="/privacy.html" target="_blank" rel="noreferrer" className="font-semibold text-ink-2 hover:text-ink hover:underline">개인정보처리방침</a>
                    <span className="text-ink-3">|</span>
                    <a href="/terms.html#refund" target="_blank" rel="noreferrer" className="text-ink-2 hover:text-ink hover:underline">환불 정책</a>
                </div>

                {/* 사업자 정보 표기 (전자상거래법 제10조) — 관리자 패널 [사업자 정보]에서 수정 */}
                <div className="mt-4 space-y-0.5 text-[12px] leading-relaxed text-ink-3">
                    <p>
                        상호: {company.name} · 대표: {company.ceo} · 사업자등록번호: {company.bizNumber} · 통신판매업신고: {company.mailOrderNumber}
                    </p>
                    <p>
                        주소: {company.address} · 이메일: {company.email} · 전화: {company.phone}
                    </p>
                    <p>© {new Date().getFullYear()} {company.name}. All rights reserved.</p>
                </div>
            </div>
        </footer>
    );
};
