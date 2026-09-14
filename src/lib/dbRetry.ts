/**
 * 잠깐 실패한 DB 호출을 한 번 다시 본다.
 *
 * 서버리스 함수는 미국(iad1)에서 돌고 Supabase는 서울(ap-northeast-2)에 있다.
 * 한 번 묻고 답을 받는 데 태평양을 왕복하므로, 평소에도 느리고 가끔은 응답이
 * 시간 안에 안 온다. 하루에 몇 번이지만 그 몇 번이 사용자에게는 "가입이 안 된다",
 * "수집이 멈췄다"로 보인다.
 *
 * 근본 해결은 함수를 서울(icn1)로 옮기는 것이고 vercel.json에서 그렇게 했다.
 * 그래도 네트워크는 가끔 흔들리므로, 다시 물어보면 되는 실패는 다시 묻는다.
 */

/** 다시 불러 볼 만한 오류인가. 문법·권한 오류는 몇 번을 불러도 같다 */
export function isTransientDbError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = String(error.message ?? '');
  const code = String(error.code ?? '');
  // 57014 = query_canceled, 08006 = connection_failure, 08003 = connection_does_not_exist
  return /gateway timeout|timeout|timed out|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(msg)
    || code === '57014' || code === '08006' || code === '08003' || code === '504';
}

/**
 * 결과에 error가 담겨 오는 supabase 호출을 한 번만 다시 본다.
 *
 * 호출을 함수로 받는다. 같은 Promise를 다시 await할 수는 없기 때문이다.
 */
export async function retryOnce<T extends { error?: any }>(
  run: () => PromiseLike<T>,
  waitMs = 700,
): Promise<T> {
  const first = await run();
  if (!first?.error || !isTransientDbError(first.error)) return first;
  await new Promise(r => setTimeout(r, waitMs));
  return run();
}
