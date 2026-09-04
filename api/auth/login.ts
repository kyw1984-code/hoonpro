import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// 인증 통합 엔드포인트 (Vercel 함수 개수 제한 대응 — action으로 분기)
//   (기본)                 이메일 + 비밀번호 로그인
//   action=find-id         아이디(이메일) 찾기 — 이름 + 연락처로 조회해 마스킹 반환
//   action=reset-request   비밀번호 재설정 코드 발송
//   action=reset-confirm   코드 확인 + 새 비밀번호 저장
//   action=change-password 로그인 상태에서 비밀번호 변경
//   action=withdraw        회원 탈퇴 (개인정보 익명화, 결제 기록은 법정 보존)

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

// ── 비밀번호 해시 (scrypt) ──
// api/auth/signup.ts에도 동일 구현이 있다. 서버리스 함수마다 번들이 분리되어
// 공유 모듈을 두면 라우팅에 영향을 줄 수 있어 의도적으로 중복해 둔다.
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// 비밀번호 규칙 — 통과 시 null, 실패 시 사용자에게 보여줄 사유
function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (pw.length > 72) return '비밀번호가 너무 깁니다. (72자 이하)';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
  return null;
}

function hashCode(email: string, code: string): string {
  return crypto.createHash('sha256').update(`${email}:${code}:${process.env.JWT_SECRET}`).digest('hex');
}

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '');
}

// hong@gmail.com → ho***@gmail.com
function maskEmail(email: string): string {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

function verifyAuth(req: VercelRequest): { userId: string; email: string; name: string; isAdmin: boolean } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
  } catch {
    return null;
  }
}

function issueToken(user: any): string {
  const isAdmin = user.email === process.env.ADMIN_EMAIL;
  return jwt.sign(
    { userId: user.id, email: user.email, name: user.name, isAdmin },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );
}

// ── 이메일 ──
function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// 브랜드 템플릿 (api/auth/signup.ts · api/billing.ts와 동일 디자인)
function wrapEmail(heading: string, bodyHtml: string): string {
  return `<div style="margin:0;padding:24px 12px;background:#0b1020;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#141b31;border:1px solid #1c2542;border-radius:18px;overflow:hidden;">
    <div style="padding:22px 28px 0;">
      <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:9px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0b1020;font-weight:800;font-size:14px;">훈</span>
      <span style="margin-left:9px;font-size:14px;font-weight:600;color:#e8ecf5;vertical-align:middle;">쇼크트리 훈프로 <span style="color:#5a627a;font-weight:500;">AI 자동화</span></span>
    </div>
    <div style="padding:18px 28px 26px;">
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.4;color:#ffffff;font-weight:700;">${heading}</h1>
      <div style="font-size:14px;line-height:1.75;color:#b9c0d0;">${bodyHtml}</div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #1c2542;font-size:11.5px;line-height:1.7;color:#5a627a;">
      본 메일은 발신 전용입니다. 문의는 서비스 내 [훈프로에게 질문]을 이용해주세요.<br>
      <a href="https://hoonproai.com" style="color:#7cf5ff;text-decoration:none;">hoonproai.com</a>
    </div>
  </div>
</div>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:18px 0;padding:16px;text-align:center;background:#0b1020;border:1px solid #1c2542;border-radius:12px;">
    <span style="font-size:30px;font-weight:700;letter-spacing:9px;color:#7cf5ff;">${code}</span>
  </div>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailEnabled() || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'no-reply@hoonproai.com',
        to: [to],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── 핸들러 ────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = String(req.query.action || '');

  try {
    if (action === 'find-id') return await findId(req, res);
    if (action === 'reset-request') return await resetRequest(req, res);
    if (action === 'reset-confirm') return await resetConfirm(req, res);
    if (action === 'change-password') return await changePassword(req, res);
    if (action === 'withdraw') return await withdraw(req, res);
    return await login(req, res);
  } catch (e) {
    console.error('[auth]', action, e);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

// ── 로그인 ──
async function login(req: VercelRequest, res: VercelResponse) {
  const { email, password } = req.body ?? {};
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', String(email).trim().toLowerCase())
    .maybeSingle();

  if (error || !user) {
    return res.status(404).json({ error: '등록되지 않은 이메일입니다.' });
  }
  if (user.withdrawn_at) {
    return res.status(403).json({ error: '탈퇴 처리된 계정입니다. 새로 가입해주세요.' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: '승인 대기 중입니다. 관리자 승인 후 이용 가능합니다.' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: '접근이 거부됐습니다. 관리자에게 문의하세요.' });
  }

  // 비밀번호가 없는 계정(비밀번호 도입 이전 가입 / PASS 가입)은 재설정으로 먼저 설정해야 한다.
  // 이메일 발송 수단이 없더라도 이메일만으로는 절대 로그인시키지 않는다.
  if (!user.password_hash) {
    return res.status(409).json({
      error: emailEnabled()
        ? '비밀번호 설정이 필요합니다. [비밀번호 찾기]로 비밀번호를 설정해주세요.'
        : '비밀번호가 설정되지 않은 계정입니다. 관리자에게 문의해주세요.',
      passwordSetupRequired: emailEnabled(),
    });
  }

  if (!password) return res.status(400).json({ error: '비밀번호를 입력해주세요.' });
  if (!verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }

  return res.status(200).json({
    token: issueToken(user),
    user: { id: user.id, name: user.name, email: user.email, isAdmin: user.email === process.env.ADMIN_EMAIL },
  });
}

// ── 아이디(이메일) 찾기 ──
async function findId(req: VercelRequest, res: VercelResponse) {
  const { name, phone } = req.body ?? {};
  if (!name || !phone) return res.status(400).json({ error: '이름과 연락처를 모두 입력해주세요.' });

  const digits = normalizePhone(phone);
  if (digits.length < 9) return res.status(400).json({ error: '연락처를 정확히 입력해주세요.' });

  const { data } = await supabase
    .from('users')
    .select('email, phone, created_at')
    .eq('name', String(name).trim())
    .is('withdrawn_at', null);

  // 연락처는 저장 형식(하이픈 유무)이 제각각이라 숫자만 비교한다
  const matched = (data ?? []).filter(u => normalizePhone(u.phone || '') === digits);
  if (matched.length === 0) {
    return res.status(404).json({ error: '일치하는 계정을 찾을 수 없습니다. 이름과 연락처를 확인해주세요.' });
  }

  return res.status(200).json({
    emails: matched.map(u => ({
      masked: maskEmail(u.email),
      joinedAt: u.created_at ? String(u.created_at).slice(0, 10) : null,
    })),
  });
}

// ── 비밀번호 재설정: 코드 발송 ──
async function resetRequest(req: VercelRequest, res: VercelResponse) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });
  if (!emailEnabled()) return res.status(400).json({ error: '이메일 발송이 설정되지 않았습니다. 관리자에게 문의하세요.' });

  const { data: user } = await supabase
    .from('users').select('id, name, withdrawn_at').eq('email', email).maybeSingle();
  if (!user || user.withdrawn_at) {
    return res.status(404).json({ error: '등록되지 않은 이메일입니다.' });
  }

  const { data: prev } = await supabase
    .from('email_verifications').select('created_at').eq('email', email).maybeSingle();
  if (prev && Date.now() - new Date(prev.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: '잠시 후 다시 요청해주세요. (재발송은 1분 간격)' });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const { error: upsertError } = await supabase.from('email_verifications').upsert({
    email,
    code_hash: hashCode(email, code),
    attempts: 0,
    purpose: 'reset',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
  });
  if (upsertError) return res.status(500).json({ error: '인증코드 저장에 실패했습니다. (DB 마이그레이션 확인)' });

  const sent = await sendEmail(email, `[훈프로] 비밀번호 재설정 코드: ${code}`, wrapEmail(
    '비밀번호 재설정 코드',
    `<p>${user.name || ''}님, 아래 코드를 입력하면 새 비밀번호를 설정할 수 있습니다.</p>
     ${codeBlock(code)}
     <p>코드는 <b style="color:#e8ecf5;">10분</b> 동안 유효합니다.</p>
     <p style="color:#8a92a6;">본인이 요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 변경되지 않습니다.</p>`
  ));
  if (!sent) return res.status(502).json({ error: '메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' });

  return res.status(200).json({ message: '인증코드를 보냈습니다. 메일함(스팸함 포함)을 확인해주세요.' });
}

// ── 비밀번호 재설정: 코드 확인 + 저장 ──
async function resetConfirm(req: VercelRequest, res: VercelResponse) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { code, password } = req.body ?? {};
  if (!email || !code) return res.status(400).json({ error: '이메일과 인증코드를 입력해주세요.' });
  if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: '인증코드 6자리를 입력해주세요.' });

  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const { data: v } = await supabase.from('email_verifications').select('*').eq('email', email).maybeSingle();
  if (!v || v.purpose !== 'reset') return res.status(400).json({ error: '인증코드를 먼저 요청해주세요.' });
  if (new Date(v.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: '인증코드가 만료됐습니다. 다시 요청해주세요.' });
  }
  if (v.attempts >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: '시도 횟수를 초과했습니다. 인증코드를 다시 요청해주세요.' });
  }
  if (v.code_hash !== hashCode(email, String(code))) {
    await supabase.from('email_verifications').update({ attempts: v.attempts + 1 }).eq('email', email);
    return res.status(400).json({ error: '인증코드가 일치하지 않습니다.' });
  }

  const { data: user } = await supabase
    .from('users').select('id, name, withdrawn_at').eq('email', email).maybeSingle();
  if (!user || user.withdrawn_at) return res.status(404).json({ error: '등록되지 않은 이메일입니다.' });

  const { error } = await supabase
    .from('users').update({ password_hash: hashPassword(String(password)) }).eq('id', user.id);
  if (error) return res.status(500).json({ error: '비밀번호 저장에 실패했습니다.' });

  await supabase.from('email_verifications').delete().eq('email', email);
  await sendEmail(email, '[훈프로] 비밀번호가 변경됐습니다', wrapEmail(
    '비밀번호가 변경됐습니다',
    `<p>${user.name || ''}님의 계정 비밀번호가 방금 변경됐습니다.</p>
     <p style="color:#8a92a6;">본인이 변경하지 않았다면 즉시 비밀번호를 다시 재설정해주세요.</p>`
  ));

  return res.status(200).json({ message: '비밀번호가 설정됐습니다. 새 비밀번호로 로그인해주세요.' });
}

// ── 로그인 상태에서 비밀번호 변경 ──
async function changePassword(req: VercelRequest, res: VercelResponse) {
  const auth = verifyAuth(req);
  if (!auth) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const { currentPassword, password } = req.body ?? {};
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const { data: user } = await supabase
    .from('users').select('id, password_hash').eq('id', auth.userId).maybeSingle();
  if (!user) return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });

  // 비밀번호가 이미 있으면 현재 비밀번호 확인 필수
  if (user.password_hash && !verifyPassword(String(currentPassword || ''), user.password_hash)) {
    return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  }

  const { error } = await supabase
    .from('users').update({ password_hash: hashPassword(String(password)) }).eq('id', user.id);
  if (error) return res.status(500).json({ error: '비밀번호 변경에 실패했습니다.' });

  return res.status(200).json({ message: '비밀번호가 변경됐습니다.' });
}

// ── 회원 탈퇴 ──
async function withdraw(req: VercelRequest, res: VercelResponse) {
  const auth = verifyAuth(req);
  if (!auth) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const { data: user } = await supabase
    .from('users').select('id, email, name, password_hash, withdrawn_at').eq('id', auth.userId).maybeSingle();
  if (!user || user.withdrawn_at) return res.status(404).json({ error: '이미 탈퇴한 계정입니다.' });

  // 비밀번호가 설정된 계정은 본인 확인
  if (user.password_hash && !verifyPassword(String(req.body?.password || ''), user.password_hash)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }

  // 유효한 구독이 남아 있으면 먼저 해지·환불하도록 안내 (자동결제 방지)
  const { data: sub } = await supabase
    .from('subscriptions').select('status').eq('user_id', user.id).maybeSingle();
  if (sub && ['trial', 'active', 'past_due'].includes(sub.status)) {
    return res.status(409).json({
      error: '이용 중인 구독이 있습니다. [구독 관리]에서 해지 또는 환불을 먼저 진행해주세요.',
      subscriptionActive: true,
    });
  }

  // 개인 데이터 삭제 (결제 기록·사용량 집계는 법정 보존을 위해 남긴다)
  for (const table of ['sourcing_favorites', 'sourcing_rank_watch', 'saved_works', 'ad_reports', 'qa_logs']) {
    await supabase.from(table).delete().eq('user_id', user.id);
  }

  // 친구 추천 코드는 더 이상 쓰이지 않도록 중지 (이미 사용한 기록은 통계를 위해 유지)
  await supabase.from('coupons').update({ active: false }).eq('note', `referral:${user.id}`);

  // 계정 익명화 — 이메일은 유니크 제약이 있어 탈퇴 식별자로 치환
  const { error } = await supabase.from('users').update({
    name: '탈퇴한 회원',
    phone: '',
    email: `withdrawn+${user.id}@deleted.local`,
    password_hash: null,
    // ci는 유지한다 — 지우면 같은 사람이 무제한 재가입해 무료 쿠폰을 반복 사용할 수 있다.
    // (이름·연락처·이메일이 지워져 그 자체로는 개인을 식별하지 못하는 값)
    status: 'rejected',
    withdrawn_at: new Date().toISOString(),
  }).eq('id', user.id);
  if (error) return res.status(500).json({ error: '탈퇴 처리에 실패했습니다. 관리자에게 문의해주세요.' });

  await sendEmail(user.email, '[훈프로] 회원 탈퇴가 완료됐습니다', wrapEmail(
    '회원 탈퇴가 완료됐습니다',
    `<p>${user.name}님, 그동안 훈프로를 이용해주셔서 감사합니다.</p>
     <p>계정과 개인정보는 삭제됐으며, 결제 기록은 전자상거래법에 따라 5년간 보존된 뒤 파기됩니다.</p>
     <p style="color:#8a92a6;">언제든 다시 가입하실 수 있습니다.</p>`
  ));

  return res.status(200).json({ message: '탈퇴가 완료됐습니다. 이용해주셔서 감사합니다.' });
}
