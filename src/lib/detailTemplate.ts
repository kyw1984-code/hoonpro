/**
 * 상세페이지 자동 제작 — 의류 템플릿 (브라우저 캔버스).
 *
 * 재료는 판매자가 올린 사진 + 생성한 모델컷 4장(src/lib/detailShots.ts)이고,
 * AI는 문안만 짠다(lib/ai/detail-plan.ts). 생성 컷이 없으면 올린 사진만으로 그린다. 좋은 상세페이지는 매번 새 레이아웃이 아니라
 * 정돈된 템플릿에 사진과 문안을 끼운 것이다 — 그래서 구간 순서와 여백, 서체
 * 크기를 여기서 고정한다. 흰 배경, 860px 폭, 구간마다 PNG 한 장.
 *
 *  1 인트로      대표 사진 + 헤드라인
 *  2 포인트 3    사진 조각 + 제목·설명 ×3
 *  3 디테일 컷   사진 2~4장 + 캡션
 *  4 핏          뒷면/측면 생성 컷 전면 + 핏 문구 (생성 컷이 있을 때)
 *     컬러 옵션은 사이즈표 하단에 텍스트로 표기 (사진-색상 매칭을 추측하지 않음)
 *  5 사이즈표    표 + 측정 안내
 *  6 소재·세탁   소재 / 세탁·취급 / 핏
 *  7 안내        배송·교환/반품·A/S
 */
import type { DetailPlanLite } from './coupang';

export const W = 860;
const FONT = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
const INK = '#17191f';
const INK2 = '#5b6170';
const INK3 = '#9aa0ae';
const LINE = '#e6e8ee';
const PAPER2 = '#f5f6f8';

export interface TemplateInput {
  plan: DetailPlanLite;
  /** 올린 사진 (공개 URL 또는 data URL). 0번이 대표 */
  images: string[];
  /** 생성한 모델컷 (data URL). 0 히어로, 1~3 포인트/디테일/뒷면. 없거나 빈 항목은 올린 사진으로 대신한다 */
  shots?: string[];
  brand: string;
  colors: string[];
  /** 배송·반품 안내용 */
  deliveryCharge: number;
  returnCharge: number;
  afterServicePhone: string;
  accent?: string;
}

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

const canvas = (h: number) => {
  const c = document.createElement('canvas');
  c.width = W; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  return { c, ctx };
};

/** 사진을 영역에 꽉 채워(cover) 그린다. 둥근 모서리 옵션 */
const cover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, r = 0) => {
  ctx.save();
  if (r > 0) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); }
  if (!img) { ctx.fillStyle = PAPER2; ctx.fillRect(x, y, w, h); ctx.restore(); return; }
  const ir = img.width / img.height, tr = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; } else { sh = img.width / tr; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
};

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3): string[] => {
  const out: string[] = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxWidth && line) { out.push(line.trim()); line = ch; } else line = next;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.slice(0, maxLines);
};

const text = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, opts: { size: number; weight?: number; color?: string; align?: CanvasTextAlign; maxWidth?: number; maxLines?: number; lineHeight?: number; letter?: number }) => {
  ctx.font = `${opts.weight ?? 500} ${opts.size}px ${FONT}`;
  ctx.fillStyle = opts.color ?? INK;
  ctx.textAlign = opts.align ?? 'left';
  const lh = opts.lineHeight ?? Math.round(opts.size * 1.45);
  const lines = opts.maxWidth ? wrap(ctx, s, opts.maxWidth, opts.maxLines ?? 3) : [s];
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
  return y + lines.length * lh;
};

const label = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, accent: string) => {
  // 작은 대문자 느낌의 구간 라벨 + 짧은 악센트 선
  ctx.fillStyle = accent; ctx.fillRect(x, y - 14, 28, 3);
  text(ctx, s, x, y + 14, { size: 15, weight: 700, color: accent, letter: 1 });
};

const sectionTitle = (ctx: CanvasRenderingContext2D, s: string, y: number, sub?: string) => {
  let yy = text(ctx, s, W / 2, y, { size: 36, weight: 800, align: 'center' });
  if (sub) yy = text(ctx, sub, W / 2, yy + 6, { size: 18, color: INK2, align: 'center' });
  return yy;
};

const png = (c: HTMLCanvasElement) => c.toDataURL('image/png');

export async function renderClothingDetail(input: TemplateInput): Promise<string[]> {
  const { plan, brand, colors } = input;
  const accent = input.accent || '#1f6feb';
  const imgs = await Promise.all(input.images.slice(0, 10).map(loadImage));
  const shots = await Promise.all((input.shots ?? []).slice(0, 4).map(u => (u ? loadImage(u) : Promise.resolve(null))));
  const hasShots = shots.some(Boolean);
  const heroImg = shots[0] ?? imgs[0] ?? null;
  const out: string[] = [];
  const pad = 64;

  // ── 1 인트로 ──
  {
    const H = hasShots ? 1180 : 1000;
    const { c, ctx } = canvas(H);
    cover(ctx, heroImg, 0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    let y = H - 150;
    if (brand) { ctx.font = `700 18px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'; ctx.fillText(brand.toUpperCase(), pad, y - 76); }
    ctx.font = `800 52px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    const hl = wrap(ctx, plan.headline, W - pad * 2, 2);
    hl.forEach((ln, i) => ctx.fillText(ln, pad, y - 10 + i * 62));
    y = y - 10 + hl.length * 62;
    if (plan.subline) text(ctx, plan.subline, pad, y + 14, { size: 22, color: 'rgba(255,255,255,0.88)' });
    out.push(png(c));
  }

  // ── 2 포인트 3 ──
  {
    const blockH = 300;
    const H = 170 + blockH * 3 + 40;
    const { c, ctx } = canvas(H);
    label(ctx, 'POINT', pad, 70, accent);
    sectionTitle(ctx, plan.target || '이런 분께 추천해요', 130);
    let y = 190;
    plan.points.forEach((p, i) => {
      const img = shots[i + 1] ?? imgs[p.imageIndex] ?? imgs[Math.min(i + 1, imgs.length - 1)] ?? imgs[0] ?? null;
      cover(ctx, img, pad, y, 330, blockH - 40, 18);
      // 번호 배지
      ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(pad + 350, y + 8, 44, 44, 22); ctx.fill();
      text(ctx, String(i + 1).padStart(2, '0'), pad + 372, y + 37, { size: 17, weight: 800, color: '#fff', align: 'center' });
      let ty = text(ctx, p.title, pad + 410, y + 44, { size: 28, weight: 800, maxWidth: W - pad * 2 - 410, maxLines: 2, lineHeight: 36 });
      text(ctx, p.desc, pad + 410, ty + 14, { size: 19, color: INK2, maxWidth: W - pad * 2 - 410, maxLines: 4, lineHeight: 30 });
      y += blockH;
    });
    out.push(png(c));
  }

  // ── 3 디테일 컷 ──
  // 생성 컷이 있으면 올린 사진은 전부 실제 제품 디테일로 쓴다 (대표도 포함)
  const detailImgs = (hasShots ? imgs.slice(0, 4) : imgs.slice(1, 5)).filter(Boolean) as HTMLImageElement[];
  if (detailImgs.length >= 1) {
    const cols = detailImgs.length === 1 ? 1 : 2;
    const cw = cols === 1 ? W - pad * 2 : (W - pad * 2 - 24) / 2;
    const ch = cols === 1 ? 760 : 460;
    const rows = Math.ceil(detailImgs.length / cols);
    const H = 170 + rows * (ch + 70) + 30;
    const { c, ctx } = canvas(H);
    label(ctx, 'DETAIL', pad, 70, accent);
    sectionTitle(ctx, '가까이서 봐도 깔끔해요', 130);
    detailImgs.forEach((img, i) => {
      const x = pad + (i % cols) * (cw + 24), y = 190 + Math.floor(i / cols) * (ch + 70);
      cover(ctx, img, x, y, cw, ch, 16);
      const cap = plan.detailCaptions[i];
      if (cap) text(ctx, cap, x + cw / 2, y + ch + 36, { size: 18, weight: 600, color: INK2, align: 'center' });
    });
    out.push(png(c));
  }

  // ── 4 핏 (뒷면/측면 생성 컷 전면 + 핏 문구) ──
  if (shots[3]) {
    const H = 1100;
    const { c, ctx } = canvas(H);
    cover(ctx, shots[3], 0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.font = `700 15px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'left'; ctx.fillText('FIT', pad, H - 128);
    text(ctx, plan.fit || '자연스럽게 떨어지는 핏', pad, H - 80, { size: 30, weight: 800, color: '#fff', maxWidth: W - pad * 2, maxLines: 2, lineHeight: 40 });
    out.push(png(c));
  }

  // ── 5 사이즈표 ──
  {
    const st = plan.sizeTable;
    const rows = st.rows.length ? st.rows : [{ size: 'FREE', values: st.columns.map(() => '-') }];
    const rowH = 58;
    const H = 170 + 70 + rows.length * rowH + 160;
    const { c, ctx } = canvas(H);
    label(ctx, 'SIZE', pad, 70, accent);
    sectionTitle(ctx, '사이즈 (cm)', 130);
    const tx = pad, tw = W - pad * 2, colsN = st.columns.length + 1, cw = tw / colsN;
    let y = 190;
    ctx.fillStyle = PAPER2; ctx.beginPath(); ctx.roundRect(tx, y, tw, rowH, 10); ctx.fill();
    ['사이즈', ...st.columns].forEach((h, i) => text(ctx, h, tx + cw * i + cw / 2, y + 37, { size: 17, weight: 700, align: 'center', color: INK2 }));
    y += rowH;
    rows.forEach((r, ri) => {
      ctx.strokeStyle = LINE; ctx.beginPath(); ctx.moveTo(tx, y + rowH); ctx.lineTo(tx + tw, y + rowH); ctx.stroke();
      text(ctx, r.size, tx + cw / 2, y + 37, { size: 18, weight: 800, align: 'center' });
      st.columns.forEach((_, ci) => text(ctx, r.values[ci] ?? '-', tx + cw * (ci + 1) + cw / 2, y + 37, { size: 18, weight: 500, align: 'center' }));
      y += rowH;
      void ri;
    });
    const noteText = /수정/.test(st.note) ? '단면 기준 측정 · 재는 방법에 따라 1~3cm 오차가 있을 수 있습니다' : st.note;
    let ny = text(ctx, noteText, W / 2, y + 48, { size: 15, color: INK3, align: 'center', maxWidth: tw, maxLines: 2 });
    if (plan.fit) ny = text(ctx, plan.fit, W / 2, ny + 22, { size: 18, weight: 600, color: INK2, align: 'center', maxWidth: tw, maxLines: 2 });
    if (colors.length >= 2) text(ctx, `컬러 ${colors.slice(0, 8).join(' · ')}`, W / 2, ny + 22, { size: 16, weight: 600, color: INK2, align: 'center', maxWidth: tw, maxLines: 2 });
    out.push(png(c));
  }

  // ── 6 소재·세탁 ──
  {
    const H = 560;
    const { c, ctx } = canvas(H);
    label(ctx, 'FABRIC & CARE', pad, 70, accent);
    sectionTitle(ctx, '소재와 관리', 130);
    const colW = (W - pad * 2 - 40) / 2;
    const boxY = 190, boxH = 300;
    [[ '소재', [plan.material || '상세페이지 참조', plan.season ? `추천 계절 ${plan.season}` : ''] ], ['세탁 · 취급', plan.care.length ? plan.care : ['세탁 라벨을 확인해주세요']]].forEach(([title, lines], i) => {
      const x = pad + i * (colW + 40);
      ctx.fillStyle = PAPER2; ctx.beginPath(); ctx.roundRect(x, boxY, colW, boxH, 18); ctx.fill();
      text(ctx, String(title), x + 28, boxY + 54, { size: 22, weight: 800 });
      let y = boxY + 100;
      (lines as string[]).filter(Boolean).forEach(ln => {
        ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x + 34, y - 7, 4, 0, Math.PI * 2); ctx.fill();
        y = text(ctx, ln, x + 50, y, { size: 18, color: INK2, maxWidth: colW - 80, maxLines: 2, lineHeight: 28 }) + 10;
      });
    });
    out.push(png(c));
  }

  // ── 7 안내 ──
  {
    const H = 560;
    const { c, ctx } = canvas(H);
    label(ctx, 'NOTICE', pad, 70, accent);
    sectionTitle(ctx, '배송 · 교환 · 반품 안내', 130);
    const items: Array<[string, string]> = [
      ['배송', input.deliveryCharge > 0 ? `배송비 ${input.deliveryCharge.toLocaleString('ko-KR')}원 · 결제 후 1~3일 내 출고 (주말·공휴일 제외)` : '무료배송 · 결제 후 1~3일 내 출고 (주말·공휴일 제외)'],
      ['교환 · 반품', `수령 후 7일 이내 신청 가능 · 단순 변심 시 반품 배송비 ${input.returnCharge.toLocaleString('ko-KR')}원 (편도) · 착용·세탁·택 제거 상품은 불가`],
      ['불량 · 오배송', '배송비 판매자 부담으로 교환 또는 환불해 드립니다'],
      ['A/S · 문의', input.afterServicePhone ? `판매자 ${input.afterServicePhone} · 쿠팡 고객문의로도 답변드립니다` : '쿠팡 고객문의로 남겨주시면 답변드립니다'],
    ];
    let y = 200;
    items.forEach(([t, d]) => {
      text(ctx, t, pad, y, { size: 19, weight: 800 });
      const end = text(ctx, d, pad + 170, y, { size: 18, color: INK2, maxWidth: W - pad * 2 - 170, maxLines: 3, lineHeight: 28 });
      y = Math.max(end, y + 28) + 26;
      ctx.strokeStyle = LINE; ctx.beginPath(); ctx.moveTo(pad, y - 14); ctx.lineTo(W - pad, y - 14); ctx.stroke();
    });
    out.push(png(c));
  }

  return out;
}
