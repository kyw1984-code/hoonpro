/**
 * 쇼크트리AI(크롬 확장 프로그램)와 이야기하는 쪽.
 *
 * 확장 프로그램의 content script가 이 페이지에 들어와 있으면 html에
 * data-hoonpro-ext 속성을 달고 "hoonproExtReady"를 보낸다. 요청은 postMessage로
 * 보내고, 진행 상황·결과도 postMessage로 받는다. 확장이 없으면 즐겨찾기 방식을 쓴다.
 */
import type { WingStatRow, WingWanted } from './wingStats';

export function extensionVersion(): string | null {
  return document.documentElement.getAttribute('data-hoonpro-ext');
}

/** 확장이 늦게 붙는 경우를 위해 잠깐 기다려 본다 */
export function waitForExtension(ms = 1500): Promise<string | null> {
  const now = extensionVersion();
  if (now) return Promise.resolve(now);
  return new Promise(resolve => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.source === window && ev.data?.hoonproExtReady) { cleanup(); resolve(String(ev.data.version || '1')); }
    };
    const cleanup = () => { window.removeEventListener('message', onMsg); clearTimeout(t); };
    const t = setTimeout(() => { cleanup(); resolve(extensionVersion()); }, ms);
    window.addEventListener('message', onMsg);
    window.postMessage({ hoonproExt: true, type: 'ping' }, window.location.origin);
  });
}

export interface ExtProgress { done: number; total: number; found: number; mode?: 'direct' | 'tab' }

/** 확장에게 윙 판매 데이터를 받아 오게 한다 */
export function runWingStatsViaExtension(items: WingWanted[], onProgress: (p: ExtProgress) => void): Promise<{ rows: WingStatRow[]; missed: number; partial: boolean }> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (ev.source !== window || !d?.hoonproExtReply || d.requestId !== requestId) return;
      if (d.kind === 'progress') onProgress({ done: d.done, total: d.total, found: d.found, mode: d.mode });
      else if (d.kind === 'done') { cleanup(); resolve({ rows: d.rows || [], missed: d.missed || 0, partial: Boolean(d.partial) }); }
      else if (d.kind === 'error') { cleanup(); reject(new Error(d.message || '확장 프로그램 오류')); }
    };
    // 40개 × 최대 2초 + 여유. 그 안에 끝나지 않으면 포기한다
    const timer = setTimeout(() => { cleanup(); reject(new Error('확장 프로그램이 응답하지 않습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.')); }, 180_000);
    const cleanup = () => { window.removeEventListener('message', onMsg); clearTimeout(timer); };
    window.addEventListener('message', onMsg);
    window.postMessage({ hoonproExt: true, type: 'wing-stats', requestId, items }, window.location.origin);
  });
}

export interface AdReportPayload { base64?: string; url?: string; from: number; to: number; contentType?: string; dateGroup?: string }

/** 확장에게 광고센터 광고 보고서를 받아 오게 한다 (광고센터 탭 안에서 보고서를 만든다) */
export function runAdReportViaExtension(days: number, onProgress: (step: string) => void): Promise<AdReportPayload> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (ev.source !== window || !d?.hoonproExtReply || d.requestId !== requestId) return;
      if (d.kind === 'progress') onProgress(String(d.step || ''));
      else if (d.kind === 'done') { cleanup(); resolve(d as AdReportPayload); }
      else if (d.kind === 'error') { cleanup(); reject(new Error(d.message || '확장 프로그램 오류')); }
    };
    // 보고서 생성은 최대 3분 + 탭 열기·파일 받기
    const timer = setTimeout(() => { cleanup(); reject(new Error('광고센터가 4분 안에 응답하지 않았습니다. 잠시 뒤 다시 시도해 주세요.')); }, 240_000);
    const cleanup = () => { window.removeEventListener('message', onMsg); clearTimeout(timer); };
    window.addEventListener('message', onMsg);
    window.postMessage({ hoonproExt: true, type: 'ad-report', requestId, days }, window.location.origin);
  });
}

/** base64 → ArrayBuffer */
export function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
