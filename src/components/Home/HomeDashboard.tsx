/**
 * 홈 대시보드 — 로그인 후 첫 화면.
 * 이미 쌓이는 데이터(순위 추적·관심 키워드 리포트·주간 브리핑)를 한 화면에 모아
 * "매일 열어볼 이유"를 만든다. 데이터가 없으면 각 기능으로 안내한다.
 */
import { useEffect, useState } from 'react';
import {
  TrendingUp, ListOrdered, Zap, ChevronRight, Image as ImageIcon,
  LayoutTemplate, BarChart3, MessageSquareText, Loader2,
} from 'lucide-react';
import { getToken, getUser } from '../../lib/auth';

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const BADGE = 'inline-flex items-center rounded-control border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums';

interface Props {
  onNavigate: (tab: string) => void;
}

export function HomeDashboard({ onNavigate }: Props) {
  const [watches, setWatches] = useState<any[] | null>(null);
  const [report, setReport] = useState<any[] | null>(null);
  const [briefing, setBriefing] = useState<any | null>(null);
  const userName = getUser()?.name || '';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sourcing?type=rankwatch&action=list', { headers: authHeaders() });
        const data = await res.json();
        setWatches(res.ok && Array.isArray(data.watches) ? data.watches : []);
      } catch { setWatches([]); }
    })();
    (async () => {
      try {
        const res = await fetch('/api/sourcing?type=favorites&action=report', { headers: authHeaders() });
        const data = await res.json();
        setReport(res.ok && Array.isArray(data.report) ? data.report : []);
      } catch { setReport([]); }
    })();
    (async () => {
      try {
        const res = await fetch('/api/sourcing?type=briefing', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok && !data.error) setBriefing(data);
      } catch { /* 무시 */ }
    })();
  }, []);

  const today = new Date();
  const dateLabel = `${today.getMonth() + 1}월 ${today.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][today.getDay()]}요일`;

  // 리뷰 급증 상품: 리포트의 movers를 펼쳐 상위 4개
  const movers = (report || [])
    .flatMap((r: any) => (r.movers || []).map((m: any) => ({ ...m, keyword: r.keyword })))
    .sort((a: any, b: any) => (b.growthPerDay || 0) - (a.growthPerDay || 0))
    .slice(0, 4);

  const quickLinks = [
    { tab: 'sourcing', label: '훈프로 소싱AI', desc: '오늘 팔릴 상품 찾기', icon: TrendingUp },
    { tab: 'thumbnail', label: '썸네일 제작', desc: 'AI 썸네일 만들기', icon: ImageIcon },
    { tab: 'detail', label: '상세페이지 제작', desc: '기획안부터 이미지까지', icon: LayoutTemplate },
    { tab: 'analyzer', label: '광고 성과 분석', desc: '보고서 올리고 코칭 받기', icon: BarChart3 },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[12px] font-semibold text-ink-3">{dateLabel}</p>
          <h2 className="mt-0.5 text-[22px] font-semibold tracking-tight text-ink">
            {userName ? `${userName}님, ` : ''}오늘의 훈프로
          </h2>
        </div>
      </div>

      {/* 빠른 시작 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {quickLinks.map(({ tab, label, desc, icon: Icon }) => (
          <button key={tab} onClick={() => onNavigate(tab)}
            className="group flex items-center gap-3 rounded-card border border-line bg-paper p-4 text-left transition-colors hover:border-line-strong">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-ink text-paper">
              <Icon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink group-hover:text-accent">{label}</p>
              <p className="truncate text-[11px] text-ink-3">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 내 상품 순위 */}
        <div className="rounded-panel border border-line bg-paper p-5">
          <div className="mb-3 flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">내 상품 순위</h3>
            <button onClick={() => onNavigate('ranktracker')} className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-ink-2 hover:text-accent">
              전체 보기 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {watches === null ? (
            <div className="flex items-center gap-2 py-6 text-ink-3"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-[12px]">불러오는 중...</span></div>
          ) : watches.length === 0 ? (
            <p className="py-4 text-[13px] text-ink-3">
              추적 중인 상품이 없습니다. <button onClick={() => onNavigate('ranktracker')} className="font-semibold text-accent hover:underline">순위 추적</button>에 내 상품을 등록하면 매일 순위 변화가 여기 표시됩니다.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {watches.slice(0, 4).map((w: any) => (
                <div key={`${w.keyword}:${w.product_id}`} className="flex items-center gap-2.5 rounded-card border border-line bg-paper-2 px-3 py-2.5">
                  <span className="shrink-0 text-[12px] font-semibold text-ink">"{w.keyword}"</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{w.product_name || `상품 ${w.product_id}`}</span>
                  {w.latestRank !== undefined && w.latestRank !== null ? (
                    <span className="text-[14px] font-semibold tabular-nums text-ink">{w.latestRank}위</span>
                  ) : w.latestAt ? (
                    <span className="text-[11px] font-semibold text-ink-3">60위 밖</span>
                  ) : (
                    <span className="text-[11px] text-ink-3">기록 대기</span>
                  )}
                  {typeof w.delta === 'number' && w.delta !== 0 && (
                    <span className={`${BADGE} ${w.delta > 0 ? 'border-positive/35 bg-positive-soft text-positive' : 'border-critical/35 bg-critical-soft text-critical'}`}>
                      {w.delta > 0 ? `▲${w.delta}` : `▼${Math.abs(w.delta)}`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 리뷰 급증 상품 */}
        <div className="rounded-panel border border-line bg-paper p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-ink">관심 키워드 — 리뷰가 빠르게 느는 상품</h3>
            <button onClick={() => onNavigate('sourcing')} className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-ink-2 hover:text-accent">
              소싱AI <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {report === null ? (
            <div className="flex items-center gap-2 py-6 text-ink-3"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-[12px]">불러오는 중...</span></div>
          ) : movers.length === 0 ? (
            <p className="py-4 text-[13px] text-ink-3">
              아직 감지된 상품이 없습니다. 소싱AI에서 ★로 키워드를 저장하면 매일 자동 수집되고, 리뷰가 빠르게 느는(≒잘 팔리는) 상품이 여기 표시됩니다.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {movers.map((m: any) => (
                <a key={`${m.keyword}:${m.productId}`} href={m.productUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-card border border-line bg-paper-2 px-3 py-2 hover:border-line-strong">
                  {m.productImage && <img src={m.productImage} alt="" className="h-8 w-8 shrink-0 rounded-control object-cover" />}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{m.productName}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">"{m.keyword}"</span>
                  <span className={`${BADGE} shrink-0 border-positive/35 bg-positive-soft text-positive`}>+{m.growthPerDay}/일</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 이번 주 추천 소싱 키워드 */}
      <div className="rounded-panel border border-accent-line bg-accent-soft p-5">
        <div className="mb-1 flex items-center gap-2">
          <Zap className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-ink">
            이번 주 추천 소싱 키워드{briefing?.month ? ` — ${briefing.month}월 판매 준비` : ''}
          </h3>
        </div>
        <p className="mb-3 text-[12px] text-ink-2">검색량·경쟁·계절성 기준 상위 키워드입니다. 누르면 소싱AI에서 이어집니다.</p>
        {!briefing ? (
          <div className="flex items-center gap-2 py-2 text-ink-3"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-[12px]">불러오는 중...</span></div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {(briefing.items || []).slice(0, 8).map((it: any) => (
              <button key={it.keyword} onClick={() => onNavigate('sourcing')}
                className="group flex items-center gap-2 rounded-control border border-line bg-paper px-3 py-1.5 transition-colors hover:border-accent">
                <span className="text-[13px] font-semibold text-ink group-hover:text-accent">{it.keyword}</span>
                <span className="text-[11px] tabular-nums text-ink-3">{Number(it.monthlyVolume).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-card border border-line bg-paper px-4 py-3 text-[12px] text-ink-3">
        <MessageSquareText className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
        소싱→입고→판매까지 1~2개월 — 항상 다음 달 팔릴 상품을 준비하세요. 궁금한 건 [훈프로에게 질문]에서 물어볼 수 있습니다.
      </div>
    </div>
  );
}
