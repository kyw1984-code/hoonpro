import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// 가입 API — 이메일 인증코드 + 관리자 승인 (기본 운영 방식)
//   RESEND_API_KEY가 설정되면: 6자리 인증코드로 메일함 소유 확인 + 만 14세 확인
//   → 가입 신청(pending) → 관리자 승인 후 이용. 어뷰징 차단은 승인 단계가 담당.
//   PORTONE_API_KEY/SECRET가 설정되면(선택): PASS 본인인증으로 CI 기반 1인 1계정 + 자동 승인
//   둘 다 미설정(개발): 기존 수동 승인 플로우 그대로 동작

const PORTONE_API = 'https://api.iamport.kr';
const CODE_TTL_MS = 10 * 60 * 1000;   // 인증코드 유효 10분
const RESEND_COOLDOWN_MS = 60 * 1000; // 재발송 최소 간격 60초
const MAX_ATTEMPTS = 5;

function portoneEnabled(): boolean {
  return Boolean(process.env.PORTONE_API_KEY && process.env.PORTONE_API_SECRET);
}

function emailCodeEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY) && !portoneEnabled();
}

// ── 비밀번호 해시 (scrypt) ──
// api/auth/login.ts에도 동일 구현이 있다. 서버리스 함수마다 번들이 분리되어
// 공유 모듈을 두면 라우팅에 영향을 줄 수 있어 의도적으로 중복해 둔다.
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// 비밀번호 규칙 — 통과 시 null, 실패 시 사용자에게 보여줄 사유
function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (pw.length > 72) return '비밀번호가 너무 깁니다. (72자 이하)';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
  return null;
}

// 브랜드 템플릿 (api/auth/login.ts · api/billing.ts와 동일 디자인)
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

function hashCode(email: string, code: string): string {
  return crypto.createHash('sha256').update(`${email}:${code}:${process.env.JWT_SECRET}`).digest('hex');
}

async function sendCodeEmail(to: string, code: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'no-reply@hoonpro.app',
        to: [to],
        subject: `[훈프로] 가입 인증코드: ${code}`,
        html: wrapEmail('가입 인증코드',
          `<p>아래 코드를 입력하면 가입이 완료됩니다.</p>
           <div style="margin:18px 0;padding:16px;text-align:center;background:#0b1020;border:1px solid #1c2542;border-radius:12px;">
             <span style="font-size:30px;font-weight:700;letter-spacing:9px;color:#7cf5ff;">${code}</span>
           </div>
           <p>코드는 <b style="color:#e8ecf5;">10분</b> 동안 유효합니다.</p>
           <p style="color:#8a92a6;">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>`),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface Certification {
  ci: string;
  name: string;
  phone: string;
  birthday: string | null; // YYYY-MM-DD
}

// imp_uid로 포트원에 인증 결과를 재조회 — 클라이언트가 보낸 값은 믿지 않는다
async function fetchCertification(impUid: string): Promise<Certification> {
  const tokenRes = await fetch(`${PORTONE_API}/users/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imp_key: process.env.PORTONE_API_KEY,
      imp_secret: process.env.PORTONE_API_SECRET,
    }),
  });
  const tokenData: any = await tokenRes.json();
  const accessToken = tokenData?.response?.access_token;
  if (!accessToken) throw new Error('본인인증 서버 연결에 실패했습니다.');

  const certRes = await fetch(`${PORTONE_API}/certifications/${encodeURIComponent(impUid)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const certData: any = await certRes.json();
  const cert = certData?.response;
  if (!certRes.ok || !cert?.certified || !cert?.unique_key) {
    throw new Error('본인인증 결과를 확인할 수 없습니다. 다시 시도해주세요.');
  }
  return {
    ci: cert.unique_key,
    name: cert.name ?? '',
    phone: cert.phone ?? '',
    birthday: cert.birthday ?? null,
  };
}

function ageFrom(birthday: string): number {
  const birth = new Date(birthday);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: `환경변수 누락: URL=${supabaseUrl ? 'OK' : '없음'}, KEY=${supabaseKey ? 'OK' : '없음'}` });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 프론트가 가입 방식(PASS/이메일 코드/기본)을 알 수 있게 설정 조회 제공
  if (req.query.action === 'config') {
    return res.status(200).json({
      verificationRequired: portoneEnabled(),
      emailCodeRequired: emailCodeEnabled(),
    });
  }

  const { name, phone, email, impUid, code, ageConfirmed, password } = req.body ?? {};
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  // ── 인증코드 발송 ──
  if (req.query.action === 'send-code') {
    if (!emailCodeEnabled()) return res.status(400).json({ error: '이메일 인증이 비활성화되어 있습니다.' });

    const { data: existingUser } = await supabase.from('users').select('id').eq('email', normalizedEmail).maybeSingle();
    if (existingUser) return res.status(409).json({ error: '이미 등록된 이메일입니다. 로그인해주세요.' });

    const { data: prev } = await supabase.from('email_verifications').select('created_at').eq('email', normalizedEmail).maybeSingle();
    if (prev && Date.now() - new Date(prev.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: '잠시 후 다시 요청해주세요. (재발송은 1분 간격)' });
    }

    const newCode = String(crypto.randomInt(100000, 1000000));
    const { error: upsertError } = await supabase.from('email_verifications').upsert({
      email: normalizedEmail,
      code_hash: hashCode(normalizedEmail, newCode),
      attempts: 0,
      purpose: 'signup',
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      created_at: new Date().toISOString(),
    });
    if (upsertError) return res.status(500).json({ error: '인증코드 저장에 실패했습니다. (DB 마이그레이션 확인)' });

    const sent = await sendCodeEmail(normalizedEmail, newCode);
    if (!sent) return res.status(502).json({ error: '인증코드 메일 발송에 실패했습니다. 이메일 주소를 확인해주세요.' });
    return res.status(200).json({ message: '인증코드를 보냈습니다. 메일함(스팸함 포함)을 확인해주세요.' });
  }

  // ── 본인인증 모드 ──
  if (portoneEnabled()) {
    if (!impUid) return res.status(400).json({ error: '휴대폰 본인인증을 완료해주세요.' });

    let cert: Certification;
    try {
      cert = await fetchCertification(String(impUid));
    } catch (e: any) {
      return res.status(400).json({ error: e?.message ?? '본인인증에 실패했습니다.' });
    }

    const certPwProblem = passwordProblem(password);
    if (certPwProblem) return res.status(400).json({ error: certPwProblem });

    if (cert.birthday && ageFrom(cert.birthday) < 14) {
      return res.status(403).json({ error: '만 14세 미만은 가입할 수 없습니다.' });
    }

    // CI 기준 1인 1계정 — 무료 쿠폰 재가입 어뷰징 원천 차단
    const { data: dup } = await supabase.from('users').select('email').eq('ci', cert.ci).maybeSingle();
    if (dup) {
      const masked = String(dup.email).replace(/^(..).*(@.*)$/, '$1***$2');
      return res.status(409).json({ error: `이미 가입된 계정이 있습니다. (${masked}) 기존 계정으로 로그인해주세요.` });
    }

    const { error } = await supabase.from('users').insert({
      name: cert.name || name || '',
      phone: cert.phone || phone || '',
      email: String(email).trim().toLowerCase(),
      ci: cert.ci,
      phone_verified_at: new Date().toISOString(),
      birth_date: cert.birthday,
      status: 'approved', // 본인인증 통과 → 자동 승인 (이용 게이트는 구독 상태가 담당)
      password_hash: hashPassword(String(password)),
    });

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
      }
      return res.status(500).json({ error: `서버 오류: ${error.message} (code: ${error.code})` });
    }
    return res.status(201).json({ message: '가입이 완료됐습니다. 바로 로그인해주세요.', verified: true });
  }

  // ── 이메일 인증코드 모드 (기본 운영) — 코드 확인 후 가입 신청, 관리자 승인은 그대로 유지 ──
  if (emailCodeEnabled()) {
    if (!name || !phone) {
      return res.status(400).json({ error: '이름, 연락처, 이메일을 모두 입력해주세요.' });
    }
    if (ageConfirmed !== true) {
      return res.status(400).json({ error: '만 14세 이상 확인에 동의해주세요.' });
    }
    if (!code || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ error: '이메일로 받은 6자리 인증코드를 입력해주세요.' });
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });

    const { data: v } = await supabase.from('email_verifications').select('*').eq('email', normalizedEmail).maybeSingle();
    if (!v || (v.purpose && v.purpose !== 'signup')) return res.status(400).json({ error: '인증코드를 먼저 요청해주세요.' });
    if (new Date(v.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: '인증코드가 만료됐습니다. 다시 요청해주세요.' });
    }
    if (v.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: '시도 횟수를 초과했습니다. 인증코드를 다시 요청해주세요.' });
    }
    if (v.code_hash !== hashCode(normalizedEmail, String(code))) {
      await supabase.from('email_verifications').update({ attempts: v.attempts + 1 }).eq('email', normalizedEmail);
      return res.status(400).json({ error: '인증코드가 일치하지 않습니다.' });
    }

    // 이메일 인증 통과 → 자동 승인. 이용 게이트는 구독이, 무료쿠폰 통제는
    // 관리자가 발급한 쿠폰 코드 자체가 담당한다 (관리자 차단 기능은 유지)
    const { error } = await supabase.from('users').insert({
      name, phone, email: normalizedEmail, status: 'approved',
      password_hash: hashPassword(String(password)),
    });
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
      return res.status(500).json({ error: `서버 오류: ${error.message} (code: ${error.code})` });
    }
    await supabase.from('email_verifications').delete().eq('email', normalizedEmail);
    return res.status(201).json({ message: '가입이 완료됐습니다. 바로 로그인해주세요.' });
  }

  // ── 기존 플로우 (인증 미설정 — 관리자 수동 승인) ──
  if (!name || !phone) {
    return res.status(400).json({ error: '이름, 연락처, 이메일을 모두 입력해주세요.' });
  }

  const { error } = await supabase.from('users').insert({ name, phone, email });

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
    }
    return res.status(500).json({ error: `서버 오류: ${error.message} (code: ${error.code})` });
  }

  return res.status(201).json({ message: '가입 신청이 완료됐습니다. 관리자 승인 후 이용 가능합니다.' });
}
