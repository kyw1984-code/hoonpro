import React, { useEffect, useState, useRef, type DragEvent } from 'react';
import { analyzeImageVision, generateImage, generateDetailPlan, generateProductBrief, type DetailPlan, type ProductBrief, type GeneratedImageResult, type VisionAnalysisResult } from '../../api/aiService';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Eye, FileText, Image as ImageIcon, Layers3, Loader2, Lock, Palette, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { getToken } from '../../lib/auth';

// ────────────────────────────── 상수 ──────────────────────────────
type CombinationType = 'single' | `bundle-${number}`;
type ToneKey = 'auto' | '프리미엄' | '미니멀' | '감성' | '럭셔리' | '건강' | '테크' | '친환경';
type ImageStatus = 'idle' | 'queued' | 'generating' | 'done' | 'failed' | 'retrying';
type LayoutPreset = 'hero' | 'problem' | 'solution' | 'proof' | 'detail' | 'lifestyle' | 'cta';
type ProductColorLock = 'black' | 'white' | 'none';
type ModelGenderLock = 'male' | 'female' | 'none';
type ProductVisualGenderLock = 'male' | 'female' | 'unisex' | 'none';
type TextRenderMode = 'canvas';
type ImageFilter = 'all' | 'warning' | 'failed' | 'done';
type ProductSurfaceLock = 'printed' | 'plain' | 'unknown';
type ShotType = 'model' | 'product' | 'detail' | 'texture' | 'lifestyle' | 'cta';
type BundleRequirement = 'both-items' | 'single-focus' | 'before-no-current-product';

interface ProductVisualLock {
    genderLock: ProductVisualGenderLock;
    inferredGenderReason?: string;
    colorLock: ProductColorLock;
    surfaceLock: ProductSurfaceLock;
    mustPreserve: string[];
    forbiddenChanges: string[];
    heroModelDirection: string;
}

interface ReferenceProfile {
    index: number;
    image: string;
    summary: string;
    preserveProfile: string;
    warnings: string[];
    detectedColors: string[];
    detectedSurface: ProductSurfaceLock;
    detectedProductCount?: number;
}

interface MasterReferences {
    hookModel?: string;
    productDetail?: string;
}

const TONE_OPTIONS: ToneKey[] = ['auto', '프리미엄', '미니멀', '감성', '럭셔리', '건강', '테크', '친환경'];
const LENGTH_OPTIONS: Array<{ val: number | 'auto'; label: string; desc: string }> = [
    { val: 8, label: '8장', desc: '빠른 기본 구성' },
    { val: 'auto', label: 'Auto', desc: '상품 흐름에 맞춰 자동 구성' },
    { val: 12, label: '12장', desc: 'V2.1 표준 구성' },
    { val: 15, label: '15장', desc: '셀링포인트 최대 확장' },
];
const getCombinationCount = (type: CombinationType | string): number => {
    if (type === 'single') return 1;
    const match = /^bundle-(\d+)$/.exec(String(type));
    const count = match ? Number(match[1]) : String(type).split('+').filter(Boolean).length;
    return Number.isFinite(count) && count >= 2 ? Math.min(4, count) : 1;
};

const isBundleCombination = (type: CombinationType | string): boolean => getCombinationCount(type) >= 2;

const getCombinationLabel = (type: CombinationType | string): string => {
    const count = getCombinationCount(type);
    return count >= 2 ? `${count}개 조합` : '단품';
};

const COMBINATION_OPTIONS: Array<{ value: CombinationType; label: string; desc: string }> = [
    { value: 'single', label: '단품', desc: '단품 중심 상세페이지' },
    ...Array.from({ length: 3 }, (_, idx) => {
        const count = idx + 2;
        return {
            value: `bundle-${count}` as CombinationType,
            label: `${count}개 조합`,
            desc: `${count}개 구성을 함께 강조`,
        };
    }),
];

const FORBIDDEN_COPY_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string; label: string }> = [
    { pattern: /판매\s*1위/g, replacement: '많은 고객이 선택한', label: '검증 불가 표현: 판매 1위' },
    { pattern: /효과\s*보장/g, replacement: '만족을 기대할 수 있는', label: '검증 불가 표현: 효과 보장' },
    { pattern: /\d{2,3}\s*%\s*(만족|효과|개선|추천)/g, replacement: '높은 만족을 기대하는', label: '검증 불가 수치 표현' },
    { pattern: /100\s*만\s*개|누적\s*\d+/g, replacement: '꾸준히 선택받는', label: '검증 불가 누적 수량' },
];

const sanitizeCopy = (value: string): { text: string; warnings: string[] } => {
    let text = normalizeOverlayCopy(value);
    const warnings: string[] = [];
    FORBIDDEN_COPY_REPLACEMENTS.forEach(({ pattern, replacement, label }) => {
        if (pattern.test(text)) {
            warnings.push(`${label}을 안전한 문구로 순화했습니다.`);
            text = text.replace(pattern, replacement);
        }
    });
    return { text, warnings };
};

const resolveLayoutPreset = (sectionType: string, role: string, index: number, total: number): LayoutPreset => {
    const source = `${sectionType} ${role}`.toLowerCase();
    if (index === 0 || source.includes('hook') || source.includes('offer')) return 'hero';
    if (index === total - 1 || source.includes('cta')) return 'cta';
    if (source.includes('problem') || source.includes('문제') || source.includes('공감')) return 'problem';
    if (source.includes('solution') || source.includes('해결')) return 'solution';
    if (source.includes('proof') || source.includes('trust') || source.includes('신뢰')) return 'proof';
    if (source.includes('life') || source.includes('활용')) return 'lifestyle';
    return 'detail';
};

const getDefaultTextPosition = (preset: LayoutPreset, index: number): 'top' | 'middle' | 'bottom' => {
    if (preset === 'hero' || preset === 'cta') return 'bottom';
    if (preset === 'problem') return index % 2 === 0 ? 'top' : 'middle';
    if (preset === 'proof' || preset === 'detail') return index % 2 === 0 ? 'bottom' : 'top';
    return index % 3 === 0 ? 'top' : index % 3 === 1 ? 'bottom' : 'middle';
};

const getLayoutVisualGuide = (preset?: LayoutPreset): string => {
    switch (preset) {
        case 'hero':
            return 'Use a strong designer-made hero composition with layered background, dramatic lighting, premium props or set pieces, and a memorable first impression. Not a flat catalog shot.';
        case 'problem':
            return 'Show a relatable customer situation or discomfort moment with an editorial set, depth, atmosphere, and premium realistic styling.';
        case 'solution':
            return 'Show the product as the solution in a designed scene with clear visual metaphor, depth, shadow, and premium commercial composition.';
        case 'proof':
            return 'Use designer close-up detail, material, finish, craft, quality-control, or trust-building evidence with angled light, textured surfaces, and premium set design.';
        case 'lifestyle':
            return 'Show a natural daily-life usage scene, warm and practical, different from studio hero shots.';
        case 'cta':
            return 'Use a purchase-confidence closing shot with a premium designed background, product pedestal, layered depth, and decisive commercial composition.';
        case 'detail':
        default:
            return 'Use a designer product detail composition with a fresh camera angle, dimensional background, texture, fit, function, or usage detail.';
    }
};

const getDesignerSetGuide = (shotType: ShotType): string => {
    switch (shotType) {
        case 'product':
            return 'Designer set direction: premium editorial product hero scene, dimensional colored or textured background, subtle pedestal or platform, layered shadows, soft gradients from real lighting, tasteful props related to the product category, not a plain white background.';
        case 'detail':
            return 'Designer set direction: macro product detail on textured surface, angled commercial lighting, shallow depth of field, background layers, premium material mood, not a flat isolated product photo.';
        case 'texture':
            return 'Designer set direction: macro print/material story with fabric folds, tactile texture, directional side light, premium shadow, close crop, and designed negative space, not a blank white product cutout.';
        case 'cta':
            return 'Designer set direction: final purchase hero with premium pedestal, atmospheric depth, confident product scale, refined props, decisive lighting, not a plain white background.';
        case 'lifestyle':
            return 'Designer set direction: realistic lifestyle environment with depth, styled props, premium atmosphere, natural light, and product-led storytelling.';
        case 'model':
        default:
            return 'Designer set direction: editorial commerce scene with premium styling, layered background, natural pose, controlled light, and product-led composition.';
    }
};

const SHOT_TYPE_LABEL: Record<ShotType, string> = {
    model: '모델컷',
    product: '제품컷',
    detail: '디테일',
    texture: '소재/프린팅',
    lifestyle: '사용장면',
    cta: 'CTA 제품컷',
};

const isModelShot = (shotType?: ShotType): boolean => shotType === 'model' || shotType === 'lifestyle';

const isProblemContrastSection = (img: Pick<GenImage, 'sectionType' | 'role' | 'layoutPreset' | 'number'>): boolean => {
    const source = `${img.sectionType} ${img.role}`.toLowerCase();
    return img.number !== 1 && (
        img.layoutPreset === 'problem' ||
        source.includes('problem') ||
        source.includes('문제') ||
        source.includes('공감') ||
        source.includes('불편') ||
        source.includes('고민')
    );
};

const resolveBundleRequirement = (
    img: Pick<GenImage, 'number' | 'role' | 'layoutPreset' | 'sectionType' | 'shotType'>,
    combinationType: CombinationType
): BundleRequirement | undefined => {
    if (!isBundleCombination(combinationType)) return undefined;
    if (isProblemContrastSection(img)) return 'before-no-current-product';
    if (
        img.number === 1 ||
        img.role.includes('특장점') ||
        img.layoutPreset === 'cta' ||
        img.shotType === 'cta' ||
        img.shotType === 'lifestyle'
    ) return 'both-items';
    return 'single-focus';
};

const resolveShotType = (sectionType: string, role: string, layoutPreset: LayoutPreset, index: number, total: number, requested?: string): ShotType => {
    if (index === 0 || layoutPreset === 'hero' || `${sectionType} ${role}`.toLowerCase().includes('hook')) return 'model';
    if (requested && requested in SHOT_TYPE_LABEL) return requested as ShotType;
    const source = `${sectionType} ${role}`.toLowerCase();
    if (index === total - 1 || layoutPreset === 'cta' || source.includes('cta')) return 'cta';
    if (source.includes('texture') || source.includes('소재') || source.includes('프린팅') || source.includes('로고') || source.includes('패턴')) return 'texture';
    if (layoutPreset === 'problem' || layoutPreset === 'lifestyle') return 'lifestyle';
    if (layoutPreset === 'proof' || layoutPreset === 'detail') return index % 2 === 0 ? 'detail' : 'texture';
    if (layoutPreset === 'solution') return 'product';
    if (layoutPreset === 'hero') return 'model';
    return 'product';
};

const getShotTypeGuide = (shotType: ShotType, genderLock: ProductVisualGenderLock): string => {
    switch (shotType) {
        case 'model':
            return [
                'SHOT TYPE: MODEL CUT.',
                'Use exactly one fictional Korean model naturally wearing or using the reference product.',
                buildModelGenderInstruction(genderLock),
                'Keep the model secondary to accurate product identity. Avoid extra models or crowd scenes.',
            ].join(' ');
        case 'lifestyle':
            return [
                'SHOT TYPE: LIFESTYLE USAGE.',
                'Show a natural usage situation. A partial hand/body or one model may appear only if it helps explain use.',
                buildModelGenderInstruction(genderLock),
                'Do not make this a repeated fashion model pose; keep product use and context primary.',
            ].join(' ');
        case 'detail':
            return 'SHOT TYPE: PRODUCT DETAIL CLOSE-UP. No model, no person, product only. Show seams, cut, fit detail, finish, hardware, logo/print placement, and functional parts in an extreme close-up. Product-only does not mean plain white catalog; use designed set styling.';
        case 'texture':
            return 'SHOT TYPE: TEXTURE / PRINT CLOSE-UP. No model, no person, product only. Show fabric/material texture, print/graphic/logo/pattern/embroidery placement, scale, and colors clearly. Use premium macro styling, not a white background cutout.';
        case 'cta':
            return 'SHOT TYPE: CTA PRODUCT HERO. No model, no person, product only. Use a purchase-confidence closing composition focused on the exact product with premium set design and depth.';
        case 'product':
        default:
            return 'SHOT TYPE: PRODUCT-ONLY HERO. No model, no person, product only. Create a premium designer-made product merchandising shot with dimensional set, category-relevant props, realistic shadows, and exact reference product identity. Not a plain white background catalog image.';
    }
};

const TEXT_RENDER_MODE_LABEL: Record<TextRenderMode, string> = {
    canvas: '안전 모드',
};

const compactCopyLine = (value: string, maxLength: number): string => {
    const normalized = normalizeOverlayCopy(value).replace(/\s+/g, ' ');
    return Array.from(normalized).slice(0, maxLength).join('');
};

const splitCopyLineByLength = (line: string, maxLength: number): string[] => {
    const normalized = line.replace(/[^\S\n]+/g, ' ').trim();
    if (!normalized) return [];

    const tokens = normalized.split(/(\s+)/).filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    const pushLongToken = (token: string) => {
        const chars = Array.from(token);
        for (let i = 0; i < chars.length; i += maxLength) {
            const chunk = chars.slice(i, i + maxLength).join('').trim();
            if (chunk) chunks.push(chunk);
        }
    };

    for (const token of tokens) {
        if (/^\s+$/.test(token)) {
            if (current && !current.endsWith(' ')) current += ' ';
            continue;
        }

        const next = `${current}${token}`;
        if (Array.from(next.trim()).length <= maxLength) {
            current = next;
            continue;
        }

        if (current.trim()) chunks.push(current.trim());
        if (Array.from(token).length > maxLength) {
            pushLongToken(token);
            current = '';
        } else {
            current = token;
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
};

const formatMainCopy = (value: string): string => {
    const lines: string[] = [];
    normalizeOverlayCopy(value)
        .replace(/[^\S\n]+/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .forEach(line => {
            lines.push(...splitCopyLineByLength(line, 14));
        });
    return lines.join('\n');
};

const tidyImageCopy = (img: GenImage): Partial<GenImage> => ({
    mainCopy: formatMainCopy(img.mainCopy),
    subCopy: compactCopyLine(img.subCopy, 24),
});

const detectProductColorLock = (value: string): ProductColorLock => {
    const source = value.toLowerCase();
    const blackKeywords = ['black', '블랙', '검정', '검은색', '흑색', '차콜', 'charcoal'];
    const whiteKeywords = ['white', '화이트', '흰색', '백색', '순백', '아이보리 아님'];
    if (blackKeywords.some(keyword => source.includes(keyword))) return 'black';
    if (whiteKeywords.some(keyword => source.includes(keyword))) return 'white';
    return 'none';
};

const buildColorLockInstruction = (colorLock: ProductColorLock): string => {
    if (colorLock === 'white') {
        return [
            'CRITICAL PRODUCT COLOR LOCK: the product is WHITE.',
            'The generated product must remain pure white / clean white only in every section.',
            'Do NOT turn the product black, beige, gray, ivory, pastel, metallic silver, or any darker/brighter substitute color.',
            'Lighting may reveal texture and edges, but the product material itself must stay white.',
            'Backgrounds may be premium and varied, but the product color must never change from white.',
        ].join(' ');
    }
    if (colorLock !== 'black') {
        return 'Preserve the exact product color from the reference images. Do not recolor, brighten, repaint, or substitute the product color.';
    }
    return [
        'CRITICAL PRODUCT COLOR LOCK: the product is BLACK.',
        'The generated product must remain black / deep charcoal only in every section.',
        'Do NOT turn the product white, beige, gray, pastel, metallic silver, or any brighter color.',
        'Lighting may reveal texture and edges, but the product material itself must stay black.',
        'Backgrounds may be premium and varied, but the product color must never change from black.',
    ].join(' ');
};

const detectProductSurfaceLock = (value: string): ProductSurfaceLock => {
    const source = value.toLowerCase();
    const printedKeywords = ['프린팅', '프린트', '나염', '그래픽', '레터링', '로고', '패턴', '무늬', '자수', 'print', 'printed', 'graphic', 'lettering', 'logo', 'pattern', 'embroidered'];
    const plainKeywords = ['무지', '민무늬', '솔리드', 'plain', 'solid color', 'no print'];
    if (printedKeywords.some(keyword => source.includes(keyword))) return 'printed';
    if (plainKeywords.some(keyword => source.includes(keyword))) return 'plain';
    return 'unknown';
};

const buildSurfaceLockInstruction = (surfaceLock: ProductSurfaceLock): string => {
    if (surfaceLock === 'printed') {
        return [
            'CRITICAL PRINT/PATTERN LOCK: this is a printed/graphic product.',
            'Preserve the exact print, graphic, lettering, logo, pattern, embroidery, placement, scale, and colors from the reference product.',
            'Do NOT remove the print, simplify it into a plain product, change print colors, invent a new graphic, mirror text, or blur the artwork.',
            'If the print is partly visible in the reference, keep the same visible identity and do not replace it with a generic blank surface.',
        ].join(' ');
    }
    if (surfaceLock === 'plain') {
        return [
            'CRITICAL PLAIN PRODUCT LOCK: this is a plain/solid-color product.',
            'Keep the product clean and plain. Do NOT add new prints, logos, lettering, patches, patterns, graphics, or decorative artwork.',
        ].join(' ');
    }
    return [
        'REFERENCE SURFACE LOCK: use the reference product surface as the source of truth.',
        'If the product has any print, graphic, logo, lettering, pattern, embroidery, trim, or unique detail, preserve it exactly.',
        'If the product is plain, keep it plain and do not add new artwork.',
    ].join(' ');
};

const detectModelGenderLock = (value: string): ProductVisualGenderLock => {
    const source = value.toLowerCase();
    const unisexKeywords = ['남녀공용', '남여공용', '유니섹스', '공용', 'unisex', '커플'];
    if (unisexKeywords.some(keyword => source.includes(keyword))) return 'unisex';
    const hasMale = /남성|남자|남아|남용|남성용|남자옷|남성복|맨즈|\bmen\b|\bmen's\b|\bmens\b|\bmale\b|\bman\b/.test(source);
    const hasFemale = /여성|여자|여아|여용|여성용|여자옷|여성복|우먼|\bwomen\b|\bwomen's\b|\bwomens\b|\bfemale\b|\bwoman\b/.test(source);
    if (hasMale && !hasFemale) return 'male';
    if (hasFemale && !hasMale) return 'female';
    return 'none';
};

const buildModelGenderInstruction = (genderLock: ProductVisualGenderLock): string => {
    if (genderLock === 'male') {
        return 'MODEL GENDER LOCK: Use fictional Korean male models only. Do NOT generate female models in any section.';
    }
    if (genderLock === 'female') {
        return 'MODEL GENDER LOCK: Use fictional Korean female models only. Do NOT generate male models in any section.';
    }
    if (genderLock === 'unisex') {
        return 'UNISEX PRODUCT: Do not force male or female. Choose a natural fictional Korean model that fits a unisex product, with product identity as the priority.';
    }
    return 'Choose model gender naturally for the product and target customer. If no model is needed, focus on product detail or usage.';
};

const buildCopySafeInstruction = (position: 'top' | 'middle' | 'bottom'): string => {
    if (position === 'top') {
        return 'Reserve the top 28% as clean negative space for overlay text. Keep the product, model face, hands, logo, and key details below that zone.';
    }
    if (position === 'middle') {
        return 'Reserve a soft clean horizontal band around the center for overlay text. Place the product/model slightly above, below, or to the side so key details are not behind the text.';
    }
    return 'Reserve the bottom 30% as clean negative space for overlay text. Keep the product, model face, hands, logo, and key details above that zone.';
};

const getGenderLabel = (genderLock: ProductVisualGenderLock): string => {
    if (genderLock === 'male') return '남성';
    if (genderLock === 'female') return '여성';
    if (genderLock === 'unisex') return '공용';
    return '자동';
};

const buildProductVisualLock = (
    info: InputInfo,
    brief: ProductBrief | null,
    briefTextValue: string,
    previous?: ProductVisualLock | null
): ProductVisualLock => {
    const source = [
        info.name,
        info.category,
        info.description,
        info.target,
        briefTextValue,
        brief?.productIdentity || '',
        brief?.visualMustKeep?.join(' ') || '',
        brief?.targetMood || '',
        brief?.heroDirection || '',
        brief?.inferredGender || '',
    ].join(' ');
    const inferred = brief?.inferredGender && ['male', 'female', 'unisex', 'none'].includes(brief.inferredGender)
        ? brief.inferredGender
        : detectModelGenderLock(source);
    const genderLock = previous?.genderLock && previous.genderLock !== 'none'
        ? previous.genderLock
        : inferred;
    const colorLock = detectProductColorLock(source);
    const surfaceLock = detectProductSurfaceLock(source);
    const mustPreserve = Array.from(new Set([
        ...(brief?.visualMustKeep || []),
        colorLock === 'black' ? '블랙 색상 유지' : '',
        colorLock === 'white' ? '화이트 색상 유지' : '',
        surfaceLock === 'printed' ? '프린팅/로고/그래픽 위치와 색상 유지' : '',
        surfaceLock === 'plain' ? '무지/솔리드 표면 유지' : '',
        '제품 형태와 핏 유지',
    ].filter(Boolean)));
    const forbiddenChanges = [
        '제품 색상 변경 금지',
        '제품 종류/실루엣 변경 금지',
        '프린팅/로고/패턴 제거 또는 새로 추가 금지',
        '제품 단독 섹션의 사람/손/마네킹 등장 금지',
    ];
    return {
        genderLock,
        inferredGenderReason: brief?.inferredGenderReason || (genderLock === 'none' ? '성별 단서가 불명확해 자동 모델로 처리합니다.' : '상품 정보와 브리프의 성별 단서를 기준으로 자동 판정했습니다.'),
        colorLock,
        surfaceLock,
        mustPreserve,
        forbiddenChanges,
        heroModelDirection: brief?.heroDirection || '제품을 착용/사용한 강한 Hook 모델컷',
    };
};

const inspectImageQuality = (
    img: Omit<GenImage, 'qualityWarnings'>,
    allMainCopies: string[],
    index: number,
    total: number
): string[] => {
    const warnings: string[] = [];
    const normalizedMain = normalizeOverlayCopy(img.mainCopy);
    const mainLines = normalizedMain.split('\n').filter(Boolean);
    if (!normalizedMain) warnings.push('메인 카피가 비어 있습니다.');
    FORBIDDEN_COPY_REPLACEMENTS.forEach(({ pattern, label }) => {
        if (new RegExp(pattern.source).test(`${img.mainCopy} ${img.subCopy}`)) {
            warnings.push(`${label}이 포함되어 있습니다.`);
        }
    });
    if (mainLines.length > 4) warnings.push('메인 카피가 길어 폰트가 작아질 수 있습니다.');
    if (mainLines.some(line => Array.from(line).length > 14)) warnings.push('메인 카피 한 줄이 14자를 넘습니다.');
    if (Array.from(normalizeOverlayCopy(img.subCopy)).length > 24) warnings.push('서브 카피가 24자를 넘습니다.');
    if (!normalizeOverlayCopy(img.visualPrompt)) warnings.push('이미지 프롬프트가 비어 있습니다.');
    if (allMainCopies.filter(copy => copy === normalizedMain).length > 1) warnings.push('다른 이미지와 메인 카피가 중복됩니다.');
    if (index === 0 && img.layoutPreset !== 'hero') warnings.push('첫 이미지는 Hook/Hero 역할이 권장됩니다.');
    if (index === total - 1 && img.layoutPreset !== 'cta') warnings.push('마지막 이미지는 CTA 역할이 권장됩니다.');
    if (!img.shotType) warnings.push('촬영 타입이 비어 있습니다.');
    const expectedFlow: Array<{ preset: LayoutPreset; label: string }> = [
        { preset: 'hero', label: 'Hook' },
        { preset: 'problem', label: '공감' },
        { preset: 'solution', label: '해결' },
        { preset: 'proof', label: '근거' },
        { preset: 'detail', label: '디테일' },
        { preset: 'lifestyle', label: '활용' },
        { preset: 'proof', label: '신뢰' },
        { preset: 'cta', label: 'CTA' },
    ];
    const expected = expectedFlow[Math.min(index, expectedFlow.length - 1)];
    if (total >= 8 && expected && index !== 4 && img.layoutPreset !== expected.preset) {
        warnings.push(`${index + 1}번은 ${expected.label} 흐름이 더 자연스럽습니다.`);
    }
    return warnings;
};

const isFeatureBenefitImage = (img: Pick<GenImage, 'role' | 'stage' | 'sectionType' | 'mainCopy' | 'subCopy'>): boolean => {
    const source = `${img.role} ${img.stage} ${img.sectionType} ${img.mainCopy} ${img.subCopy}`.toLowerCase();
    return /특장점|핵심\s*장점|셀링|benefit|feature|advantage|usp|차별점/.test(source);
};

const getImageQaTags = (img: Omit<GenImage, 'qaTags'>): string[] => {
    const tags: string[] = [];
    if (img.status === 'failed') tags.push('실패 이미지');
    if (img.bundleRequirement === 'both-items') {
        tags.push('조합 제품 모두 보임');
        tags.push('색상/구성 유지');
        tags.push('비슷한 구도');
    }
    if (img.bundleRequirement === 'before-no-current-product') {
        tags.push('현재 제품 미노출');
        tags.push('기존/타사/불편 상황');
    }
    if (img.shotType && !isModelShot(img.shotType)) tags.push('제품컷 확인 필요');
    if (img.shotType && isModelShot(img.shotType)) tags.push('모델컷');
    if (img.shotType && !isModelShot(img.shotType)) tags.push('사람 없음');
    if (img.shotType === 'detail' || img.shotType === 'texture' || img.shotType === 'product' || img.shotType === 'cta') {
        tags.push('프린팅/로고/색상 유지');
    }
    if (/black|블랙|검정|검은색|화이트|흰색|white|charcoal|차콜/i.test(img.visualPrompt)) tags.push('색상 확인 필요');
    if (/male model only|female model only|남성|여성|men|women/i.test(img.visualPrompt)) tags.push('모델 성별 확인 필요');
    tags.push('제품 가림 확인 필요');
    if ((img.qualityWarnings || []).length > 0) tags.push('기획 경고');
    if ((img.visionWarnings || []).length > 0) tags.push('비전 QA 경고');
    return Array.from(new Set(tags));
};

// ────────────────────────────── 이미지 프롬프트 빌더 ──────────────────────────────
// GPT Image는 제품/모델/배경만 생성하고, 한글 카피는 canvas에서 별도로 합성한다.
const buildImagePrompt = (
    img: GenImage,
    combinationType: CombinationType,
    productName: string,
    colorLock: ProductColorLock,
    genderLock: ProductVisualGenderLock,
    textRenderMode: TextRenderMode,
    visualLock?: ProductVisualLock | null,
    masterReferenceType?: 'hook-model' | 'product-detail',
    design?: { tone?: string; colors?: Record<string, string> },
    referenceImageCount = 0
): string => {
    const tone = design?.tone || 'premium';
    const colors = design?.colors || {};
    const colorHint = colors.primary
        ? `Brand colors — primary ${colors.primary}, accent ${colors.accent || colors.primary}, text ${colors.text || '#1a1a1a'}, background ${colors.background || '#ffffff'}.`
        : '';
    const posKo = img.textPosition === 'top' ? '상단' : img.textPosition === 'middle' ? '중앙' : '하단';
    const exactMainCopy = normalizeOverlayCopy(img.mainCopy);
    const problemContrast = isProblemContrastSection(img);
    const textInstruction = [
            '- SAFE CANVAS TEXT MODE: the app will overlay all Korean copy later in browser canvas.',
            '- Generate a clean visual background only. DO NOT render any new text inside the image.',
            '- NO Korean text, NO English text, NO letters, NO numbers, NO captions, NO headline, NO slogan, NO price, NO sale badge, NO labels, NO stickers, NO watermark, NO UI text, NO poster text, NO signage, NO book/newspaper/magazine text, NO package label text added by the model.',
            '- Leave the copy-safe area blank and clean for later canvas typography.',
            '- Exception: preserve only the exact logo/print/lettering that already exists on the uploaded reference product itself. Do not invent, rewrite, translate, simplify, or add new product lettering.',
    ].join('\n');
    const combinationCount = getCombinationCount(combinationType);
    const isBundle = combinationCount >= 2;
    const isBundleTogetherSection = isBundle
        && (
            img.bundleRequirement === 'both-items' ||
            img.number === 1 ||
            img.role.includes('특장점') ||
            img.layoutPreset === 'cta' ||
            img.shotType === 'lifestyle' ||
            img.shotType === 'cta'
        );
    const visibleItemCount = Math.min(combinationCount, Math.max(1, referenceImageCount || combinationCount));
    const bundle = isBundle
        ? [
            '',
            `${combinationCount}-ITEM BUNDLE COMPOSITION LOCK:`,
            `- This product is sold as a ${combinationCount}-item bundle. The visual must communicate a ${combinationCount}-item set, not a single item.`,
            referenceImageCount >= 2
                ? [
                    `- Uploaded images are separate bundle item references. When this section asks for bundle composition, show all available reference items together, up to ${visibleItemCount} visible items. Preserve each item independently.`,
                    '- COLOR / PRINT LOCK: If reference products have different colors, prints, logos, patterns, or designs, preserve ALL differences visibly and exactly. Do not invent a new colorway, do not average colors, do not recolor black/white/gray/navy/beige items, and do not turn a printed item into a plain item.',
                    `- Minimum visible requirement for bundle sections: at least ${Math.min(combinationCount, referenceImageCount)} distinct product items are visible, each corresponding to an uploaded reference when available.`,
                ].join('\n')
                : `- Show ${combinationCount} units of the same reference product together when only one product reference is available.`,
            '- Do not merge bundle items into one, do not ignore uploaded reference products, and do not replace a referenced item with a generic duplicate.',
            isBundleTogetherSection
                ? `- For this section, show exactly ${combinationCount} product items clearly in one premium detail-page composition. Do not show fewer than ${combinationCount} items.`
                : `- Even when this section focuses on one detail, keep the copy/visual direction consistent with a ${combinationCount}-item set offer.`,
            img.number === 1 && img.shotType === 'model'
                ? [
                    `- Hook intro must be a model/hero scene where exactly ${combinationCount} product items are visible. If this is a 3-item bundle, show 3 product items; if 4-item, show 4 product items; continue matching the selected bundle count.`,
                    '- Hook composition priority: every product item must be clearly inspectable as its own product. Do not show one worn item with the remaining items merely draped over an arm, held as folded fabric, hidden behind the model, stacked, cropped, or partially covered.',
                    combinationCount <= 4
                        ? `- For apparel bundles with ${combinationCount} items, use exactly ${combinationCount} parallel models, and each model wears exactly one different reference product. Example: a 3-item apparel bundle must show 3 models wearing 3 different products; a 4-item apparel bundle must show 4 models wearing 4 different products.`
                        : `- For apparel bundles with ${combinationCount} items, use a premium front-facing product lineup or grouped model/product composition where all ${combinationCount} garments are visible without crowding.`,
                    '- Each garment must show its full front shape, color, print/logo/pattern, and silhouette clearly. Do not use folded clothing, hanger-only thumbnails, tiny background items, or products hidden in hands.',
                    '- Bundle items must look visually similar as one coordinated set/lineup: same camera angle, same scale, same lighting, same background, matching styling, and similar pose/usage. Only the true reference differences such as color, print, logo, or pattern may differ.',
                    '- Do not make one product dominant and another tiny, hidden, folded, overlapped, or visually unrelated. Visible bundle items must have balanced visual weight and comparable size.',
                ].join('\n')
                : '',
            img.shotType && !isModelShot(img.shotType) && isBundleTogetherSection
                ? `- Product-only bundle section: no person, but arrange all ${combinationCount} bundle products together with premium set design, hierarchy, shadows, and props.`
                : '',
        ].filter(Boolean).join('\n')
        : '';
    const problemContrastGuide = problemContrast || img.bundleRequirement === 'before-no-current-product'
        ? [
            '',
            'PROBLEM / BEFORE SCENE LOCK:',
            '- This section must NOT show the uploaded selling product or bundle items.',
            '- Create a generic old/competing/inferior alternative product or uncomfortable before-use situation instead.',
            '- The purpose is contrast: "customers used to experience this problem, but the new product solves it later."',
            '- Do not preserve any uploaded reference product here. Do not show the exact reference product color, print, logo, silhouette, or bundle composition in this problem scene.',
        ].join('\n')
        : '';
    const shotType = img.shotType || 'product';
    const shotGuide = getShotTypeGuide(shotType, genderLock);
    const designerSetGuide = getDesignerSetGuide(shotType);
    const identityInstruction = [
        'REFERENCE PRODUCT IDENTITY LOCK:',
        '- Input image roles: Image 1..N are original product references. Additional inputs may include an approved Hook model master or product detail master.',
        '- Use the original product references as the source of truth. Use approved master references only for pose, staging consistency, and product continuity.',
        '- Preserve the exact silhouette, garment type, cut, neckline/collar, sleeve length, fit, material texture, seams, trims, hardware, logo/print/pattern placement, and visible product details.',
        '- Do NOT convert the product into a different item, different colorway, blank version, simplified version, new print, or generic clothing.',
        '- If a model is used, the model changes but the product worn/held must remain the same as the reference product.',
        visualLock?.mustPreserve?.length ? `- MUST PRESERVE: ${visualLock.mustPreserve.join(', ')}.` : '',
        visualLock?.forbiddenChanges?.length ? `- FORBIDDEN CHANGES: ${visualLock.forbiddenChanges.join(', ')}.` : '',
    ].join('\n');
    const masterGuide = masterReferenceType
        ? `\nAPPROVED MASTER REFERENCE: Follow the ${masterReferenceType === 'hook-model' ? 'Hook model master' : 'product detail master'} for product continuity, but create a fresh section image matching this section role.`
        : '';

    return `Create ONE polished Korean e-commerce detail-page image (vertical 860x1000 / 4:5 layout) for the product "${productName}".
photorealistic, commercial product photography, premium ecommerce detail page, natural lighting, ultra realistic texture, high-end advertising, clean layout, professional typography area, Korean ecommerce style, smartstore optimized, 860px width composition, high conversion design, premium visual merchandising, realistic shadows, luxury branding.
This must look like a TOP 1% Korean smartstore/Coupang detail page section: a real photo studio shoot art-directed by a professional commercial photographer — not an AI collage, not a stock photo, not a marketplace listing thumbnail.

SECTION ROLE: ${img.role}${img.stage ? ` (구매 심리 단계: ${img.stage})` : ''}.
${masterGuide}

DESIGN DIRECTION:
- 톤: ${tone}. 잡지 화보처럼 정돈된 미니멀 프리미엄 레이아웃. ONE clear focal subject, generous calm negative space (roughly 30-40% of the frame), no visual clutter, high conversion design, premium visual hierarchy. ${colorHint}
- IMPORTANT: leave a clean copy-safe negative-space area in the ${posKo} region. ${buildCopySafeInstruction(img.textPosition)} The app will overlay Korean typography later.
- Keep all important product details, model faces, hands, logos, prints, and functional parts OUTSIDE the copy-safe text zone.
- Do NOT create a separate white header/footer band, frame, box, panel, or split-screen. Keep one continuous premium background.
- Do NOT use props or backgrounds that naturally introduce readable text, such as posters, signs, price tags, books, magazines, newspapers, labels, menus, UI screens, or packages with new readable writing.
- Korean smartstore optimized, photorealistic commercial product photography, high-end advertising, natural lighting, ultra realistic texture, realistic shadows, premium visual merchandising, luxury branding, magazine-grade editorial quality.
- Layout preset: ${img.layoutPreset || 'detail'}. ${getLayoutVisualGuide(img.layoutPreset)}
- ${shotGuide}
- ${designerSetGuide}
- Avoid plain white background, isolated catalog cutout, blank studio sweep, centered product-only listing photo, or ecommerce marketplace basic product image unless the user explicitly asks for that.
- Use a complete designer-made detail-page section: layered composition, background texture/color, product scale hierarchy, realistic shadow, premium lighting, and tasteful category-relevant styling.
- Visual diversity rule: make this section clearly different from adjacent sections in camera angle, background depth, pose, crop, and product emphasis. Avoid repeating the same model pose, same room, same close-up type, or same centered product composition.
- Minimal-clutter rule: at most 1-2 tasteful category-relevant props, one background concept, one dominant subject. The scene must feel calm, airy, and expensive — never busy, cramped, cluttered, or collage-like. When in doubt, remove elements instead of adding them.
- PHOTOGRAPHIC REALISM (critical for quality): shoot-like depth of field with a natural focus falloff, soft directional key light with a gentle fill, true-to-life color grading, accurate contact shadows where objects meet surfaces, subtle surface imperfections and real material grain. Skin, fabric weave, metal, glass, and plastic must each read as their real material.
- Composition craft: intentional framing using the rule of thirds or a clean centered hero, believable perspective and eye level, consistent single light direction across the whole frame, and a background that recedes naturally behind the subject.
- FORBIDDEN (these make it look cheap/AI-made): plastic-looking oversmoothed skin, waxy or melted product edges, warped/duplicated hands or fingers, floating objects without shadows, mismatched light directions, over-saturated HDR glow, heavy vignettes, fake bokeh circles, visible collage seams, repeated pattern artifacts, or a subject pasted onto an unrelated background.

${problemContrast || img.bundleRequirement === 'before-no-current-product' ? problemContrastGuide : identityInstruction}
${bundle}

PRODUCT VISUAL: ${img.visualPrompt}

STRICT:
${textInstruction}
- ${problemContrast ? 'For this before/problem scene, use a generic alternative product/situation and avoid showing the exact uploaded product.' : buildColorLockInstruction(colorLock)}
- ${problemContrast ? 'Do not copy the current product surface, logo, print, pattern, or bundle colors in this problem scene.' : buildSurfaceLockInstruction(visualLock?.surfaceLock || detectProductSurfaceLock(`${productName} ${img.visualPrompt}`))}
- ${problemContrast ? 'Ignore uploaded product identity for this problem scene only; the section should look like the old/inferior alternative.' : 'Ignore any color, print, pattern, product-type, or model-gender wording inside PRODUCT VISUAL if it conflicts with the uploaded reference product or the locks above.'}
- If SHOT TYPE says no model/no person/product only, do not generate any human, face, body, hand, mannequin, or wearing shot.
- 안전모드에서는 이미지 안에 새 문구, 광고 카피, 숫자, 라벨, 배지, 워터마크를 절대 만들지 말 것. 상품 레퍼런스에 원래 있던 프린팅/로고/글자만 보존할 것.
- ${problemContrast ? '현재 판매 제품이 아니라 기존/타사/불편한 대안 제품처럼 보이게 만들 것.' : '레퍼런스 이미지의 제품 색상·로고·프린트·디테일을 정확히 보존할 것. 제품이 블랙이면 모든 상세페이지 컷에서 블랙 제품으로만, 화이트면 화이트 제품으로만 유지할 것.'}
- 레퍼런스에 사람이 있으면 완전히 새로운 가상의 한국인 모델(다른 얼굴)로 교체하고 배경도 새로 구성할 것.
- 얼굴, 머리, 손, 제품 핵심 디테일이 ${posKo} 카피 영역에 가려지지 않게 배치할 것.`;
};

// ────────────────────────────── Canvas 텍스트 합성 ──────────────────────────────
const TARGET_WIDTH = 860;
const TARGET_HEIGHT = 1000;
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

const normalizeOverlayCopy = (value: string): string => (
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

const getContrastStroke = (hexColor: string): string => {
    const h = hexColor.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? 'rgba(15, 23, 42, 0.32)' : 'rgba(255, 255, 255, 0.78)';
};

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

const drawBackdrop = (
    ctx: CanvasRenderingContext2D,
    position: 'top' | 'middle' | 'bottom',
    centerY: number,
    height: number,
    textColor: string
) => {
    const padding = Math.max(72, height * 0.6);
    const top = Math.max(0, centerY - height / 2 - padding);
    const bottom = Math.min(TARGET_HEIGHT, centerY + height / 2 + padding);
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    const textIsLight = getColorLuminance(textColor) > 0.68;
    const solid = textIsLight ? 'rgba(15, 23, 42, 0.62)' : 'rgba(255, 255, 255, 0.74)';
    const transparent = textIsLight ? 'rgba(15, 23, 42, 0)' : 'rgba(255, 255, 255, 0)';

    if (position === 'top') {
        gradient.addColorStop(0, solid);
        gradient.addColorStop(1, transparent);
    } else if (position === 'bottom') {
        gradient.addColorStop(0, transparent);
        gradient.addColorStop(1, solid);
    } else {
        gradient.addColorStop(0, transparent);
        gradient.addColorStop(0.5, solid);
        gradient.addColorStop(1, transparent);
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, top, TARGET_WIDTH, bottom - top);
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

const overlayTextOnImage = async (
    imageUrl: string,
    seg: GenImage,
    design?: { colors?: Record<string, string> }
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

            const imgRatio = img.width / img.height;
            const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;
            let sx = 0;
            let sy = 0;
            let sw = img.width;
            let sh = img.height;
            if (imgRatio > targetRatio) {
                sw = img.height * targetRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / targetRatio;
                sy = (img.height - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

            // 미니멀 타이포그래피: 판·칩·필 없이 악센트 라인 + 텍스트만 (문구 최소화)
            const headline = buildHeadlineLayout(ctx, formatMainCopy(seg.mainCopy), seg.textPosition);
            const subCopy = normalizeOverlayCopy(seg.subCopy);
            const subFont = 25;
            const subHeight = subCopy ? 38 : 0;
            const accentHeight = 20;
            const headlineHeight = headline.lines.length * headline.lineHeight;
            const blockHeight = accentHeight + headlineHeight + subHeight + 8;

            // 안전 여백 안에서만 배치되도록 클램프 (글자 잘림 방지)
            const SAFE_MARGIN = 56;
            const minCenter = SAFE_MARGIN + blockHeight / 2;
            const maxCenter = TARGET_HEIGHT - SAFE_MARGIN - blockHeight / 2;
            const desiredCenter = seg.textPosition === 'top'
                ? blockHeight / 2 + 64
                : seg.textPosition === 'middle'
                    ? TARGET_HEIGHT / 2
                    : TARGET_HEIGHT - blockHeight / 2 - 72;
            const centerY = maxCenter < minCenter
                ? TARGET_HEIGHT / 2
                : Math.min(maxCenter, Math.max(minCenter, desiredCenter));

            // 배경 밝기를 실제로 측정해 글자색을 자동 선택 (어두운 배경엔 흰 글씨)
            const blockTop = centerY - blockHeight / 2;
            const bg = sampleRegionBrightness(ctx, blockTop, blockHeight);
            const useLightText = bg.luminance < 0.55;
            const textColor = useLightText ? '#ffffff' : resolveDarkTextColor(design);
            const accentColor = useLightText ? '#ffffff' : getAccentColor(design);

            // 배경이 밝기 편차가 큰(복잡한) 구간이면 아주 옅은 스크림만 깔아 가독성 확보
            if (bg.variance > 0.055) {
                drawSoftScrim(ctx, blockTop, blockHeight, useLightText);
            }

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
                wrapText(ctx, subCopy, TARGET_WIDTH - 180, 1).forEach((line) => {
                    ctx.fillText(line, TARGET_WIDTH / 2, y);
                });
                ctx.globalAlpha = 1;
            }
            ctx.shadowBlur = 0;

            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(imageUrl);
        img.src = imageUrl;
    });
};

// ────────────────────────────── 타입 ──────────────────────────────
interface GenImage {
    id: string;
    number: number;
    role: string;
    stage: string;
    sectionType: string;
    shotType?: ShotType;
    mainCopy: string;
    subCopy: string;
    purpose?: string;
    trustElement: string;
    designLayout?: string;
    trigger: string;
    textPosition: 'top' | 'middle' | 'bottom';
    visualPrompt: string;
    imageUrl: string;
    rawImageUrl?: string;
    isGenerating: boolean;
    status: ImageStatus;
    errorMessage?: string;
    qualityWarnings?: string[];
    qaTags?: string[];
    layoutPreset?: LayoutPreset;
    textRenderMode?: TextRenderMode;
    sourceImageIndexes?: number[];
    variantUrls?: string[];
    selectedVariantIndex?: number;
    visualLockWarnings?: string[];
    visionWarnings?: string[];
    visionSummary?: string;
    visionRegenerationHint?: string;
    qaChecked?: boolean;
    priority?: number;
    bundleRequirement?: BundleRequirement;
    regenerationHint?: string;
    previousImageUrl?: string;
    provider?: 'openai' | 'gemini';
    model?: string;
}

interface InputInfo {
    name: string;
    category: string;
    description: string;
    target: string;
    designTone: ToneKey;
    combinationType: CombinationType;
}

const briefToEditableText = (brief: ProductBrief | null): string => {
    if (!brief) return '';
    return [
        `[핵심특징]\n${brief.coreFeatures.join('\n')}`,
        `[제품정체성]\n${brief.productIdentity}`,
        `[보존요소]\n${brief.visualMustKeep.join('\n')}`,
        `[타겟무드]\n${brief.targetMood}`,
        `[Hook방향]\n${brief.heroDirection}`,
    ].join('\n\n');
};

const editableTextToBrief = (value: string, fallback: ProductBrief | null): ProductBrief => {
    const getBlock = (label: string): string[] => {
        const match = new RegExp(`\\[${label}\\]([\\s\\S]*?)(?=\\n\\n\\[|$)`).exec(value);
        return (match?.[1] || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    };
    const coreFeatures = getBlock('핵심특징');
    const productIdentity = getBlock('제품정체성').join(' ');
    const visualMustKeep = getBlock('보존요소');
    const targetMood = getBlock('타겟무드').join(' ');
    const heroDirection = getBlock('Hook방향').join(' ');
    return {
        coreFeatures: coreFeatures.length > 0 ? coreFeatures.slice(0, 5) : fallback?.coreFeatures || ['제품 핵심 장점', '실사용 만족', '디테일 완성도'],
        productIdentity: productIdentity || fallback?.productIdentity || '레퍼런스 제품의 색상, 형태, 소재, 프린팅을 보존',
        visualMustKeep: visualMustKeep.length > 0 ? visualMustKeep.slice(0, 6) : fallback?.visualMustKeep || ['색상 유지', '프린팅/로고 보존', '핏과 형태 유지'],
        targetMood: targetMood || fallback?.targetMood || '프리미엄 상세페이지 무드',
        heroDirection: heroDirection || fallback?.heroDirection || '첫 장은 제품 착용/사용 모델컷으로 강한 첫인상 연출',
    };
};

const createGenImagesFromPlan = (result: DetailPlan, combinationType: CombinationType): GenImage[] => {
    const total = result.images.length;
    const baseImages: GenImage[] = result.images.map((img, i) => {
        const layoutPreset = resolveLayoutPreset(img.sectionType, img.role, i, total);
        const shotType = resolveShotType(img.sectionType, img.role, layoutPreset, i, total, img.shotType);
        const main = sanitizeCopy(formatMainCopy(img.mainCopy));
        const sub = sanitizeCopy(img.subCopy);
        const textPosition = img.textPosition || getDefaultTextPosition(layoutPreset, i);

        return {
            id: `img-${Date.now()}-${i}`,
            number: img.number,
            role: img.role,
            stage: img.stage,
            sectionType: img.sectionType,
            shotType,
            mainCopy: formatMainCopy(main.text),
            subCopy: sub.text,
            purpose: img.purpose,
            trustElement: img.trustElement,
            designLayout: img.designLayout,
            trigger: img.trigger,
            textPosition,
            visualPrompt: img.visualPrompt,
            imageUrl: '',
            rawImageUrl: '',
            isGenerating: false,
            status: 'idle',
            errorMessage: '',
            layoutPreset,
            textRenderMode: 'canvas',
            qaTags: [],
            qualityWarnings: [...main.warnings, ...sub.warnings],
            priority: 0,
            bundleRequirement: resolveBundleRequirement({ number: img.number, role: img.role, layoutPreset, sectionType: img.sectionType, shotType }, combinationType),
        };
    });

    const mainCopies = baseImages.map(img => normalizeOverlayCopy(img.mainCopy));
    return baseImages.map((img, index) => ({
        ...img,
        priority: getImageGenerationPriority(img),
        qualityWarnings: [
            ...(img.qualityWarnings || []),
            ...inspectImageQuality(img, mainCopies, index, total),
        ],
    })).map(img => ({ ...img, qaTags: getImageQaTags(img) }));
};

const STATUS_LABEL: Record<ImageStatus, string> = {
    idle: '대기',
    queued: '생성 예약',
    generating: '생성 중',
    done: '완료',
    failed: '실패',
    retrying: '재시도 중',
};

const STATUS_CLASS: Record<ImageStatus, string> = {
    idle: 'border-line bg-paper-2 text-ink-3',
    queued: 'border-line bg-paper-2 text-ink-2',
    generating: 'border-accent/35 bg-accent-soft text-accent',
    done: 'border-positive/35 bg-positive-soft text-positive',
    failed: 'border-critical/35 bg-critical-soft text-critical',
    retrying: 'border-caution/35 bg-caution-soft text-caution',
};

const getImageGenerationPriority = (img: GenImage): number => {
    const role = `${img.role} ${img.sectionType} ${img.shotType || ''}`.toLowerCase();
    if (img.number === 1 || role.includes('hook') || img.layoutPreset === 'hero') return 10;
    if (role.includes('특장점') || role.includes('proof') || role.includes('solution')) return 9;
    if (img.layoutPreset === 'cta' || role.includes('cta')) return 8;
    if (img.shotType === 'detail' || img.shotType === 'texture') return 7;
    if (img.shotType === 'product') return 6;
    if (img.shotType === 'lifestyle') return 4;
    return 5;
};

const sortImagesByGenerationPriority = (images: GenImage[]): GenImage[] => (
    [...images].sort((a, b) => {
        const priorityGap = (b.priority ?? getImageGenerationPriority(b)) - (a.priority ?? getImageGenerationPriority(a));
        return priorityGap || a.number - b.number;
    })
);

const getImageFailureMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/429|rate|limit|한도|quota/i.test(message)) return '사용량 한도 또는 요청 제한으로 실패했습니다. 잠시 후 실패분 재시도를 눌러주세요.';
    if (/model|모델|unsupported|허용되지/i.test(message)) return '선택한 이미지 모델에서 생성에 실패했습니다. 관리자 이미지 모델 설정을 확인해주세요.';
    if (/reference|image|이미지|file|payload|레퍼런스/i.test(message)) return '레퍼런스 이미지 처리 중 문제가 발생했습니다. 이미지 수나 파일 형식을 확인해주세요.';
    if (/empty|응답|데이터|undefined|비어/i.test(message)) return '이미지 응답이 비어 있습니다. 같은 컷을 다시 생성해주세요.';
    return '예상치 못한 오류로 생성에 실패했습니다. 다시 생성해보세요.';
};

// ────────────────────────────── 컴포넌트 ──────────────────────────────
export const DetailPlanner: React.FC = () => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
    const [info, setInfo] = useState<InputInfo>({
        name: '',
        category: '',
        description: '',
        target: '',
        designTone: 'auto',
        combinationType: 'single',
    });
    const [length, setLength] = useState<number | 'auto'>(8);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [referenceProfiles, setReferenceProfiles] = useState<ReferenceProfile[]>([]);
    const [referenceAnalyzing, setReferenceAnalyzing] = useState(false);
    const [plan, setPlan] = useState<DetailPlan | null>(null);
    const [images, setImages] = useState<GenImage[]>([]);
    const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
    const textRenderMode: TextRenderMode = 'canvas';
    const [imageFilter, setImageFilter] = useState<ImageFilter>('all');
    const [productBrief, setProductBrief] = useState<ProductBrief | null>(null);
    const [briefText, setBriefText] = useState('');
    const [productVisualLock, setProductVisualLock] = useState<ProductVisualLock | null>(null);
    const [masterReferences, setMasterReferences] = useState<MasterReferences>({});
    const [masterGenerating, setMasterGenerating] = useState(false);
    const [useHybridReferences, setUseHybridReferences] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── 이미지 업로드 ──
    const handleFiles = (files: FileList | null) => {
        if (!files) return;
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                setReferenceProfiles([]);
                setReferenceImages(prev => [...prev, reader.result as string]);
            };
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    };
    const removeImage = (idx: number) => {
        setReferenceProfiles([]);
        setReferenceImages(prev => prev.filter((_, i) => i !== idx));
    };

    // ── STEP 1 → 기획안 생성 ──
    const handleGeneratePlan = async () => {
        if (!info.name.trim()) {
            alert('상품명을 입력해주세요.');
            return;
        }
        if (referenceImages.length < 1) {
            alert('실제 제품 사진을 최소 1장 이상 업로드해주세요.');
            return;
        }
        setLoading(true);
        try {
            const profiles = await analyzeReferenceImages();
            const profileText = profiles.map(profile => profile.preserveProfile || profile.summary).filter(Boolean).join('\n');
            const brief = editableTextToBrief(briefText, productBrief || await generateProductBrief(info));
            const enrichedBrief: ProductBrief = {
                ...brief,
                visualMustKeep: [
                    ...brief.visualMustKeep,
                    ...profiles.map(profile => profile.preserveProfile || profile.summary).filter(Boolean),
                ].slice(0, 8),
            };
            setProductBrief(enrichedBrief);
            setBriefText(briefToEditableText(enrichedBrief));
            const visualLock = getVisualLockWithReferenceProfiles(buildProductVisualLock(info, enrichedBrief, briefToEditableText(enrichedBrief), productVisualLock));
            setProductVisualLock(visualLock);
            const result = await generateDetailPlan({
                ...info,
                length,
                productBrief: enrichedBrief,
                description: [info.description, profileText ? `레퍼런스 분석:\n${profileText}` : ''].filter(Boolean).join('\n\n'),
            });
            if (!result || !result.images?.length) {
                alert('기획안 생성에 실패했습니다. 다시 시도해주세요.');
                return;
            }
            setPlan(result);
            const plannedImages = createGenImagesFromPlan(result, info.combinationType).map(img => ({ ...img, textRenderMode }));
            const mainCopies = plannedImages.map(img => normalizeOverlayCopy(img.mainCopy));
            setImages(plannedImages.map((img, index) => {
                const next = {
                    ...img,
                    qualityWarnings: inspectImageQuality(img, mainCopies, index, plannedImages.length),
                };
                return { ...next, qaTags: getImageQaTags(next) };
            }));
            setStep(2);
        } catch (e) {
            console.error(e);
            alert('기획안 생성 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateBrief = async () => {
        if (!info.name.trim()) {
            alert('상품명을 입력해주세요.');
            return;
        }
        setLoading(true);
        try {
            const brief = await generateProductBrief(info);
            setProductBrief(brief);
            setBriefText(briefToEditableText(brief));
            setProductVisualLock(buildProductVisualLock(info, brief, briefToEditableText(brief), productVisualLock));
        } catch (error) {
            console.error(error);
            alert('핵심특징 생성 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const updateImage = (id: string, patch: Partial<GenImage>) => {
        setImages(prev => {
            const patched = prev.map(img => img.id === id ? { ...img, ...patch } : img);
            const mainCopies = patched.map(img => normalizeOverlayCopy(img.mainCopy));
            return patched.map((img, index) => {
                const next = {
                    ...img,
                    qualityWarnings: inspectImageQuality(img, mainCopies, index, patched.length),
                };
                return { ...next, qaTags: getImageQaTags(next) };
            });
        });
    };



    const handleTidyCopy = (id?: string) => {
        setImages(prev => {
            const patched = prev.map(img => id && img.id !== id ? img : { ...img, ...tidyImageCopy(img) });
            const mainCopies = patched.map(img => normalizeOverlayCopy(img.mainCopy));
            return patched.map((img, index) => {
                const next = {
                    ...img,
                    qualityWarnings: inspectImageQuality(img, mainCopies, index, patched.length),
                };
                return { ...next, qaTags: getImageQaTags(next) };
            });
        });
    };

    const scrollToImage = (id: string) => {
        document.getElementById(`detail-image-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const getActiveVisualLock = (): ProductVisualLock => (
        productVisualLock || buildProductVisualLock(info, productBrief, briefText, productVisualLock)
    );

    const getReferenceProfileText = (): string => (
        referenceProfiles
            .map(profile => [
                `Reference ${profile.index + 1}: ${profile.preserveProfile || profile.summary}`,
                profile.detectedColors.length ? `colors=${profile.detectedColors.join(', ')}` : '',
                profile.detectedSurface ? `surface=${profile.detectedSurface}` : '',
            ].filter(Boolean).join(' / '))
            .join('\n')
    );

    const getVisualLockWithReferenceProfiles = (baseLock = getActiveVisualLock()): ProductVisualLock => {
        const profileText = getReferenceProfileText();
        if (!profileText) return baseLock;
        return {
            ...baseLock,
            surfaceLock: referenceProfiles.some(profile => profile.detectedSurface === 'printed')
                ? 'printed'
                : baseLock.surfaceLock,
            mustPreserve: [
                ...baseLock.mustPreserve,
                ...referenceProfiles.map(profile => profile.preserveProfile || profile.summary).filter(Boolean),
            ].slice(0, 10),
            forbiddenChanges: [
                ...baseLock.forbiddenChanges,
                'Do not deviate from the analyzed reference preservation profiles.',
            ],
        };
    };

    const analyzeReferenceImages = async (): Promise<ReferenceProfile[]> => {
        if (referenceImages.length === 0) return [];
        if (referenceProfiles.length === referenceImages.length && referenceProfiles.every((profile, idx) => profile.image === referenceImages[idx])) {
            return referenceProfiles;
        }
        setReferenceAnalyzing(true);
        try {
            const profiles = await Promise.all(referenceImages.slice(0, 4).map(async (image, index) => {
                const result = await analyzeImageVision({
                    image,
                    mode: 'reference',
                    productName: info.name,
                    combinationCount: getCombinationCount(info.combinationType),
                });
                return {
                    index,
                    image,
                    summary: result?.summary || `업로드 레퍼런스 ${index + 1}`,
                    preserveProfile: result?.preserveProfile || result?.summary || '',
                    warnings: result?.warnings || [],
                    detectedColors: result?.detectedColors || [],
                    detectedSurface: (result?.detectedSurface || 'unknown') as ProductSurfaceLock,
                    detectedProductCount: result?.detectedProductCount,
                };
            }));
            setReferenceProfiles(profiles);
            return profiles;
        } finally {
            setReferenceAnalyzing(false);
        }
    };

    const buildReferencePayload = (seg: GenImage, masters: MasterReferences) => {
        if (seg.bundleRequirement === 'before-no-current-product' || isProblemContrastSection(seg)) {
            return {
                refs: [] as string[],
                roles: ['Problem/before scene: intentionally no current product reference. Generate a generic old or inferior alternative product/situation.'],
            };
        }
        const bundleRefLimit = isBundleCombination(info.combinationType)
            ? Math.min(referenceImages.length, getCombinationCount(info.combinationType))
            : referenceImages.length;
        const refs = referenceImages.slice(0, bundleRefLimit);
        const roles = refs.map((_, idx) => (
            isBundleCombination(info.combinationType)
                ? `Image ${idx + 1}: original uploaded bundle item ${idx + 1} reference - must be preserved as a separate product in the ${getCombinationLabel(info.combinationType)} set`
                : `Image ${idx + 1}: original uploaded product reference`
        ));
        if (seg.shotType === 'model' && masters.hookModel) {
            refs.push(masters.hookModel);
            roles.push(`Image ${refs.length}: approved Hook model master reference`);
        }
        if (seg.shotType !== 'model' && masters.productDetail) {
            refs.push(masters.productDetail);
            roles.push(`Image ${refs.length}: approved product detail master reference`);
        }
        if (seg.shotType === 'model' && masters.productDetail) {
            refs.push(masters.productDetail);
            roles.push(`Image ${refs.length}: approved product detail master reference for product accuracy`);
        }
        return { refs, roles };
    };

    const withImageTimeout = async (task: Promise<GeneratedImageResult | undefined>, timeoutMs: number): Promise<string | undefined> => {
        const result = await Promise.race([
            task,
            new Promise<undefined>((resolve) => {
                window.setTimeout(() => resolve(undefined), timeoutMs);
            }),
        ]);
        return result?.image;
    };

    const generateMasterReferences = async (visualLock: ProductVisualLock): Promise<MasterReferences> => {
        if (masterReferences.hookModel && masterReferences.productDetail) return masterReferences;
        setMasterGenerating(true);
        try {
            const genderForPrompt = getGenderLabel(visualLock.genderLock);
            const commonLock = [
                `Product: ${info.name}.`,
                `Gender lock for model cuts: ${genderForPrompt}.`,
                `Hero direction: ${visualLock.heroModelDirection}.`,
                `Must preserve: ${visualLock.mustPreserve.join(', ')}.`,
                `Forbidden: ${visualLock.forbiddenChanges.join(', ')}.`,
                buildColorLockInstruction(visualLock.colorLock),
                buildSurfaceLockInstruction(visualLock.surfaceLock),
                'NO Korean text, no words, no labels, no watermark.',
            ].join('\n');
            const productPrompt = [
                'Create an approved PRODUCT DETAIL MASTER reference image for later ecommerce detail-page sections.',
                'No model, no person, no hand, no mannequin. Product only.',
                'Make it a premium designer-made product detail/texture scene, not a plain white catalog cutout.',
                'Show the exact product identity clearly: color, silhouette, print/logo/pattern, material texture, trims, and visible details.',
                commonLock,
            ].join('\n');
            const hookPrompt = [
                'Create an approved HOOK MODEL MASTER reference image for the first ecommerce detail-page section.',
                'Use exactly one fictional Korean model naturally wearing or using the exact reference product.',
                buildModelGenderInstruction(visualLock.genderLock),
                'The product must be large, clear, premium, and visually dominant. Strong first impression, editorial Korean ecommerce hero composition.',
                commonLock,
            ].join('\n');
            const productDetail = masterReferences.productDetail || await withImageTimeout(
                generateImage(
                    productPrompt,
                    referenceImages,
                    '9:16',
                    'medium',
                    { referenceRoles: referenceImages.map((_, idx) => `Image ${idx + 1}: original product reference`) }
                ),
                90000
            );
            const hookModel = masterReferences.hookModel || await withImageTimeout(
                generateImage(
                    hookPrompt,
                    [...referenceImages, ...(productDetail ? [productDetail] : [])],
                    '9:16',
                    'medium',
                    {
                        referenceRoles: [
                            ...referenceImages.map((_, idx) => `Image ${idx + 1}: original product reference`),
                            ...(productDetail ? [`Image ${referenceImages.length + 1}: approved product detail master reference`] : []),
                        ],
                    }
                ),
                90000
            );
            const next = {
                productDetail: productDetail || masterReferences.productDetail,
                hookModel: hookModel || masterReferences.hookModel,
            };
            setMasterReferences(next);
            return next;
        } catch (error) {
            console.warn('Master reference generation skipped:', error);
            return masterReferences;
        } finally {
            setMasterGenerating(false);
        }
    };

    // ── 단일 이미지 생성 (기본은 배경 생성 후 한글 카피를 canvas로 선명하게 합성) ──
    const generateOne = async (
        seg: GenImage,
        retry = false,
        runtimeMasters = masterReferences,
        runtimeLock = getActiveVisualLock(),
        bulkGenerate = false
    ) => {
        const requestedTextMode = textRenderMode;
        updateImage(seg.id, {
            isGenerating: true,
            status: retry ? 'retrying' : 'generating',
            errorMessage: '',
            textRenderMode: requestedTextMode,
        });
        try {
            const latest = { ...(images.find(img => img.id === seg.id) || seg), textRenderMode: requestedTextMode };
            const productLockSource = [
                info.name,
                info.category,
                info.description,
                info.target,
                briefText,
                productBrief?.productIdentity || '',
                productBrief?.visualMustKeep?.join(' ') || '',
                runtimeLock.genderLock,
                runtimeLock.inferredGenderReason || '',
                runtimeLock.mustPreserve.join(' '),
                getReferenceProfileText(),
            ].join(' ');
            const colorLock = runtimeLock.colorLock || detectProductColorLock(productLockSource);
            const genderLock = runtimeLock.genderLock || detectModelGenderLock(productLockSource);
            const problemContrast = latest.bundleRequirement === 'before-no-current-product' || isProblemContrastSection(latest);
            const hasMatchingMaster = problemContrast ? false : (latest.shotType === 'model' ? !!runtimeMasters.hookModel : !!runtimeMasters.productDetail);
            const masterReferenceType = hasMatchingMaster
                ? (latest.shotType === 'model' ? 'hook-model' : 'product-detail')
                : undefined;
            const promptSource = latest.regenerationHint
                ? { ...latest, visualPrompt: `${latest.visualPrompt}\n\nREGENERATION CORRECTION: ${latest.regenerationHint}` }
                : latest;
            const prompt = buildImagePrompt(promptSource, info.combinationType, info.name, colorLock, genderLock, requestedTextMode, runtimeLock, masterReferenceType, plan?.designSystem, referenceImages.length);
            const { refs, roles } = buildReferencePayload(latest, runtimeMasters);
            const result = await generateImage(prompt, refs, '9:16', bulkGenerate ? 'medium' : undefined, {
                inputFidelity: 'high',
                variantCount: 1, // 섹션당 이미지 1장만 생성
                referenceRoles: roles,
                pacingMode: 'auto',
                priority: latest.priority ?? getImageGenerationPriority(latest),
            });
            const raw = result?.image;
            if (!raw) {
                updateImage(seg.id, {
                    imageUrl: '',
                    rawImageUrl: '',
                    isGenerating: false,
                    status: 'failed',
                    errorMessage: getImageFailureMessage('empty'),
                });
                return;
            }
            const imageUrl = await overlayTextOnImage(raw, { ...latest, textRenderMode: 'canvas' }, plan?.designSystem);
            const nextPatch: Partial<GenImage> = {
                imageUrl,
                rawImageUrl: raw,
                isGenerating: false,
                status: 'done',
                errorMessage: '',
                textRenderMode: 'canvas',
                provider: result?.provider,
                model: result?.model,
                variantUrls: [],
                previousImageUrl: '',
                regenerationHint: '',
                visionWarnings: [],
                visionSummary: '',
                visionRegenerationHint: '',
                qaChecked: false,
            };
            updateImage(seg.id, nextPatch);
            await runVisionQaForImage({ ...latest, ...nextPatch } as GenImage, imageUrl, raw);
        } catch (error) {
            console.error(error);
            updateImage(seg.id, {
                imageUrl: '',
                isGenerating: false,
                status: 'failed',
                errorMessage: getImageFailureMessage(error),
            });
        }
    };

    const applyTextOnly = async (seg: GenImage) => {
        if (!seg.rawImageUrl) return generateOne(seg);
        updateImage(seg.id, { isGenerating: true, status: 'generating', errorMessage: '' });
        const latest = { ...(images.find(img => img.id === seg.id) || seg), textRenderMode: 'canvas' as TextRenderMode };
        const imageUrl = await overlayTextOnImage(seg.rawImageUrl, latest, plan?.designSystem);
        updateImage(seg.id, { imageUrl, isGenerating: false, status: 'done', textRenderMode: 'canvas' });
    };

    const applyTextPatch = async (seg: GenImage, patch: Partial<Pick<GenImage, 'mainCopy' | 'subCopy'>>) => {
        const latest = {
            ...(images.find(img => img.id === seg.id) || seg),
            ...patch,
            textRenderMode: 'canvas' as TextRenderMode,
        };
        if (!seg.rawImageUrl) {
            updateImage(seg.id, latest);
            return;
        }
        updateImage(seg.id, { ...patch, isGenerating: true, status: 'generating', errorMessage: '', textRenderMode: 'canvas' });
        const imageUrl = await overlayTextOnImage(seg.rawImageUrl, latest, plan?.designSystem);
        updateImage(seg.id, { ...patch, imageUrl, isGenerating: false, status: 'done', textRenderMode: 'canvas' });
    };

    const shouldRunVisionQa = (seg: GenImage): boolean => (
        seg.number === 1 ||
        seg.layoutPreset === 'cta' ||
        seg.bundleRequirement === 'both-items' ||
        seg.bundleRequirement === 'before-no-current-product' ||
        isFeatureBenefitImage(seg) ||
        ['product', 'detail', 'texture', 'cta'].includes(seg.shotType || '')
    );

    const runVisionQaForImage = async (seg: GenImage, imageUrl: string, rawImageUrl?: string) => {
        if (!shouldRunVisionQa(seg)) return;
        const result = await analyzeImageVision({
            image: rawImageUrl || imageUrl,
            referenceImages,
            mode: 'qa',
            productName: info.name,
            sectionRole: seg.role,
            shotType: seg.shotType,
            combinationCount: getCombinationCount(info.combinationType),
            genderLock: getVisualLockWithReferenceProfiles(getActiveVisualLock()).genderLock,
            expectedNoText: true,
            expectedProductOnly: !!seg.shotType && !isModelShot(seg.shotType),
            expectedProblemScene: seg.bundleRequirement === 'before-no-current-product' || isProblemContrastSection(seg),
        });
        if (!result) return;
        updateImage(seg.id, {
            visionWarnings: result.warnings,
            visionSummary: result.summary,
            visionRegenerationHint: result.regenerationHint,
            qaChecked: true,
            regenerationHint: result.warnings.length > 0 ? result.regenerationHint || seg.regenerationHint : seg.regenerationHint,
        });
    };

    const changeTextPosition = async (seg: GenImage, textPosition: 'top' | 'middle' | 'bottom') => {
        const next = { ...seg, textPosition, textRenderMode: 'canvas' as TextRenderMode };
        if (!seg.rawImageUrl) {
            updateImage(seg.id, { textPosition });
            return;
        }
        updateImage(seg.id, { textPosition, isGenerating: true, status: 'generating', errorMessage: '' });
        const imageUrl = await overlayTextOnImage(seg.rawImageUrl, next, plan?.designSystem);
        updateImage(seg.id, { textPosition, imageUrl, isGenerating: false, status: 'done', textRenderMode: 'canvas' });
    };

    const getRegenerationPresets = (seg: GenImage): Array<{ label: string; hint: string }> => {
        const removeTextPreset = { label: '이미지 속 텍스트 제거', hint: 'Remove all newly generated readable text from the image: no Korean, English, letters, numbers, captions, labels, badges, signs, posters, price tags, watermark, or UI text. Preserve only original product logo/print/lettering from the reference product.' };
        if (seg.bundleRequirement === 'both-items' && seg.number === 1) {
            return [
                removeTextPreset,
                { label: '조합 제품 더 비슷하게', hint: `Make all ${getCombinationCount(info.combinationType)} bundle products look more similar as a coordinated set: same scale, same camera angle, same lighting, same background, matching styling, similar model pose, equal visual weight. Preserve only the true reference differences such as color, print, logo, or pattern.` },
                { label: '조합 제품 모두 크게', hint: `Make exactly ${getCombinationCount(info.combinationType)} bundle products large, clear, and equally visible. Do not hide, crop, shrink, or make any item secondary.` },
                { label: '색상 보존 강화', hint: 'Strictly preserve all reference colors and visible differences. If uploaded items have different colors or prints, show each distinct color/print clearly in the bundle composition.' },
            ];
        }
        if (seg.bundleRequirement === 'before-no-current-product' || isProblemContrastSection(seg)) {
            return [
                removeTextPreset,
                { label: '현재 제품 빼고 다시', hint: 'Do not show the uploaded selling product, exact color, print, logo, silhouette, or bundle items. Generate a generic old or competing alternative product instead.' },
                { label: '더 불편한 before 컷', hint: 'Make the before/problem situation more visibly inconvenient, outdated, cluttered, uncomfortable, or inferior, while keeping it realistic and premium enough for an ecommerce detail page.' },
            ];
        }
        if (seg.shotType && !isModelShot(seg.shotType)) {
            return [
                removeTextPreset,
                { label: '모델 제거', hint: 'Remove all people, models, hands, mannequins, faces, and body parts. Product-only scene.' },
                { label: '상세페이지스럽게', hint: 'Make it look less like a plain product listing and more like a professionally designed Korean ecommerce detail-page section with layered set design, depth, props, and premium lighting.' },
                { label: '화이트 배경 줄이기', hint: 'Avoid plain white background or isolated catalog cutout. Use tasteful dimensional background texture/color, shadows, pedestal, and commercial styling.' },
            ];
        }
        return [
            removeTextPreset,
            { label: '제품 더 선명하게', hint: 'Make the product larger, clearer, sharper, and less obstructed while preserving exact reference identity.' },
            { label: '제품 가림 줄이기', hint: 'Move model, hands, props, and text-safe area away from the product so core details are not blocked.' },
        ];
    };

    const regenerateWithPreset = async (seg: GenImage, hint: string) => {
        const latest = { ...(images.find(img => img.id === seg.id) || seg), regenerationHint: hint };
        updateImage(seg.id, { regenerationHint: hint });
        await generateOne(latest, seg.status === 'failed', masterReferences, getActiveVisualLock(), false);
    };

    // ── STEP 2 → 전체 이미지 생성 ──
    const handleGenerateAll = async () => {
        setStep(3);
        const visualLock = getVisualLockWithReferenceProfiles(getActiveVisualLock());
        setProductVisualLock(visualLock);
        const snapshot = images.map(img => ({
            ...img,
            isGenerating: true,
            status: 'queued' as ImageStatus,
            priority: img.priority ?? getImageGenerationPriority(img),
            textRenderMode,
            imageUrl: '',
            rawImageUrl: '',
            errorMessage: '',
        }));
        setImages(snapshot);
        try {
            const masters = useHybridReferences ? await generateMasterReferences(visualLock) : {};
            await Promise.all(sortImagesByGenerationPriority(snapshot).map(seg => generateOne(seg, false, masters, visualLock, true)));
        } catch (error) {
            console.error(error);
            setImages(prev => prev.map(img => ({
                ...img,
                isGenerating: false,
                status: img.imageUrl ? img.status : 'failed',
                errorMessage: img.imageUrl ? img.errorMessage : '이미지 생성 흐름이 중단됐습니다. 다시 시도해주세요.',
            })));
        }
    };

    const handleRetryFailed = async () => {
        const failed = images.filter(img => img.status === 'failed');
        if (failed.length === 0) return;
        const visualLock = getVisualLockWithReferenceProfiles(getActiveVisualLock());
        const masters = useHybridReferences ? await generateMasterReferences(visualLock) : {};
        await Promise.all(sortImagesByGenerationPriority(failed).map(seg => generateOne(seg, true, masters, visualLock, true)));
    };

    const handleRetryVisionWarnings = async () => {
        const warningTargets = images
            .filter(img => img.status === 'done' && (img.visionWarnings?.length || 0) > 0)
            .map(img => ({
                ...img,
                regenerationHint: img.visionRegenerationHint || img.regenerationHint || 'Fix the detected product QA problems while preserving the section role and product identity.',
            }));
        if (warningTargets.length === 0) return;
        const visualLock = getVisualLockWithReferenceProfiles(getActiveVisualLock());
        const masters = useHybridReferences ? await generateMasterReferences(visualLock) : {};
        await Promise.all(sortImagesByGenerationPriority(warningTargets).map(seg => generateOne(seg, true, masters, visualLock, true)));
    };

    const handleDownloadAll = () => {
        if (qaWarnings.length > 0) {
            const ok = window.confirm(`최종 QA 경고가 ${qaWarnings.length}건 있습니다.\n그래도 다운로드할까요?`);
            if (!ok) return;
        }
        images.forEach((seg, idx) => {
            if (!seg.imageUrl) return;
            const a = document.createElement('a');
            a.href = seg.imageUrl;
            a.download = `detail_${String(idx + 1).padStart(2, '0')}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    };

    const generatedCount = images.filter(i => i.status === 'done' && i.imageUrl).length;
    const generatingCount = images.filter(i => i.status === 'queued' || i.status === 'generating' || i.status === 'retrying').length;
    const failedCount = images.filter(i => i.status === 'failed').length;
    const modelShotCount = images.filter(i => isModelShot(i.shotType)).length;
    const maxRecommendedModelShots = images.length >= 8 ? 3 : Math.max(1, Math.ceil(images.length * 0.4));
    const qualityWarningCount = images.reduce((sum, img) => sum + (img.qualityWarnings?.length || 0), 0);
    const visionWarningCount = images.reduce((sum, img) => sum + (img.visionWarnings?.length || 0), 0);
    const warningImageCount = images.filter(i => (i.qualityWarnings?.length || 0) > 0 || (i.qaTags?.length || 0) > 0 || (i.visionWarnings?.length || 0) > 0).length;
    const missingCount = images.filter(i => !i.imageUrl).length;
    const filteredImages = images.filter(img => {
        if (imageFilter === 'failed') return img.status === 'failed';
        if (imageFilter === 'done') return img.status === 'done' && !!img.imageUrl;
        if (imageFilter === 'warning') return (img.qualityWarnings?.length || 0) > 0 || (img.qaTags?.length || 0) > 0 || (img.visionWarnings?.length || 0) > 0;
        return true;
    });
    const qaWarnings = [
        ...(failedCount > 0 ? [`생성 실패 이미지 ${failedCount}장이 있습니다.`] : []),
        ...(missingCount > 0 ? [`아직 완성되지 않은 이미지 ${missingCount}장이 있습니다.`] : []),
        ...(qualityWarningCount > 0 ? [`카피/기획 QA 경고 ${qualityWarningCount}건이 있습니다.`] : []),
        ...(visionWarningCount > 0 ? [`비전 QA 경고 ${visionWarningCount}건이 있습니다.`] : []),
        ...(!images.some(isFeatureBenefitImage) ? ['상품 특장점 전용 이미지가 없습니다. 기획안을 다시 생성하거나 한 장을 특장점 섹션으로 수정하세요.'] : []),
        ...(modelShotCount > maxRecommendedModelShots ? [`모델컷이 ${modelShotCount}장입니다. 권장 최대 ${maxRecommendedModelShots}장보다 많습니다.`] : []),
    ];
    const visualLockSummary = productVisualLock || buildProductVisualLock(info, productBrief, briefText, productVisualLock);

    // ────────────────────────────── 렌더 ──────────────────────────────
    return (
        <div className="mx-auto max-w-[1240px] px-6 py-8">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">상세페이지 제작</p>
                    <h2 className="mt-1.5 text-[26px] font-semibold tracking-tight text-ink">전환 흐름부터 이미지까지</h2>
                    <p className="mt-1.5 text-[13px] text-ink-2">기획, 이미지 생성, 카피 합성을 한 번에 진행합니다.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {[
                        ['구성', getCombinationLabel(info.combinationType)],
                        ['길이', length === 'auto' ? 'Auto' : `${length}장`],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-control border border-line bg-paper px-3 py-2">
                            <span className="text-[11px] text-ink-3">{label}</span>
                            <span className="ml-2 text-[13px] font-semibold text-ink">{value}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* 단계 표시 — 완료한 단계로만 되돌아갈 수 있다 */}
            <div className="mb-7 flex items-stretch overflow-hidden rounded-card border border-line bg-paper">
                {[1, 2, 3].map((s, i) => {
                    const active = step === s;
                    const done = step > s;
                    return (
                        <button
                            key={s}
                            type="button"
                            disabled={!done}
                            onClick={() => { if (done) setStep(s as 1 | 2 | 3); }}
                            aria-current={active ? 'step' : undefined}
                            className={`flex flex-1 items-center gap-2.5 px-4 py-3 text-left transition-colors ${
                                i > 0 ? 'border-l border-line' : ''
                            } ${done ? 'cursor-pointer hover:bg-paper-2' : 'cursor-default'} ${active ? 'bg-paper-2' : ''}`}
                        >
                            <span
                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                                    active ? 'bg-ink text-paper' : done ? 'bg-positive-soft text-positive' : 'bg-line text-ink-3'
                                }`}
                            >
                                {done ? '✓' : s}
                            </span>
                            <span className="min-w-0">
                                <span className={`block truncate text-[13px] ${active || done ? 'font-semibold text-ink' : 'font-medium text-ink-3'}`}>
                                    {s === 1 ? '정보 입력' : s === 2 ? '기획안 확인' : '이미지 생성'}
                                </span>
                                <span className="mt-0.5 hidden truncate text-[11px] text-ink-3 sm:block">
                                    {s === 1 ? '상품·사진' : s === 2 ? '전략·카피' : '생성·다운로드'}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* ───── STEP 1: 정보 입력 ───── */}
            {step === 1 && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="rounded-card border border-line bg-paper">
                        <div className="border-b border-line px-6 py-5">
                            <div className="flex items-center gap-2">
                                <div className="flex h-9 w-9 items-center justify-center rounded-card bg-ink text-paper">
                                    <FileText className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-ink">상품 정보</h3>
                                    <p className="text-xs text-ink-2">기획에 필요한 기본 정보를 입력하세요.</p>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-5 p-6 md:grid-cols-2">
                            <div>
                            <label className="block text-sm font-medium text-ink mb-1">상품명 *</label>
                            <input type="text" value={info.name} onChange={e => setInfo({ ...info, name: e.target.value })} className="w-full p-3 border border-line-strong rounded-card focus:ring-2 focus:ring-accent outline-none" placeholder="예: 무중력 메모리폼 베개" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-ink mb-1">카테고리 <span className="text-ink-3 font-normal">(선택 - 비워두면 자동 추정)</span></label>
                            <input type="text" value={info.category} onChange={e => setInfo({ ...info, category: e.target.value })} className="w-full p-3 border border-line-strong rounded-card focus:ring-2 focus:ring-accent outline-none" placeholder="예: 리빙/침구" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-ink mb-1">상품 설명 <span className="text-ink-3 font-normal">(선택 - 상품 소개/상세 내용 붙여넣기)</span></label>
                            <textarea value={info.description} onChange={e => setInfo({ ...info, description: e.target.value })} rows={3} className="w-full p-3 border border-line-strong rounded-card focus:ring-2 focus:ring-accent outline-none" placeholder="상품 URL의 설명이나 제품 소개글을 붙여넣으면 기획에 반영됩니다." />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-ink mb-1">타겟 고객 <span className="text-ink-3 font-normal">(선택)</span></label>
                            <input type="text" value={info.target} onChange={e => setInfo({ ...info, target: e.target.value })} className="w-full p-3 border border-line-strong rounded-card focus:ring-2 focus:ring-accent outline-none" placeholder="예: 20-30대 직장인 여성" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-ink mb-1">디자인 톤</label>
                            <select value={info.designTone} onChange={e => setInfo({ ...info, designTone: e.target.value as ToneKey })} className="w-full p-3 border border-line-strong rounded-card focus:ring-2 focus:ring-accent outline-none bg-paper">
                                {TONE_OPTIONS.map(t => <option key={t} value={t}>{t === 'auto' ? '자동 선택' : t}</option>)}
                            </select>
                        </div>
                        </div>
                        <div className="border-t border-line p-6">
                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h3 className="font-semibold text-ink">핵심특징 브리프</h3>
                                    <p className="mt-1 text-xs text-ink-2">기획안 생성 전에 AI가 제품의 USP와 보존 요소를 먼저 정리합니다.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleGenerateBrief}
                                    disabled={loading || !info.name.trim()}
                                    className="inline-flex items-center justify-center rounded-card border border-line bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-line-strong hover:bg-paper-2 disabled:bg-paper-2 disabled:text-ink-3"
                                >
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                    핵심특징 먼저 생성
                                </button>
                            </div>
                            <textarea
                                value={briefText}
                                onChange={e => setBriefText(e.target.value)}
                                rows={9}
                                className="w-full rounded-card border border-line-strong p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-accent"
                                placeholder={'비워두면 기획안 생성 시 자동으로 생성됩니다.\n\n[핵심특징]\n제품의 핵심 장점\n\n[제품정체성]\n보존해야 할 제품 정체성\n\n[보존요소]\n색상/프린팅/로고/핏 유지\n\n[타겟무드]\n프리미엄 커머스 무드\n\n[Hook방향]\n첫 장 모델컷 방향'}
                            />
                            <p className="mt-2 text-xs leading-relaxed text-ink-2">
                                수정한 내용은 그대로 기획안에 반영됩니다. 특히 색상, 프린팅, 로고, 남성/여성 타겟 단서를 넣으면 이미지 생성 정확도가 올라갑니다.
                            </p>
                            <div className="mt-4 rounded-card border border-line bg-paper-2 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-ink">Hook 모델 성별</p>
                                        <p className="mt-0.5 text-xs text-ink-2">상품명, 설명, 제품 형태 단서를 기준으로 자동 판정합니다.</p>
                                    </div>
                                    <span className="rounded-full bg-paper px-3 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line">
                                        현재: {getGenderLabel(visualLockSummary.genderLock)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                    {([
                                        { value: 'none' as const, label: '자동' },
                                        { value: 'male' as const, label: '남성' },
                                        { value: 'female' as const, label: '여성' },
                                        { value: 'unisex' as const, label: '공용' },
                                    ]).map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setProductVisualLock({ ...visualLockSummary, genderLock: opt.value, inferredGenderReason: opt.value === 'none' ? '사용자가 자동 판정으로 설정했습니다.' : `사용자가 ${opt.label} 모델 기준으로 설정했습니다.` })}
                                            className={`rounded-control border px-3 py-2 text-xs font-semibold transition-colors ${visualLockSummary.genderLock === opt.value ? 'border-ink bg-ink text-paper' : 'border-line bg-paper text-ink-2 hover:border-line-strong'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-ink-2">{visualLockSummary.inferredGenderReason}</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-card border border-line bg-paper p-6">
                            <div className="mb-4 flex items-center gap-2">
                                <Layers3 className="h-5 w-5 text-ink" />
                                <h3 className="font-semibold text-ink">제작 옵션</h3>
                            </div>
                            <label className="mb-2 block text-sm font-medium text-ink">상품 구성</label>
                            <div className="grid grid-cols-2 gap-1.5 rounded-card bg-paper-2 p-1.5">
                                {COMBINATION_OPTIONS.map(opt => {
                                    const selected = info.combinationType === opt.value;
                                    return (
                                        <button key={opt.value} type="button" onClick={() => setInfo({ ...info, combinationType: opt.value })}
                                            className={`h-10 rounded-control text-xs font-semibold transition-all sm:text-sm ${selected ? 'bg-ink text-paper ' : 'text-ink-2 hover:bg-paper hover:text-ink'}`}>
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <label className="mb-2 mt-5 block text-sm font-medium text-ink">상세페이지 길이</label>
                            <div className="grid grid-cols-4 gap-1.5 rounded-card bg-paper-2 p-1.5">
                                {LENGTH_OPTIONS.map(opt => (
                                    <button key={String(opt.val)} type="button" onClick={() => setLength(opt.val)} className={`h-10 rounded-control text-sm font-semibold transition-all ${length === opt.val ? 'bg-ink text-paper ' : 'text-ink-2 hover:bg-paper hover:text-ink'}`}>
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                        </div>

                        <div className="rounded-card border border-line bg-paper p-6">
                            <div className="mb-4 flex items-center gap-2">
                                <ImageIcon className="h-5 w-5 text-ink" />
                                <h3 className="font-semibold text-ink">레퍼런스 이미지</h3>
                            </div>
                            <div onClick={() => fileInputRef.current?.click()} onDrop={onDrop} onDragOver={e => e.preventDefault()}
                                className="cursor-pointer rounded-card border border-dashed border-line-strong bg-paper-2 p-8 text-center transition-colors hover:border-ink hover:bg-paper">
                                <Upload className="w-8 h-8 mx-auto text-ink-3 mb-2" />
                                <p className="font-medium text-ink">클릭 또는 드래그하여 제품 사진 업로드</p>
                                <p className="text-xs text-ink-3 mt-1">여러 각도(앞/뒤/옆) 사진을 넣으면 더 정확합니다</p>
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
                            {referenceImages.length > 0 && (
                                <div className="mt-4 space-y-3">
                                <div className="flex flex-wrap gap-3">
                                    {referenceImages.map((img, idx) => (
                                        <div key={idx} className="relative w-20 h-20">
                                            <img src={img} alt="" className="w-full h-full object-cover rounded-control border border-line" />
                                            {referenceProfiles[idx] && (
                                                <span className="absolute bottom-1 left-1 rounded-full bg-positive px-1.5 py-0.5 text-[9px] font-semibold text-paper">QA</span>
                                            )}
                                            <button onClick={() => removeImage(idx)} className="absolute -top-2 -right-2 bg-critical text-paper rounded-full p-0.5">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {referenceAnalyzing && (
                                    <div className="flex items-center gap-2 rounded-card border border-accent-line bg-accent-soft px-3 py-2 text-xs font-semibold text-accent">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 레퍼런스 제품 보존 요소 분석 중...
                                    </div>
                                )}
                                {referenceProfiles.length > 0 && (
                                    <div className="rounded-card border border-positive/20 bg-positive-soft p-3 text-xs text-positive">
                                        <p className="mb-1 font-semibold">레퍼런스 분석 반영됨</p>
                                        {referenceProfiles.slice(0, 3).map(profile => (
                                            <p key={profile.index} className="line-clamp-2">• {profile.summary || profile.preserveProfile}</p>
                                        ))}
                                    </div>
                                )}
                                </div>
                            )}
                        </div>

                        <div className="rounded-card border border-line bg-paper p-4">
                        <button onClick={handleGeneratePlan} disabled={loading || referenceImages.length < 1}
                            className="flex w-full items-center justify-center rounded-control bg-ink px-8 py-3 text-[14px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
                            {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {referenceAnalyzing ? '레퍼런스 분석 중...' : '기획안 생성 중...'}</> : <><Wand2 className="w-5 h-5 mr-2" /> 기획안 생성</>}
                        </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ───── STEP 2: 기획안 확인 ───── */}
            {step === 2 && plan && (
                <div className="space-y-6">
                    {/* 전략 분석 */}
                    <div className="rounded-card border border-line bg-paper p-6">
                        <div className="mb-5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <div className="flex h-9 w-9 items-center justify-center rounded-card bg-ink text-paper">
                                    <Palette className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                    <h2 className="text-[17px] font-semibold tracking-tight text-ink">상품·전환 전략 분석</h2>
                                    <p className="text-xs text-ink-2">AI가 도출한 구매 설득 구조입니다.</p>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="rounded-card border border-line bg-paper-2 p-4">
                                <p className="font-semibold text-ink mb-1">제품 정의</p>
                                <p className="text-ink-2 leading-relaxed">{plan.productDefinition}</p>
                                {plan.productReason && (
                                    <p className="mt-2 text-ink-2"><span className="text-ink-3">왜 존재하는가:</span> {plan.productReason}</p>
                                )}
                                {plan.productProblem && (
                                    <p className="mt-1 text-ink-2"><span className="text-ink-3">해결하는 문제:</span> {plan.productProblem}</p>
                                )}
                            </div>
                            <div className="rounded-card border border-line bg-paper-2 p-4">
                                <p className="font-semibold text-ink mb-1">고객 분석</p>
                                <p className="text-ink-2"><span className="text-ink-3">타겟:</span> {plan.customer?.target}</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {([
                                        ['연령', plan.customer?.age],
                                        ['성별', plan.customer?.gender],
                                        ['직업', plan.customer?.job],
                                    ] as const).filter(([, v]) => !!v).map(([k, v]) => (
                                        <span key={k} className="rounded-control bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-line">
                                            {k} {v}
                                        </span>
                                    ))}
                                </div>
                                {plan.customer?.lifestyle && (
                                    <p className="mt-1.5 text-ink-2"><span className="text-ink-3">라이프스타일:</span> {plan.customer.lifestyle}</p>
                                )}
                                {plan.customer?.purchaseSituation && (
                                    <p className="text-ink-2"><span className="text-ink-3">구매 상황:</span> {plan.customer.purchaseSituation}</p>
                                )}
                                <p className="mt-1.5 text-ink-2"><span className="text-ink-3">표면 니즈:</span> {plan.customer?.surfaceNeed}</p>
                                <p className="text-ink-2"><span className="text-accent font-semibold">실제 니즈:</span> {plan.customer?.realNeed}</p>
                            </div>
                            <div className="rounded-card border border-line bg-paper-2 p-4">
                                <p className="font-semibold text-ink mb-1">경쟁 대비 차별점</p>
                                <ul className="list-disc list-inside text-ink-2 space-y-0.5">
                                    {plan.differentiators?.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                            </div>
                            <div className="rounded-card border border-line bg-paper-2 p-4">
                                <p className="font-semibold text-ink mb-1">구매 저항 요소 (해소 대상)</p>
                                <ul className="list-disc list-inside text-ink-2 space-y-0.5">
                                    {plan.purchaseResistances?.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                            </div>
                        </div>
                        {plan.competitorComparison?.length > 0 && (
                            <div className="mt-4 overflow-hidden rounded-card border border-line">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                                            <th className="px-4 py-2 text-left">비교 항목</th>
                                            <th className="px-4 py-2 text-left">경쟁상품</th>
                                            <th className="px-4 py-2 text-left text-accent">본 제품</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {plan.competitorComparison.map((row, i) => (
                                            <tr key={i} className="border-t border-line">
                                                <td className="px-4 py-2 font-semibold text-ink">{row.item}</td>
                                                <td className="px-4 py-2 text-ink-2">{row.competitor}</td>
                                                <td className="px-4 py-2 font-medium text-accent">{row.ours}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {productBrief && (
                            <div className="mt-4 rounded-card border border-accent-line bg-accent-soft p-4 text-sm">
                                <div className="mb-3 flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-accent" />
                                    <p className="font-semibold text-accent">핵심특징 브리프 반영</p>
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div>
                                        <p className="text-xs font-semibold text-accent">핵심특징</p>
                                        <p className="mt-1 text-ink">{productBrief.coreFeatures.join(' · ')}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-accent">제품정체성</p>
                                        <p className="mt-1 text-ink">{productBrief.productIdentity}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-accent">보존요소</p>
                                        <p className="mt-1 text-ink">{productBrief.visualMustKeep.join(' · ')}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold text-accent">Hook 방향</p>
                                        <p className="mt-1 text-ink">{productBrief.heroDirection}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="mt-4 rounded-card border border-line bg-paper p-4 text-sm">
                            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="font-semibold text-ink">제품 락팩</p>
                                    <p className="mt-1 text-xs text-ink-2">색상, 프린팅, Hook 모델 성별을 모든 이미지 생성에 공통 적용합니다.</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {(['none', 'male', 'female', 'unisex'] as ProductVisualGenderLock[]).map(value => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setProductVisualLock({ ...visualLockSummary, genderLock: value, inferredGenderReason: value === 'none' ? '사용자가 자동 판정으로 설정했습니다.' : `사용자가 ${getGenderLabel(value)} 모델 기준으로 설정했습니다.` })}
                                            className={`rounded-control px-3 py-1.5 text-xs font-semibold ${visualLockSummary.genderLock === value ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2 hover:bg-line'}`}
                                        >
                                            {getGenderLabel(value)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <div className="rounded-control bg-paper-2 p-3">
                                    <p className="text-xs font-semibold text-ink-2">Hook 성별</p>
                                    <p className="mt-1 font-semibold text-ink">{getGenderLabel(visualLockSummary.genderLock)}</p>
                                    <p className="mt-1 text-xs text-ink-2">{visualLockSummary.inferredGenderReason}</p>
                                </div>
                                <div className="rounded-control bg-paper-2 p-3">
                                    <p className="text-xs font-semibold text-ink-2">색상/표면</p>
                                    <p className="mt-1 font-semibold text-ink">{visualLockSummary.colorLock} · {visualLockSummary.surfaceLock}</p>
                                </div>
                                <div className="rounded-control bg-paper-2 p-3">
                                    <p className="text-xs font-semibold text-ink-2">보존 요소</p>
                                    <p className="mt-1 text-ink">{visualLockSummary.mustPreserve.slice(0, 3).join(' · ')}</p>
                                </div>
                            </div>
                        </div>
                        {plan.designSystem && (
                            <div className="mt-4 rounded-card border border-line bg-paper-2 p-4">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span className="text-sm font-semibold text-ink">디자인 톤: {plan.designSystem.tone}</span>
                                    {plan.designSystem.colors && Object.entries(plan.designSystem.colors).map(([k, v]) => (
                                        <span key={k} className="flex items-center gap-1.5 text-xs text-ink-2">
                                            <span className="w-5 h-5 rounded border border-line" style={{ background: v as string }} />{k}
                                        </span>
                                    ))}
                                </div>
                                {plan.designSystem.fonts && (
                                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                                        {([
                                            ['헤드라인', plan.designSystem.fonts.headline],
                                            ['본문', plan.designSystem.fonts.body],
                                            ['강조', plan.designSystem.fonts.emphasis],
                                            ['CTA', plan.designSystem.fonts.cta],
                                        ] as const).map(([k, v]) => (
                                            <span key={k} className="rounded-control bg-paper px-2 py-1 text-[11px] text-ink-2 ring-1 ring-line">
                                                <span className="font-semibold text-ink-3">{k}</span> {v}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {plan.isFallback && (
                            <div className="mt-4 rounded-card border border-caution/30 bg-caution-soft p-4 text-sm text-caution">
                                <div className="flex items-center gap-2 font-semibold">
                                    <AlertTriangle className="h-4 w-4" />
                                    기본 기획안으로 자동 복구했습니다
                                </div>
                                <p className="mt-1 text-xs leading-relaxed opacity-85">
                                    {plan.fallbackReason || 'GPT 응답이 불안정해도 작업을 계속할 수 있도록 기본 8장 흐름을 생성했습니다.'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 이미지별 기획 */}
                    <div className="rounded-card border border-line bg-paper p-6">
                        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-[17px] font-semibold tracking-tight text-ink">이미지별 기획안 <span className="font-medium text-ink-3">({images.length}장)</span></h2>
                                <p className="mt-1 text-sm text-ink-2">
                                    카피는 생성된 배경 이미지 위에 선명하게 합성됩니다.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setUseHybridReferences(prev => !prev)}
                                    className={`rounded-card px-4 py-3 text-sm font-semibold transition-colors ${
                                        useHybridReferences
                                            ? 'bg-accent text-paper hover:bg-accent-hover'
                                            : 'bg-paper-2 text-ink-2 hover:bg-line'
                                    }`}
                                >
                                    {useHybridReferences ? '기준컷 사용 중' : '빠른 생성 모드'}
                                </button>
                                <button onClick={() => handleTidyCopy()} className="flex items-center justify-center rounded-control border border-line px-5 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                                    <Sparkles className="w-5 h-5 mr-2" /> 카피 정리
                                </button>
                                <button onClick={handleGenerateAll} className="flex items-center justify-center rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90">
                                    <Wand2 className="w-5 h-5 mr-2" /> 이미지 생성 시작
                                </button>
                            </div>
                        </div>
                        <div className={`mb-5 rounded-card border p-4 text-sm ${qualityWarningCount > 0 ? 'border-caution/30 bg-caution-soft text-caution' : 'border-positive/30 bg-positive-soft text-positive'}`}>
                            <div className="flex items-center gap-2 font-semibold">
                                {qualityWarningCount > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                {qualityWarningCount > 0 ? `기획 QA 경고 ${qualityWarningCount}건` : '기획 QA 통과'}
                            </div>
                            <p className="mt-1 text-xs opacity-80">
                                긴 문구는 자르지 않고 14자 단위로 줄바꿈되며, 기본은 기준컷 없이 빠르게 생성합니다.
                            </p>
                        </div>
                        <div className="space-y-4">
                            {images.map((img) => (
                                <div key={img.id} className="rounded-card border border-line p-4 transition-colors hover:border-line-strong hover:bg-paper-2/50">
                                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                                        <span className="bg-ink text-paper text-xs font-semibold rounded-full w-7 h-7 flex items-center justify-center shrink-0">{img.number}</span>
                                        <span className="font-semibold text-ink">{img.role}</span>
                                        {img.layoutPreset && <span className="text-xs bg-accent-soft text-accent px-2 py-0.5 rounded-full">{img.layoutPreset}</span>}
                                        {img.shotType && <span className="text-xs bg-positive-soft text-positive px-2 py-0.5 rounded-full">{SHOT_TYPE_LABEL[img.shotType]}</span>}
                                        {img.stage && <span className="text-xs bg-paper-2 text-ink-2 px-2 py-0.5 rounded-full">{img.stage}</span>}
                                        {img.trigger && <span className="text-xs bg-caution-soft text-caution px-2 py-0.5 rounded-full">트리거: {img.trigger}</span>}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-ink-2 mb-1">메인 카피</label>
                                            <textarea value={img.mainCopy} onChange={e => updateImage(img.id, { mainCopy: e.target.value })} rows={4}
                                                className="w-full p-2 border border-line-strong rounded-control text-sm focus:ring-2 focus:ring-accent outline-none" />
                                            <label className="block text-xs font-medium text-ink-2 mb-1 mt-2">서브 카피</label>
                                            <input value={img.subCopy} onChange={e => updateImage(img.id, { subCopy: e.target.value })}
                                                className="w-full p-2 border border-line-strong rounded-control text-sm focus:ring-2 focus:ring-accent outline-none" />
                                            <div className="mt-2">
                                                <span className="text-xs text-ink-3 mr-2">텍스트 위치</span>
                                                <select value={img.textPosition} onChange={e => updateImage(img.id, { textPosition: e.target.value as any })} className="text-xs border border-line rounded-control px-2 py-1 bg-paper">
                                                    <option value="top">상단</option>
                                                    <option value="middle">중앙</option>
                                                    <option value="bottom">하단</option>
                                                </select>
                                                <button onClick={() => handleTidyCopy(img.id)} className="ml-2 rounded-control bg-accent-soft px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft">
                                                    정리
                                                </button>
                                            </div>
                                            <div className="mt-2">
                                                <span className="text-xs text-ink-3 mr-2">촬영 타입</span>
                                                <select value={img.shotType || 'product'} onChange={e => updateImage(img.id, { shotType: e.target.value as ShotType })} className="text-xs border border-line rounded-control px-2 py-1 bg-paper">
                                                    {(Object.keys(SHOT_TYPE_LABEL) as ShotType[]).map(type => (
                                                        <option key={type} value={type}>{SHOT_TYPE_LABEL[type]}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="text-sm text-ink-2 space-y-1">
                                            {img.purpose && <p className="text-xs text-ink-2"><span className="text-ink-3">목적:</span> {img.purpose}</p>}
                                            {img.designLayout && <p className="text-xs text-ink-2"><span className="text-ink-3">레이아웃:</span> {img.designLayout}</p>}
                                            {img.trustElement && <p className="text-xs text-ink-2"><span className="text-ink-3">신뢰:</span> {img.trustElement}</p>}
                                            {img.qualityWarnings && img.qualityWarnings.length > 0 && (
                                                <div className="rounded-control border border-caution/20 bg-caution-soft p-2 text-[11px] text-caution">
                                                    {img.qualityWarnings.map((warning, i) => <p key={i}>• {warning}</p>)}
                                                </div>
                                            )}
                                            <button onClick={() => setExpandedPrompt(expandedPrompt === img.id ? null : img.id)} className="text-xs text-accent flex items-center gap-0.5">
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedPrompt === img.id ? 'rotate-180' : ''}`} /> 이미지 프롬프트
                                            </button>
                                            {expandedPrompt === img.id && <p className="text-[11px] text-ink-3 bg-paper-2 p-2 rounded-control leading-relaxed">{img.visualPrompt}</p>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-between">
                        <button onClick={() => setStep(1)} className="rounded-control px-5 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink">← 정보 수정</button>
                        <button onClick={handleGenerateAll} className="flex items-center rounded-control bg-ink px-6 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90">
                            <Wand2 className="w-5 h-5 mr-2" /> 이미지 생성 시작 ({images.length}장)
                        </button>
                    </div>
                </div>
            )}

            {/* ───── STEP 3: 이미지 생성 ───── */}
            {step === 3 && (
                <div className="space-y-6">
                    <div className="bg-paper rounded-card border border-line p-6 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-[17px] font-semibold tracking-tight text-ink">이미지 생성</h2>
                            <p className="text-sm text-ink-2 mt-1">
                                {masterGenerating
                                    ? '제품 보존용 마스터 기준컷을 먼저 생성 중입니다...'
                                    : generatingCount > 0
                                    ? `생성 중... (${generatedCount}/${images.length} 완료, 자동 속도 조절 중)`
                                    : `완료 ${generatedCount}/${images.length}${failedCount > 0 ? ` · 실패 ${failedCount}` : ''}`}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={() => setStep(2)} className="rounded-control border border-line px-5 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">← 기획안</button>
                            <button onClick={handleRetryFailed} disabled={failedCount === 0 || generatingCount > 0} className="flex items-center gap-1 rounded-control border border-caution/35 px-5 py-2.5 text-[13px] font-medium text-caution transition-colors disabled:border-line disabled:text-ink-3">
                                <RefreshCw className="w-4 h-4" /> 실패분 재시도 ({failedCount})
                            </button>
                            <button onClick={handleRetryVisionWarnings} disabled={visionWarningCount === 0 || generatingCount > 0} className="flex items-center gap-1 rounded-control border border-accent/35 px-5 py-2.5 text-[13px] font-medium text-accent transition-colors disabled:border-line disabled:text-ink-3">
                                <RefreshCw className="w-4 h-4" /> QA 경고 재생성 ({visionWarningCount})
                            </button>
                            <button onClick={handleDownloadAll} disabled={generatedCount === 0} className="flex items-center rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
                                <Download className="w-5 h-5 mr-2" /> 전체 다운로드
                            </button>
                        </div>
                    </div>

                    {useHybridReferences && (
                    <div className="rounded-card border border-accent-line bg-accent-soft p-5">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="font-semibold text-accent">2단계 하이브리드 기준컷</h3>
                                <p className="mt-1 text-xs text-accent">원본 제품 사진과 이 기준컷을 함께 참조해 제품 정확도를 우선합니다.</p>
                            </div>
                            <span className="rounded-full bg-paper px-3 py-1 text-xs font-semibold text-accent ring-1 ring-accent-line">
                                {masterGenerating ? '생성 중' : masterReferences.hookModel || masterReferences.productDetail ? '준비됨' : '대기'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { label: 'Hook 모델 기준컷', url: masterReferences.hookModel },
                                { label: '제품 디테일 기준컷', url: masterReferences.productDetail },
                            ].map(item => (
                                <div key={item.label} className="overflow-hidden rounded-card border border-accent-line bg-paper">
                                    <div className="flex aspect-[860/1000] items-center justify-center bg-paper-2 text-xs font-semibold text-ink-3">
                                        {item.url ? <img src={item.url} alt={item.label} className="h-full w-full object-cover" /> : item.label}
                                    </div>
                                    <div className="px-3 py-2 text-xs font-semibold text-ink">{item.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-paper p-4">
                        <div>
                            <p className="text-sm font-semibold text-ink">이미지 필터</p>
                            <p className="text-xs text-ink-2">완료/실패/경고 이미지를 빠르게 확인합니다.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {([
                                { value: 'all' as const, label: `전체 ${images.length}` },
                                { value: 'warning' as const, label: `경고 ${warningImageCount}` },
                                { value: 'failed' as const, label: `실패 ${failedCount}` },
                                { value: 'done' as const, label: `완료 ${generatedCount}` },
                            ]).map(filter => (
                                <button
                                    key={filter.value}
                                    onClick={() => setImageFilter(filter.value)}
                                    className={`rounded-card px-3 py-2 text-xs font-semibold transition-colors ${
                                        imageFilter === filter.value
                                            ? 'bg-ink text-paper'
                                            : 'bg-paper-2 text-ink-2 hover:bg-line'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {filteredImages.map((seg) => (
                            <div key={seg.id} id={`detail-image-${seg.id}`} className="bg-paper rounded-card border border-line overflow-hidden scroll-mt-6">
                                <div className="relative bg-paper-2" style={{ aspectRatio: '860 / 1000' }}>
                                    {seg.status === 'queued' || seg.status === 'generating' || seg.status === 'retrying' ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-3">
                                            <Loader2 className="w-8 h-8 animate-spin mb-2" />
                                            <span className="text-xs">{STATUS_LABEL[seg.status]}...</span>
                                        </div>
                                    ) : seg.imageUrl ? (
                                        <img src={seg.imageUrl} alt={seg.role} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-3 gap-2">
                                            <span className="text-xs">{seg.errorMessage || '아직 생성된 이미지가 없습니다.'}</span>
                                            <button onClick={() => generateOne(seg, seg.status === 'failed')} className="text-xs text-accent flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> 다시 생성</button>
                                        </div>
                                    )}
                                    <span className="absolute left-2 top-2 rounded-control bg-ink/80 px-2 py-0.5 text-[11px] font-medium text-paper backdrop-blur">{seg.number}. {seg.role}</span>
                                    <span className={`absolute right-2 top-2 rounded-control border px-2 py-0.5 text-[11px] font-semibold backdrop-blur ${STATUS_CLASS[seg.status]}`}>{STATUS_LABEL[seg.status]}</span>
                                </div>
                                {seg.imageUrl && (
                                    <div className="p-3 space-y-2">
                                        <div className="rounded-control border border-positive/20 bg-positive-soft p-2 text-[11px] text-positive">
                                            한글 카피를 별도 합성해 선명도와 오타 위험을 줄인 안전 모드입니다.
                                        </div>
                                        <textarea value={seg.mainCopy} onChange={e => updateImage(seg.id, { mainCopy: e.target.value })} rows={4}
                                            className="w-full p-2 border border-line rounded-control text-xs focus:ring-2 focus:ring-accent outline-none" placeholder="메인 카피" />
                                        <div className="rounded-control border border-line p-2">
                                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                                <p className="text-[11px] font-semibold text-ink-2">서브 카피 편집</p>
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => applyTextPatch(seg, { subCopy: seg.subCopy })}
                                                        disabled={seg.status === 'queued' || seg.status === 'generating' || seg.status === 'retrying'}
                                                        className="rounded-full bg-accent-soft px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-40"
                                                    >
                                                        적용
                                                    </button>
                                                    <button
                                                        onClick={() => applyTextPatch(seg, { subCopy: '' })}
                                                        disabled={seg.status === 'queued' || seg.status === 'generating' || seg.status === 'retrying' || !seg.subCopy}
                                                        className="rounded-full bg-critical-soft px-2 py-1 text-[10px] font-semibold text-critical hover:bg-critical-soft disabled:opacity-40"
                                                    >
                                                        서브 제거
                                                    </button>
                                                </div>
                                            </div>
                                            <input
                                                value={seg.subCopy}
                                                onChange={e => updateImage(seg.id, { subCopy: e.target.value })}
                                                className="w-full rounded-control border border-line p-2 text-xs outline-none focus:ring-2 focus:ring-accent"
                                                placeholder="서브 카피 (비워두면 메인 카피만 표시)"
                                            />
                                        </div>
                                        <div>
                                            <p className="mb-1 text-[11px] font-semibold text-ink-2">텍스트 위치</p>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {(['top', 'middle', 'bottom'] as const).map(position => (
                                                    <button
                                                        key={position}
                                                        onClick={() => changeTextPosition(seg, position)}
                                                        disabled={seg.status === 'queued' || seg.status === 'generating' || seg.status === 'retrying'}
                                                        className={`rounded-control border px-2 py-1.5 text-xs font-semibold transition-colors ${
                                                            seg.textPosition === position
                                                                ? 'border-ink bg-ink text-paper'
                                                                : 'border-line bg-paper text-ink-2 hover:border-line-strong'
                                                        }`}
                                                    >
                                                        {position === 'top' ? '상단' : position === 'middle' ? '중간' : '하단'}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        {seg.qualityWarnings && seg.qualityWarnings.length > 0 && (
                                            <div className="rounded-control bg-caution-soft p-2 text-[11px] text-caution">
                                                {seg.qualityWarnings.slice(0, 2).map((warning, i) => <p key={i}>• {warning}</p>)}
                                            </div>
                                        )}
                                        {seg.qaChecked && (
                                            <div className={`rounded-control border p-2 text-[11px] ${seg.visionWarnings?.length ? 'border-critical/20 bg-critical-soft text-critical' : 'border-positive/20 bg-positive-soft text-positive'}`}>
                                                <p className="mb-1 font-semibold">{seg.visionWarnings?.length ? '비전 QA 경고' : '비전 QA 통과'}</p>
                                                {seg.visionWarnings?.length
                                                    ? seg.visionWarnings.slice(0, 4).map((warning, i) => <p key={i}>• {warning}</p>)
                                                    : <p>{seg.visionSummary || '제품 보존 기준을 통과했습니다.'}</p>}
                                                {seg.visionWarnings?.length > 0 && (
                                                    <button
                                                        onClick={() => regenerateWithPreset(seg, seg.visionRegenerationHint || 'Fix the detected QA problems while preserving exact reference product identity.')}
                                                        disabled={seg.status === 'queued' || seg.status === 'generating' || seg.status === 'retrying'}
                                                        className="mt-2 rounded-full bg-paper px-2 py-1 text-[10px] font-semibold text-critical ring-1 ring-critical/20 hover:bg-critical-soft disabled:opacity-50"
                                                    >
                                                        QA 기준으로 재생성
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        {seg.qaTags && seg.qaTags.length > 0 && (
                                            <div className="rounded-control border border-line bg-paper-2 p-2">
                                                <p className="mb-1 text-[11px] font-semibold text-ink-2">QA 체크</p>
                                                <div className="flex flex-wrap gap-1">
                                                {seg.qaTags.slice(0, 5).map(tag => (
                                                    <span key={tag} className="rounded-full bg-paper-2 px-2 py-0.5 text-[10px] font-semibold text-ink-2">{tag}</span>
                                                ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="rounded-control border border-line p-2">
                                            <p className="mb-1.5 text-[11px] font-semibold text-ink-2">빠른 재생성</p>
                                            <div className="flex flex-wrap gap-1">
                                                {getRegenerationPresets(seg).map(preset => (
                                                    <button
                                                        key={preset.label}
                                                        onClick={() => regenerateWithPreset(seg, preset.hint)}
                                                        disabled={seg.status === 'queued' || seg.status === 'generating' || seg.status === 'retrying'}
                                                        className="rounded-full bg-paper-2 px-2 py-1 text-[10px] font-semibold text-ink-2 hover:bg-line disabled:opacity-50"
                                                    >
                                                        {preset.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <button onClick={() => applyTextOnly(seg)} className="w-full text-xs bg-accent-soft hover:bg-accent-soft text-accent rounded py-1.5 flex items-center justify-center gap-1">
                                            <RefreshCw className="w-3 h-3" /> 문구만 다시 적용
                                        </button>
                                        <button onClick={() => regenerateWithPreset(seg, 'Regenerate this section with a fresh premium ecommerce detail-page composition while preserving the section role and product requirements.')} className="w-full text-xs bg-paper-2 hover:bg-paper-2 text-ink-2 rounded py-1.5 flex items-center justify-center gap-1">
                                            <RefreshCw className="w-3 h-3" /> 배경까지 재생성
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="rounded-card border border-line bg-paper p-6">
                        <div className="mb-5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <div className="flex h-9 w-9 items-center justify-center rounded-card bg-ink text-paper">
                                    <Eye className="h-4.5 w-4.5" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-ink">최종 세로 미리보기</h3>
                                    <p className="text-xs text-ink-2">완성 이미지를 실제 상세페이지 순서대로 이어서 확인합니다.</p>
                                </div>
                            </div>
                            <span className="rounded-full bg-paper-2 px-3 py-1 text-xs font-semibold text-ink-2">
                                {generatedCount}/{images.length} 완료
                            </span>
                        </div>
                        <div className="mx-auto max-w-[430px] overflow-hidden rounded-card border border-line bg-paper-2">
                            {images.map((seg) => (
                                seg.imageUrl ? (
                                    <img key={seg.id} src={seg.imageUrl} alt={`${seg.number}. ${seg.role}`} className="block w-full" />
                                ) : (
                                    <div key={seg.id} className="flex aspect-[860/1000] w-full flex-col items-center justify-center border-b border-line bg-paper-2 text-ink-3">
                                        <ImageIcon className="mb-2 h-8 w-8" />
                                        <p className="text-xs font-semibold">{seg.number}. {seg.role}</p>
                                        <p className="mt-1 text-[11px]">{STATUS_LABEL[seg.status]}</p>
                                    </div>
                                )
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
