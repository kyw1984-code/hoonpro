// 사업자 정보 — 푸터·이용약관·개인정보처리방침의 법적 표기에 사용
// 관리자 패널 [사업자 정보] 탭에서 입력하면 app_config(company_info)에 저장되고,
// 아래 기본값은 아직 입력되지 않은 항목의 자리표시자로만 쓰인다.

export interface CompanyInfo {
  name: string;            // 상호
  ceo: string;             // 대표자명
  bizNumber: string;       // 사업자등록번호
  mailOrderNumber: string; // 통신판매업 신고번호
  address: string;         // 사업장 주소
  email: string;           // 고객 문의 이메일
  phone: string;           // 고객센터 전화
  effectiveDate: string;   // 약관·개인정보처리방침 시행일
  dbRegion: string;        // 개인정보처리방침의 DB 리전 표기
}

export const COMPANY_DEFAULTS: CompanyInfo = {
  name: '주식회사 오브원',
  ceo: '김영욱',
  bizNumber: '560-87-02398',
  mailOrderNumber: '[제0000-서울강남-00000호]',
  address: '경기도 부천시 원미구 조마루로385번길 122, 제비151호(춘의동, 삼보테크노타워)',
  email: '[contact@example.com]',
  phone: '[00-0000-0000]',
  effectiveDate: '[2026년 00월 00일]',
  dbRegion: '[싱가포르 등 실제 리전 기재]',
};

// 관리자 입력 폼에서 쓰는 항목 정의 (순서대로 표시)
export const COMPANY_FIELDS: { key: keyof CompanyInfo; label: string; placeholder: string; hint?: string }[] = [
  { key: 'name', label: '상호(법인명)', placeholder: '주식회사 오브원' },
  { key: 'ceo', label: '대표자명', placeholder: '홍길동' },
  { key: 'bizNumber', label: '사업자등록번호', placeholder: '123-45-67890' },
  { key: 'mailOrderNumber', label: '통신판매업 신고번호', placeholder: '제2026-서울강남-01234호', hint: '정부24 신고증에 적힌 번호 그대로' },
  { key: 'address', label: '사업장 주소', placeholder: '서울특별시 강남구 테헤란로 123, 4층' },
  { key: 'email', label: '고객 문의 이메일', placeholder: 'contact@hoonproai.com' },
  { key: 'phone', label: '고객센터 전화번호', placeholder: '02-1234-5678' },
  { key: 'effectiveDate', label: '약관 시행일', placeholder: '2026년 9월 1일', hint: '이용약관·개인정보처리방침 상단에 표시' },
  { key: 'dbRegion', label: 'DB 리전 (개인정보처리방침용)', placeholder: '싱가포르 (ap-southeast-1)', hint: 'Supabase 프로젝트 설정 → General에서 확인' },
];

const CACHE_KEY = 'hoonpro_company_info';

// 저장된 값 + 기본값 병합 (비어 있는 항목은 자리표시자 유지)
export function mergeCompany(saved: Partial<CompanyInfo> | null | undefined): CompanyInfo {
  const out = { ...COMPANY_DEFAULTS };
  if (saved) {
    for (const k of Object.keys(COMPANY_DEFAULTS) as (keyof CompanyInfo)[]) {
      const v = saved[k];
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
  }
  return out;
}

export function loadCachedCompany(): CompanyInfo {
  try {
    return mergeCompany(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
  } catch {
    return COMPANY_DEFAULTS;
  }
}

// 공개 조회 — 로그인 없이도 푸터에 표기해야 하므로 인증 헤더 없이 호출
export async function fetchCompanyInfo(): Promise<CompanyInfo> {
  const res = await fetch('/api/admin?action=config');
  const data = await res.json();
  const merged = mergeCompany(data?.company);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data?.company ?? {})); } catch { /* 캐시 실패 무시 */ }
  return merged;
}
