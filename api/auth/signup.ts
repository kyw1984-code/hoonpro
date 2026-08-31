import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// 가입 API — 포트원(PASS) 본인인증 기반 1인 1계정
//   PORTONE_API_KEY/SECRET가 설정되면: imp_uid를 서버에서 재조회해 CI 추출,
//   중복 CI 차단 + 만 14세 미만 차단 + 인증 통과 시 자동 승인
//   미설정(개발/전환 전): 기존 수동 승인 플로우 그대로 동작

const PORTONE_API = 'https://api.iamport.kr';

function portoneEnabled(): boolean {
  return Boolean(process.env.PORTONE_API_KEY && process.env.PORTONE_API_SECRET);
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

  // 프론트가 본인인증 필요 여부를 알 수 있게 설정 조회 제공
  if (req.query.action === 'config') {
    return res.status(200).json({ verificationRequired: portoneEnabled() });
  }

  const { name, phone, email, impUid } = req.body ?? {};
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
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
    });

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
      }
      return res.status(500).json({ error: `서버 오류: ${error.message} (code: ${error.code})` });
    }
    return res.status(201).json({ message: '가입이 완료됐습니다. 바로 로그인해주세요.', verified: true });
  }

  // ── 기존 플로우 (본인인증 미설정 — 관리자 수동 승인) ──
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
