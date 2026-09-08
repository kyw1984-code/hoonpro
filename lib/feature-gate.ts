/**
 * 기능(탭) 표시 여부 게이트.
 *
 * 관리자가 [탭 표시·순서]에서 끈 기능은 화면에서 사라진다. 그런데 화면에서만
 * 감추면 통제가 아니다 — 켜져 있던 브라우저 탭, 북마크, 새로고침하지 않은
 * 세션은 그대로 API를 부른다. 이미지 생성처럼 호출당 돈이 나가는 기능은
 * 껐다고 믿는 동안에도 비용이 계속 나간다. 그래서 서버에서도 막는다.
 *
 * 관리자는 막지 않는다. 수강생에게 열기 전에 직접 써 보고 판단해야 한다.
 *
 * 목록은 app_config.hidden_tabs에 "숨긴 것"으로 저장한다. "보일 것"으로
 * 저장하면 새 기능을 배포할 때마다 관리자가 켜 주기 전까지 아무에게도
 * 안 보이는데, 그건 배포 사고처럼 보인다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** App.tsx의 TABS, api/admin.ts의 TAB_IDS와 같은 목록이어야 한다 */
export type FeatureTab =
  | 'home' | 'thumbnail' | 'detail' | 'sourcing' | 'ranktracker'
  | 'review' | 'analyzer' | 'coupang' | 'qa' | 'works';

const TAB_LABEL: Record<FeatureTab, string> = {
  home: '홈',
  thumbnail: '썸네일 제작',
  detail: '상세페이지 제작',
  sourcing: '훈프로 소싱AI',
  ranktracker: '순위 추적',
  review: '리뷰 분석',
  analyzer: '광고 성과 분석',
  coupang: '쿠팡 매출·정산',
  qa: '훈프로 코칭AI',
  works: '내 작업',
};

// 요청마다 조회하면 기능 하나 쓸 때마다 DB를 한 번 더 친다. 서버리스 인스턴스는
// 재사용되므로 짧게 캐시한다. 관리자가 토글한 뒤 최대 이만큼 늦게 반영된다.
const TTL_MS = 60_000;
let cache: { at: number; hidden: Set<string> } | null = null;

/** 테스트와 즉시 반영용 — 설정을 저장한 직후 호출하면 다음 요청부터 새 값을 읽는다 */
export function clearFeatureGateCache(): void {
  cache = null;
}

async function loadHidden(supabase: SupabaseClient): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.hidden;
  try {
    const { data } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'hidden_tabs')
      .maybeSingle();
    const parsed = JSON.parse(data?.value || '[]');
    const hidden = new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
    cache = { at: Date.now(), hidden };
    return hidden;
  } catch {
    // 설정을 못 읽었다고 기능을 막으면 안 된다. DB가 잠깐 흔들릴 때
    // 멀쩡한 기능이 통째로 죽는 쪽이 훨씬 나쁘다.
    return new Set();
  }
}

/**
 * 꺼진 기능이면 사용자에게 보여줄 문구를, 쓸 수 있으면 null을 돌려준다.
 * 호출부는 문구가 있으면 403으로 돌려보내면 된다.
 */
export async function tabDisabledMessage(
  supabase: SupabaseClient | null,
  tab: FeatureTab,
  isAdmin: boolean,
): Promise<string | null> {
  if (isAdmin || !supabase) return null;
  const hidden = await loadHidden(supabase);
  if (!hidden.has(tab)) return null;
  return `[${TAB_LABEL[tab]}] 기능은 현재 사용할 수 없습니다. 화면을 새로고침해주세요.`;
}
