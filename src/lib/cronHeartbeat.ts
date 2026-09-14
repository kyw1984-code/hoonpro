/**
 * 크론 심장박동.
 *
 * 이 서비스의 데이터는 대부분 크론이 채운다 — 매출 동기화, 자동결제, 아침
 * 브리핑, 소싱 재수집. 크론이 멈춰도 화면은 어제 숫자를 그대로 보여 줘서
 * 아무 일도 없어 보인다. 자동결제가 사흘 멈춘 것을 사흘 뒤에 아는 건
 * 너무 늦다.
 *
 * 그래서 실행마다 한 줄을 남기고, 관리자 화면에서 '마지막 실행이 언제였나'를
 * 본다. 성공/실패보다 '돌기는 했나'가 먼저다.
 */

export interface CronJobSpec {
  job: string;
  label: string;
  /** 이 분 수를 넘도록 실행 기록이 없으면 늦은 것이다 */
  staleAfterMin: number;
  /** 멈췄을 때 무엇이 멈추는지 — 화면에서 판단의 근거가 된다 */
  impact: string;
}

/**
 * vercel.json의 crons와 짝이 맞아야 한다. 한쪽만 고치면 화면이 영영
 * '한 번도 안 돌았습니다'로 남거나, 멈춘 크론이 목록에 없어 안 보인다.
 *
 * 여유는 주기의 두 배 남짓으로 둔다. 한 번 거른 것으로 빨간불을 켜면
 * 아무도 화면을 안 보게 된다.
 */
export const CRON_JOBS: CronJobSpec[] = [
  { job: 'coupang-sync',    label: '쿠팡 매출 동기화',  staleAfterMin: 3 * 60,       impact: '매출·수수료·정산예정액이 멈춥니다' },
  { job: 'coupang-daily',   label: '일일 정리',         staleAfterMin: 2 * 24 * 60,  impact: '재고 예측과 순위 기록이 밀립니다' },
  { job: 'coupang-brief',   label: '아침 브리핑 메일',  staleAfterMin: 2 * 24 * 60,  impact: '브리핑 메일이 나가지 않습니다' },
  { job: 'coupang-weekly',  label: '주간 리포트',       staleAfterMin: 9 * 24 * 60,  impact: '주간 리포트가 나가지 않습니다' },
  { job: 'billing-charge',  label: '자동결제',          staleAfterMin: 2 * 24 * 60,  impact: '구독이 갱신되지 않습니다 — 가장 먼저 보셔야 합니다' },
  { job: 'sourcing-cron',   label: '소싱 자동 수집',    staleAfterMin: 2 * 24 * 60,  impact: '관심 키워드의 판매속도가 쌓이지 않습니다' },
];

export type CronStatus = 'ok' | 'late' | 'failing' | 'never';

export interface CronHealth extends CronJobSpec {
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastDetail: string | null;
  /** 마지막 실행 이후 지난 시간(분). 한 번도 안 돌았으면 null */
  minutesAgo: number | null;
  /** 최근 기록에서 실패한 횟수 */
  recentFailures: number;
  status: CronStatus;
}

export interface CronRunRow {
  job: string;
  run_at: string;
  ok: boolean;
  detail?: string | null;
}

/**
 * 최근 실행 기록을 잡별 건강 상태로 접는다.
 *
 * 한 번도 안 돈 것('never')과 늦은 것('late')을 갈라 놓는다. 갓 배포한
 * 크론은 아직 안 돈 게 정상이라, 둘을 같은 빨간불로 묶으면 진짜 멈춤을
 * 못 알아본다.
 */
export function foldCronHealth(rows: CronRunRow[], now = Date.now()): CronHealth[] {
  return CRON_JOBS.map(spec => {
    const mine = rows
      .filter(r => r.job === spec.job)
      .sort((a, b) => b.run_at.localeCompare(a.run_at));
    const last = mine[0] ?? null;
    const minutesAgo = last ? Math.max(0, Math.round((now - Date.parse(last.run_at)) / 60000)) : null;
    const recentFailures = mine.filter(r => !r.ok).length;

    let status: CronStatus;
    if (!last) status = 'never';
    else if (minutesAgo !== null && minutesAgo > spec.staleAfterMin) status = 'late';
    // 마지막이 실패했거나, 최근 기록의 절반 넘게 실패했으면 앓고 있는 것이다.
    // 한 번의 실패로는 빨간불을 켜지 않는다 — 쿠팡 API는 자주 흔들린다.
    else if (!last.ok && recentFailures > 1) status = 'failing';
    else status = 'ok';

    return {
      ...spec,
      lastRunAt: last?.run_at ?? null,
      lastOk: last ? last.ok : null,
      lastDetail: last?.detail ?? null,
      minutesAgo,
      recentFailures,
      status,
    };
  });
}

/** "12분 전" / "3시간 전" / "2일 전" */
export function agoLabel(minutes: number | null): string {
  if (minutes === null) return '기록 없음';
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / (24 * 60))}일 전`;
}

/** 기록은 14일만 둔다. 시간당 한 번 도는 동기화까지 합쳐도 500줄이 안 된다 */
const KEEP_DAYS = 14;

/**
 * 크론 한 번을 감싸 실행 기록을 남긴다.
 *
 * 기록 쓰기를 기다리지 않고 넘어가면 안 된다. 서버리스 함수는 응답을 보낸
 * 뒤 곧바로 얼어붙어서, 기다리지 않은 쓰기는 그냥 사라진다 — 크론은 돌았는데
 * 화면에는 '한 번도 안 돌았습니다'로 남는다.
 *
 * 응답 본문을 훔쳐보는 이유는 '돌았다'만으로는 부족해서다. 몇 명을 처리했고
 * 오류가 몇 건이었는지가 함께 남아야 화면에서 판단이 된다.
 */
export async function runCron<T>(
  supabase: any,
  job: string,
  res: { statusCode?: number; json: (body: any) => any },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let payload: any = null;
  const originalJson = res.json.bind(res);
  res.json = (body: any) => { payload = body; return originalJson(body); };

  let ok = true;
  let detail: string | null = null;
  try {
    const out = await fn();
    ok = (res.statusCode ?? 200) < 400;
    detail = summarize(payload);
    return out;
  } catch (e: any) {
    ok = false;
    detail = String(e?.message ?? e).slice(0, 300);
    throw e;
  } finally {
    try {
      await supabase.from('cron_runs').insert({
        job, ok, duration_ms: Date.now() - startedAt, detail,
        run_at: new Date().toISOString(),
      });
      // 정리는 하루 한 번 도는 잡에서만 한다. 시간당 도는 동기화에서 매번
      // 지우면 쓸데없이 스물네 번을 훑는다.
      if (job === 'coupang-daily') {
        await supabase.from('cron_runs').delete()
          .lt('run_at', new Date(Date.now() - KEEP_DAYS * 86400000).toISOString());
      }
    } catch { /* 기록 실패가 크론을 망치면 안 된다 */ }
  }
}

/** 응답 본문에서 화면에 보여 줄 한 줄을 만든다 */
function summarize(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const parts: string[] = [];
  for (const key of ['users', 'processed', 'charged', 'sent', 'keywords', 'skipped', 'failed', 'errors']) {
    const v = (payload as any)[key];
    if (typeof v === 'number') parts.push(`${key} ${v}`);
    else if (Array.isArray(v) && v.length > 0) parts.push(`${key} ${v.length}`);
  }
  if (payload.reason) parts.push(String(payload.reason));
  if (payload.error) parts.push(String(payload.error));
  return parts.length > 0 ? parts.join(' · ').slice(0, 300) : null;
}
