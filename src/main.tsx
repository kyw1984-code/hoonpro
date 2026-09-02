import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';

// 에러 모니터링 (Sentry) — VITE_SENTRY_DSN이 없으면 아무것도 하지 않는다.
// 수강생 화면에서 터지는 에러를 신고 전에 먼저 파악하기 위한 장치.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // 에러 수집만 사용 (퍼포먼스 트레이싱은 무료 쿼터 절약을 위해 끔)
    tracesSampleRate: 0,
    // 민감정보 최소화: 요청 본문·쿠키는 보내지 않음 (기본값 유지)
    beforeSend(event) {
      // JWT가 들어있을 수 있는 헤더 제거
      if (event.request?.headers) delete (event.request.headers as any).Authorization;
      return event;
    },
  });
}

const fallback = (
  <div style={{ padding: '48px 24px', textAlign: 'center', fontFamily: 'Pretendard, sans-serif' }}>
    <h2 style={{ fontSize: 18, fontWeight: 700 }}>화면을 표시하는 중 문제가 발생했습니다</h2>
    <p style={{ marginTop: 8, color: '#666', fontSize: 14 }}>
      새로고침하면 대부분 해결됩니다. 문제가 계속되면 관리자에게 알려주세요 — 오류는 자동으로 접수됐습니다.
    </p>
    <button onClick={() => window.location.reload()}
      style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, border: 'none', background: '#14161a', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
      새로고침
    </button>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={fallback}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
