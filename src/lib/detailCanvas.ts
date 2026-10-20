/**
 * 상세페이지 이미지 위에 한글 카피를 캔버스로 얹는다.
 *
 * 이미지 모델에 한글을 맡기면 글자가 깨진다. 모델은 글자 없는 배경만 만들고,
 * 카피는 브라우저 캔버스가 선명하게 그린다. 예전 DetailPlanner 안에 있던
 * 코드를 그대로 옮겨 왔고(비교표만 뺐다), 화면 쪽은 overlayCopy 하나만 부른다.
 */
export const TARGET_WIDTH = 860;
export const TARGET_HEIGHT = 1000;
const DETAIL_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

const waitForCanvasFonts = async () => {
    if (!document.fonts) return;
    try {
        await Promise.all([
            document.fonts.load(`700 32px ${DETAIL_FONT_FAMILY}`),
            document.fonts.load(`900 64px ${DETAIL_FONT_FAMILY}`),
            document.fonts.ready,
        ]);
    } catch (error) {
        console.warn('폰트 로딩 확인 실패, 시스템 폰트로 렌더링합니다:', error);
    }
};

export const normalizeOverlayCopy = (value: string): string => (
    value
        .normalize('NFC')
        .replace(/\r/g, '\n')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim()
);

const getTextColor = (design?: { colors?: Record<string, string> }): string => (
    design?.colors?.text || '#111827'
);

const getAccentColor = (design?: { colors?: Record<string, string> }): string => (
    design?.colors?.accent || design?.colors?.primary || '#2563eb'
);


const getColorLuminance = (hexColor: string): number => {
    const h = hexColor.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) || 17;
    const g = parseInt(h.substring(2, 4), 16) || 24;
    const b = parseInt(h.substring(4, 6), 16) || 39;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

const withAlpha = (hexColor: string, alpha: number): string => {
    const h = hexColor.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) || 37;
    const g = parseInt(h.substring(2, 4), 16) || 99;
    const b = parseInt(h.substring(4, 6), 16) || 235;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const wrapText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxLines: number
): string[] => {
    const sourceLines = normalizeOverlayCopy(text).split('\n').filter(Boolean);
    const wrapped: string[] = [];

    for (const sourceLine of sourceLines) {
        let line = '';
        const tokens = sourceLine.split(/(\s+)/).filter(Boolean);
        for (const token of tokens) {
            if (/^\s+$/.test(token)) {
                if (line && !line.endsWith(' ')) line += ' ';
                continue;
            }

            const next = `${line}${token}`;
            if (ctx.measureText(next).width > maxWidth && line.length > 0) {
                wrapped.push(line.trim());
                if (ctx.measureText(token).width > maxWidth) {
                    let charLine = '';
                    for (const char of Array.from(token)) {
                        const charNext = charLine + char;
                        if (ctx.measureText(charNext).width > maxWidth && charLine.length > 0) {
                            wrapped.push(charLine.trim());
                            charLine = char;
                        } else {
                            charLine = charNext;
                        }
                    }
                    line = charLine;
                } else {
                    line = token;
                }
            } else {
                line = next;
            }
        }
        if (line.trim()) wrapped.push(line.trim());
    }

    return wrapped.slice(0, maxLines);
};

const buildHeadlineLayout = (
    ctx: CanvasRenderingContext2D,
    copy: string,
    position: 'top' | 'middle' | 'bottom'
) => {
    const maxWidth = TARGET_WIDTH - 130;
    const maxLines = 3; // 문구 최소화 — 헤드라인은 최대 3줄까지만
    let fontSize = position === 'middle' ? 46 : 50;
    const minFontSize = 22;
    let lines: string[] = [];
    let lineHeight = 0;

    while (fontSize >= minFontSize) {
        ctx.font = `800 ${fontSize}px ${DETAIL_FONT_FAMILY}`;
        lines = wrapText(ctx, copy, maxWidth, maxLines);
        lineHeight = Math.round(fontSize * 1.3);
        const widest = Math.max(0, ...lines.map(line => ctx.measureText(line).width));
        const totalHeight = lines.length * lineHeight;
        if (widest <= maxWidth && totalHeight <= 210) break;
        fontSize -= 2;
    }

    return { lines, fontSize, lineHeight, maxWidth };
};


// 텍스트가 놓일 영역의 실제 픽셀 밝기와 편차를 측정 (글자색 자동 선택용)
const sampleRegionBrightness = (
    ctx: CanvasRenderingContext2D,
    top: number,
    height: number
): { luminance: number; variance: number } => {
    const y0 = Math.max(0, Math.floor(top - 10));
    const y1 = Math.min(TARGET_HEIGHT, Math.ceil(top + height + 10));
    const h = Math.max(1, y1 - y0);
    try {
        const data = ctx.getImageData(0, y0, TARGET_WIDTH, h).data;
        let sum = 0;
        let sumSq = 0;
        let count = 0;
        // 4px 간격 샘플링 (전 픽셀 순회는 불필요하게 느림)
        for (let i = 0; i < data.length; i += 4 * 4) {
            const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
            sum += l;
            sumSq += l * l;
            count += 1;
        }
        if (count === 0) return { luminance: 1, variance: 0 };
        const mean = sum / count;
        return { luminance: mean, variance: Math.max(0, sumSq / count - mean * mean) };
    } catch {
        // 캔버스 오염(cross-origin) 등으로 읽기 실패 시 밝은 배경으로 간주
        return { luminance: 1, variance: 0 };
    }
};

// 디자인 시스템 텍스트 컬러가 너무 밝으면 가독성을 위해 진한 색으로 대체
const resolveDarkTextColor = (design?: { colors?: Record<string, string> }): string => {
    const color = getTextColor(design);
    return getColorLuminance(color) > 0.5 ? '#111827' : color;
};

// 배경이 복잡할 때만 사용하는 아주 옅은 스크림 (판때기처럼 보이지 않게)
const drawSoftScrim = (
    ctx: CanvasRenderingContext2D,
    top: number,
    height: number,
    lightText: boolean
) => {
    const pad = 46;
    const y0 = Math.max(0, top - pad);
    const y1 = Math.min(TARGET_HEIGHT, top + height + pad);
    const gradient = ctx.createLinearGradient(0, y0, 0, y1);
    const solid = lightText ? 'rgba(10, 12, 16, 0.34)' : 'rgba(255, 255, 255, 0.38)';
    const clear = lightText ? 'rgba(10, 12, 16, 0)' : 'rgba(255, 255, 255, 0)';
    gradient.addColorStop(0, clear);
    gradient.addColorStop(0.5, solid);
    gradient.addColorStop(1, clear);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y0, TARGET_WIDTH, y1 - y0);
};

// 판/칩 없는 미니멀 타이포그래피: 헤드라인 위 얇은 악센트 라인만 사용
const drawAccentLine = (
    ctx: CanvasRenderingContext2D,
    topY: number,
    accentColor: string
) => {
    ctx.save();
    ctx.fillStyle = withAlpha(accentColor, 0.92);
    ctx.beginPath();
    ctx.roundRect(TARGET_WIDTH / 2 - 30, topY, 60, 4, 999);
    ctx.fill();
    ctx.restore();
};

// 경쟁 대비 섹션 전용: AI 이미지에 한글 표를 맡기면 글자가 깨지므로
// 비교표를 캔버스로 직접 그린다 (기획안의 competitorComparison 데이터 사용)

/** 헤드라인을 14자 안팎으로 끊어 캔버스에서 2~3줄로 읽히게 한다 */
export const formatMainCopy = (value: string): string => {
    const out: string[] = [];
    normalizeOverlayCopy(value).split('\n').forEach((line) => {
        const chars = Array.from(line.trim());
        if (chars.length <= 14) { if (chars.length) out.push(chars.join('')); return; }
        // 공백 기준으로 14자 이내 조각으로
        let cur = '';
        for (const tok of line.trim().split(/\s+/)) {
            const next = cur ? `${cur} ${tok}` : tok;
            if (Array.from(next).length <= 14) { cur = next; continue; }
            if (cur) out.push(cur);
            cur = Array.from(tok).length > 14 ? Array.from(tok).slice(0, 14).join('') : tok;
        }
        if (cur) out.push(cur);
    });
    return out.slice(0, 3).join('\n');
};

export interface OverlayCopy {
    mainCopy: string;
    subCopy: string;
    textPosition: 'top' | 'middle' | 'bottom';
}

/** 생성된 배경 이미지(data URL) 위에 카피를 얹은 860×1000 PNG data URL을 돌려준다 */
export const overlayCopy = async (
    imageUrl: string,
    seg: OverlayCopy,
    design?: { colors?: Record<string, string> },
): Promise<string> => {
    await waitForCanvasFonts();
    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = TARGET_WIDTH;
            canvas.height = TARGET_HEIGHT;
            const ctx = canvas.getContext('2d')!;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // 가운데 기준으로 잘라 4:5에 맞춘다
            const imgRatio = img.width / img.height;
            const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (imgRatio > targetRatio) { sw = img.height * targetRatio; sx = (img.width - sw) / 2; }
            else { sh = img.width / targetRatio; sy = (img.height - sh) / 2; }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

            const headline = buildHeadlineLayout(ctx, formatMainCopy(seg.mainCopy), seg.textPosition);
            const subCopy = normalizeOverlayCopy(seg.subCopy);
            const subFont = 25;
            const subHeight = subCopy ? 38 : 0;
            const accentHeight = 20;
            const headlineHeight = headline.lines.length * headline.lineHeight;
            const blockHeight = accentHeight + headlineHeight + subHeight + 8;

            const SAFE_MARGIN = 56;
            const minCenter = SAFE_MARGIN + blockHeight / 2;
            const maxCenter = TARGET_HEIGHT - SAFE_MARGIN - blockHeight / 2;
            const desiredCenter = seg.textPosition === 'top'
                ? blockHeight / 2 + 64
                : seg.textPosition === 'middle'
                    ? TARGET_HEIGHT / 2
                    : TARGET_HEIGHT - blockHeight / 2 - 72;
            const centerY = maxCenter < minCenter ? TARGET_HEIGHT / 2 : Math.min(maxCenter, Math.max(minCenter, desiredCenter));

            // 배경 밝기를 재서 글자색을 고른다 — 어두우면 흰 글씨
            const blockTop = centerY - blockHeight / 2;
            const bg = sampleRegionBrightness(ctx, blockTop, blockHeight);
            const useLightText = bg.luminance < 0.55;
            const textColor = useLightText ? '#ffffff' : resolveDarkTextColor(design);
            const accentColor = useLightText ? '#ffffff' : getAccentColor(design);
            if (bg.variance > 0.055) drawSoftScrim(ctx, blockTop, blockHeight, useLightText);
            drawAccentLine(ctx, blockTop, accentColor);

            let y = blockTop + accentHeight + headline.lineHeight / 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = useLightText ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.45)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 0;
            ctx.font = `800 ${headline.fontSize}px ${DETAIL_FONT_FAMILY}`;
            headline.lines.forEach((line) => {
                ctx.fillStyle = textColor;
                ctx.fillText(line, TARGET_WIDTH / 2, y);
                y += headline.lineHeight;
            });
            if (subCopy) {
                y += 4;
                ctx.font = `500 ${subFont}px ${DETAIL_FONT_FAMILY}`;
                ctx.globalAlpha = 0.92;
                ctx.fillStyle = textColor;
                wrapText(ctx, subCopy, TARGET_WIDTH - 180, 1).forEach((line) => ctx.fillText(line, TARGET_WIDTH / 2, y));
                ctx.globalAlpha = 1;
            }
            ctx.shadowBlur = 0;
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(imageUrl);
        img.src = imageUrl;
    });
};
