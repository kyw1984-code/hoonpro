// 포트원(구 아임포트) PASS 휴대폰 본인인증 — 성공 시 imp_uid 반환
// 서버(/api/auth/signup)가 imp_uid로 인증 결과를 재조회해 CI를 검증·저장한다.

declare global {
  interface Window {
    IMP?: {
      init: (code: string) => void;
      certification: (params: Record<string, unknown>, cb: (rsp: CertResponse) => void) => void;
    };
  }
}

interface CertResponse {
  success: boolean;
  imp_uid?: string;
  error_msg?: string;
}

const SDK_URL = 'https://cdn.iamport.kr/v1/iamport.js';

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.IMP) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.onload = () => resolve();
      script.onerror = () => { sdkPromise = null; reject(new Error('본인인증 모듈을 불러오지 못했습니다.')); };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export function certificationAvailable(): boolean {
  return Boolean(import.meta.env.VITE_PORTONE_IMP_CODE);
}

export async function requestCertification(): Promise<string> {
  const impCode = import.meta.env.VITE_PORTONE_IMP_CODE;
  if (!impCode) throw new Error('본인인증 설정이 완료되지 않았습니다.');

  await loadSdk();
  const IMP = window.IMP!;
  IMP.init(impCode);

  return new Promise<string>((resolve, reject) => {
    IMP.certification({ popup: false }, (rsp: CertResponse) => {
      if (rsp.success && rsp.imp_uid) resolve(rsp.imp_uid);
      else reject(new Error(rsp.error_msg || '본인인증이 취소됐습니다.'));
    });
  });
}
