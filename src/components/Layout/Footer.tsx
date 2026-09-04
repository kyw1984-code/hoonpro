import React, { useEffect, useState } from 'react';
import { Youtube, ExternalLink } from 'lucide-react';
import { loadCachedCompany, fetchCompanyInfo, type CompanyInfo } from '../../lib/company';

/**
 * 다크 테크 톤 푸터.
 * 관리자가 입력한 사업자 정보를 표시 (로컬 캐시로 먼저 그리고, 서버 값으로 갱신).
 * AuthGate 내부 푸터와 시각 언어를 통일.
 */
export const Footer: React.FC = () => {
  const [company, setCompany] = useState<CompanyInfo>(loadCachedCompany);

  useEffect(() => {
    fetchCompanyInfo().then(setCompany).catch(() => { /* 기본값 유지 */ });
  }, []);

  return (
    <footer
      className="relative mt-auto border-t border-line"
      style={{ background: 'rgba(16,26,46,.72)', backdropFilter: 'blur(10px)' }}
    >
      <div className="mx-auto max-w-[1240px] px-4 py-9 sm:px-6 md:py-10">
        {/* 상단 — 유튜브 / 홈페이지 링크 */}
        <div className="text-center">
          <p className="text-[13px] text-ink-2">
            이 앱은 <b className="font-semibold text-ink">쇼크트리 훈프로</b>에 의해 만들어졌습니다.
            <span className="ml-1">유튜브 구독 및 훈프로 홈페이지 가입 부탁드려요!</span>
          </p>
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
            <a
              href="https://www.youtube.com/@saupsin89"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-4 text-[12.5px] font-medium text-ink transition-all hover:border-accent/40 hover:bg-accent/5 hover:-translate-y-0.5"
            >
              <Youtube className="h-3.5 w-3.5" style={{ color: '#ff5b5b' }} />
              유튜브
            </a>
            <a
              href="https://hoonpro.liveklass.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-4 text-[12.5px] font-medium text-ink transition-all hover:border-accent/40 hover:bg-accent/5 hover:-translate-y-0.5"
            >
              <ExternalLink className="h-3.5 w-3.5 text-accent" />
              훈프로 홈페이지
            </a>
          </div>
        </div>

        {/* 약관·정책 */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 text-[13px]">
          <a href="/terms.html" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center px-1.5 text-ink-2 transition-colors hover:text-ink hover:underline">이용약관</a>
          <span className="text-ink-3">|</span>
          <a href="/privacy.html" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center px-1.5 font-semibold text-ink transition-colors hover:underline">개인정보처리방침</a>
          <span className="text-ink-3">|</span>
          <a href="/terms.html#refund" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center px-1.5 text-ink-2 transition-colors hover:text-ink hover:underline">환불 정책</a>
        </div>

        {/* 사업자 정보 (전자상거래법 제10조) */}
        <div className="mt-4 space-y-1 break-keep text-center text-[11.5px] leading-relaxed text-ink-3 sm:text-[12px]">
          <p>
            상호: <span className="text-ink-2">{company.name}</span>
            <span className="mx-2">·</span>
            대표: <span className="text-ink-2">{company.ceo}</span>
            <span className="mx-2">·</span>
            사업자등록번호: <span className="text-ink-2 tabular">{company.bizNumber}</span>
            <span className="mx-2">·</span>
            통신판매업신고: <span className="text-ink-2">{company.mailOrderNumber}</span>
          </p>
          <p>
            주소: <span className="text-ink-2">{company.address}</span>
            <span className="mx-2">·</span>
            이메일: <span className="text-ink-2">{company.email}</span>
            <span className="mx-2">·</span>
            전화: <span className="text-ink-2 tabular">{company.phone}</span>
          </p>
          <p className="pt-1">© {new Date().getFullYear()} {company.name}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};
