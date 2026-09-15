/**
 * 메일 발신 주소 — 한 곳에서만 정한다.
 *
 * 발신 도메인은 Resend에 등록하고 DNS로 소유를 증명한 것만 쓸 수 있다.
 * 등록되지 않은 도메인으로 보내면 Resend가 거절하고, 우리 코드는 그 실패를
 * 대부분 조용히 넘긴다 — 메일이 안 갔는데 화면에는 아무 일도 없다.
 *
 * 그런데 폴백 주소가 파일마다 달랐다. 인증코드는 hoonproai.com(등록됨),
 * 결제 고지·브리핑·소싱 알림은 hoonpro.app(등록된 적 없음)이었다. 지금은
 * EMAIL_FROM이 설정돼 있어 드러나지 않지만, 환경변수가 하나 빠지거나 새
 * 환경을 만드는 순간 결제 7일 전 고지가 통째로 사라진다. 약관에 적어 둔
 * 고지라 더 위험하다.
 *
 * 그래서 폴백을 검증된 도메인 하나로 못박는다. 바꿀 일이 생기면 Resend에
 * 그 도메인을 먼저 등록하고 여기 한 줄을 고치면 된다.
 */

/** Resend에 verified로 등록된 도메인 */
export const VERIFIED_SENDER_DOMAIN = 'hoonproai.com';

/** 환경변수가 없을 때 쓸 주소 */
export const DEFAULT_SENDER = `no-reply@${VERIFIED_SENDER_DOMAIN}`;

/**
 * 실제로 From 헤더에 넣을 값.
 *
 * EMAIL_FROM은 "훈프로 <no-reply@hoonproai.com>" 같은 표시이름 형태도 되므로
 * 그대로 통과시킨다. 비어 있거나 공백뿐이면 기본값으로 돌아간다.
 */
export function emailFrom(envValue: string | undefined = process.env.EMAIL_FROM): string {
  const v = (envValue ?? '').trim();
  return v.length > 0 ? v : DEFAULT_SENDER;
}

/**
 * From 값에서 메일 주소만 뽑는다. 표시이름이 붙어 있어도 도메인을 볼 수 있게.
 * 주소 꼴이 아니면 null — 없는 값을 지어내지 않는다.
 */
export function senderAddress(from: string): string | null {
  const angled = from.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : from).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/**
 * 이 주소가 우리가 증명한 도메인에서 나가는가.
 *
 * 설정을 막지는 않는다 — 나중에 도메인을 하나 더 등록할 수 있고, 여기서
 * 막으면 그때 코드를 고쳐야 발송이 된다. 대신 관리자 화면과 로그가
 * "등록 안 된 도메인으로 보내고 있다"고 말할 수 있게 판정만 내준다.
 */
export function isVerifiedSender(from: string): boolean {
  const addr = senderAddress(from);
  if (!addr) return false;
  return addr.toLowerCase().endsWith(`@${VERIFIED_SENDER_DOMAIN}`);
}
