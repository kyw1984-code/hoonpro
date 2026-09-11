/**
 * 목록이 긴 `.in()` 조회를 나눠서 부른다.
 *
 * PostgREST의 `.in()`은 값을 전부 URL 질의 문자열에 이어 붙인다. 키워드가
 * 수백 개가 되면 주소가 게이트웨이 상한을 넘어 요청이 통째로 거부된다.
 *
 * 조용히 실패하는 게 문제다. 부르는 쪽은 대개 결과를 `|| []`로 받아 넘기므로,
 * 거부된 조회는 "결과 없음"과 구분되지 않는다. 소싱 크론이 실제로 그랬다 —
 * 캐시 나이를 못 읽으면 20시간 건너뛰기가 함께 죽어, 스무 분 전에 수집한
 * 키워드를 매번 다시 긁는다. 한 번 긁을 때마다 실제 돈이 나간다.
 *
 * 조각 크기는 값 하나가 100자쯤 되어도 주소가 안전한 선으로 잡았다.
 */
const DEFAULT_CHUNK = 100;

/**
 * @param values `.in()`에 넣을 값들
 * @param run    한 조각을 받아 조회를 수행하는 함수
 * @returns      모든 조각의 결과를 이어 붙인 배열. 한 조각이 실패해도 나머지는 살린다.
 */
export async function selectIn<T>(
  values: readonly string[],
  // PostgREST 빌더는 Promise가 아니라 await하면 결과가 나오는 thenable이라
  // PromiseLike로 받는다. Promise로 좁히면 호출부마다 await로 감싸야 한다.
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error?: unknown } | null>,
  chunkSize = DEFAULT_CHUNK,
): Promise<{ rows: T[]; failedChunks: number }> {
  const unique = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
  if (unique.length === 0) return { rows: [], failedChunks: 0 };

  const out: T[] = [];
  let failedChunks = 0;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const res = await run(chunk);
      if (!res || res.error) { failedChunks++; continue; }
      if (res.data) out.push(...res.data);
    } catch {
      // 한 조각이 실패해도 나머지는 살린다. 전부 버리면 조용한 실패로 돌아간다.
      failedChunks++;
    }
  }
  return { rows: out, failedChunks };
}

/** 조각으로 나눠 순서대로 실행만 한다 (삭제 등 결과가 필요 없는 경우) */
export async function runIn(
  values: readonly string[],
  run: (chunk: string[]) => PromiseLike<unknown>,
  chunkSize = DEFAULT_CHUNK,
): Promise<number> {
  const unique = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
  let failed = 0;
  for (let i = 0; i < unique.length; i += chunkSize) {
    try {
      await run(unique.slice(i, i + chunkSize));
    } catch {
      failed++;
    }
  }
  return failed;
}
