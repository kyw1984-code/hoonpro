/**
 * 메일 본문 틀.
 *
 * api/ 안에 같은 함수가 네 벌 있고 이미 셋으로 갈라졌다. 새로 메일을 보내는
 * 곳이 생길 때마다 복사하면 브랜드가 조금씩 어긋난다. 여기부터 한 곳에 둔다.
 *
 * (기존 네 곳은 지금 돌아가고 있어 건드리지 않았다. 옮길 때는 한 번에
 *  옮기고 실제 발송을 눈으로 확인해야 한다 — 결제 고지가 걸려 있다.)
 */

const SITE = 'https://hoonproai.com';

/** HTML에 그대로 넣기 전에 막는다. 질문 본문에 <b>가 들어오면 틀이 깨진다 */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 줄바꿈을 살려서 HTML로. 사람이 쓴 답변은 줄바꿈이 곧 문단이다 */
export function toHtmlParagraphs(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function wrapEmail(heading: string, bodyHtml: string, footerNote?: string): string {
  const note = footerNote ?? '본 메일은 발신 전용입니다. 문의는 서비스 내 [건의·문의]에 남겨주세요.';
  return `<div style="margin:0;padding:24px 12px;background:#0b1020;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#141b31;border:1px solid #1c2542;border-radius:18px;overflow:hidden;">
    <div style="padding:22px 28px 0;">
      <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:9px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0b1020;font-weight:800;font-size:14px;">훈</span>
      <span style="margin-left:9px;font-size:14px;font-weight:600;color:#e8ecf5;vertical-align:middle;">쇼크트리 훈프로 <span style="color:#5a627a;font-weight:500;">AI 자동화</span></span>
    </div>
    <div style="padding:18px 28px 26px;">
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.4;color:#ffffff;font-weight:700;">${escapeHtml(heading)}</h1>
      <div style="font-size:14px;line-height:1.75;color:#b9c0d0;">${bodyHtml}</div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #1c2542;font-size:11.5px;line-height:1.7;color:#5a627a;">
      ${escapeHtml(note)}<br>
      <a href="${SITE}" style="color:#7cf5ff;text-decoration:none;">hoonproai.com</a>
    </div>
  </div>
</div>`;
}

export function emailButton(label: string, href = SITE): string {
  return `<div style="margin:20px 0 4px;"><a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0a0f1f;font-weight:700;font-size:13.5px;text-decoration:none;">${escapeHtml(label)}</a></div>`;
}

/** 인용 블록 — 원래 질문을 되짚어 보여줄 때 */
export function emailQuote(text: string): string {
  return `<div style="margin:14px 0;padding:12px 14px;border-left:3px solid #2a3355;background:#0f1528;border-radius:0 8px 8px 0;font-size:13px;color:#8a92a6;">${toHtmlParagraphs(text)}</div>`;
}
