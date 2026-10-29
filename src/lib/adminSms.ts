/**
 * 운영자 결제 알림 문자 (Solapi / CoolSMS).
 *
 * 유료 결제가 성공했을 때만 운영자 번호로 짧은 문자를 보낸다. 메일은 묻히고
 * 결제는 바로 알아야 하는 일이라 문자다. 무료(0원)·실패·환불은 보내지 않는다.
 *
 * 환경변수
 *   SOLAPI_API_KEY / SOLAPI_API_SECRET  solapi.com 콘솔에서 발급
 *   SMS_FROM        Solapi에 등록·인증한 발신번호 (숫자만)
 *   ADMIN_SMS_TO    수신번호, 쉼표 구분 (없으면 아래 기본값)
 *
 * 키가 없으면 조용히 건너뛴다 — 결제 흐름을 문자 때문에 막지 않는다.
 */
import crypto from 'node:crypto';

const DEFAULT_TO = ['01066893805', '01077779676'];

const digits = (s: string) => s.replace(/\D/g, '');

export function adminSmsRecipients(): string[] {
  const env = (process.env.ADMIN_SMS_TO || '').split(',').map(digits).filter(Boolean);
  return env.length ? env : DEFAULT_TO;
}

export async function sendAdminSms(text: string): Promise<{ sent: number; skipped?: string }> {
  const key = process.env.SOLAPI_API_KEY;
  const secret = process.env.SOLAPI_API_SECRET;
  const from = digits(process.env.SMS_FROM || '');
  if (!key || !secret || !from) return { sent: 0, skipped: 'SOLAPI_API_KEY / SOLAPI_API_SECRET / SMS_FROM 미설정' };

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(date + salt).digest('hex');
  const body = {
    messages: adminSmsRecipients().map(to => ({ to, from, text: text.slice(0, 90) })),
  };
  try {
    const r = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'POST',
      headers: {
        Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[문자] 발송 실패', { status: r.status });
      return { sent: 0, skipped: `HTTP ${r.status}` };
    }
    return { sent: body.messages.length };
  } catch (e: any) {
    console.error('[문자] 발송 예외', { detail: e?.message });
    return { sent: 0, skipped: e?.message };
  }
}

/** 결제 문자 본문 — 90바이트 SMS 안에 들어가게 짧게 */
export function paymentSmsText(kind: '신규' | '정기', name: string, amount: number, plan: string): string {
  const who = (name || '').slice(0, 8);
  return `[훈프로] ${kind}결제 ${amount.toLocaleString('ko-KR')}원 ${who} ${plan}`.slice(0, 90);
}
