import React, { useState, useRef, type DragEvent } from 'react';
import { planDetail, generateImage } from '../../api/aiService';
import { Loader2, Upload, Image as ImageIcon, Download, Wand2, ChevronRight, X, GripVertical, RefreshCw, Maximize2 } from 'lucide-react';

type CombinationType = 'single' | '1+1' | '1+1+1';
type DesignPresetKey = 'premium' | 'minimal' | 'street' | 'lifestyle' | 'deal' | 'clean';
type ConversionModeKey = 'auto' | 'premiumTrust' | 'bundleValue' | 'problemSolution' | 'dealFocus';
type ModelGenderKey = 'auto' | 'female' | 'male' | 'mixed';
type ModelAgeKey = 'auto' | '20s' | '30s' | '40s';
type ShotPreferenceKey = 'auto' | 'full' | 'half' | 'closeup' | 'lifestyle';

const DEFAULT_DETAIL_FONT_SCALE = 1.0;
const INTRO_DETAIL_FONT_SCALE = 1.8;
const DETAIL_CANVAS_WIDTH = 860;
const DETAIL_HEIGHT_PRESETS = [1000, 1200, 1529, 1720] as const;
type DetailLayoutHeight = typeof DETAIL_HEIGHT_PRESETS[number];

const normalizeLayoutHeight = (value: unknown, fallback: DetailLayoutHeight = 1200): DetailLayoutHeight => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return DETAIL_HEIGHT_PRESETS.reduce((best, current) => (
        Math.abs(current - n) < Math.abs(best - n) ? current : best
    ), DETAIL_HEIGHT_PRESETS[0]);
};

const getFallbackLayoutHeight = (segment: any, index: number = 0, total: number = 1): DetailLayoutHeight => {
    const text = `${segment?.title || ''} ${segment?.conversionRole || ''} ${segment?.sectionType || ''}`.toLowerCase();
    if (index === 0) return 1529;
    if (index === total - 1) return 1200;
    if (text.includes('lifestyle') || text.includes('활용')) return 1529;
    if (text.includes('detail') || text.includes('디테일') || text.includes('proof') || text.includes('근거')) return 1000;
    if (text.includes('problem') || text.includes('문제')) return 1200;
    return 1200;
};

const getSegmentLayoutHeight = (segment: any, index: number = 0, total: number = 1): DetailLayoutHeight => (
    normalizeLayoutHeight(segment?.layoutHeight, getFallbackLayoutHeight(segment, index, total))
);

const getGenerationAspectRatio = (height: DetailLayoutHeight): string => {
    if (height <= 1000) return '4:5';
    if (height <= 1200) return '3:4';
    return '9:16';
};

const getHeightLabel = (height: DetailLayoutHeight): string => {
    if (height === 1000) return '컴팩트';
    if (height === 1200) return '표준';
    if (height === 1529) return '9:16';
    return '롱';
};

interface ReviewTheme {
    tag: string;
    bgStart: string;
    bgMid: string;
    bgEnd: string;
    heading: string;
    body: string;
    muted: string;
    badgeBg: string;
    badgeText: string;
    cardBg: string;
    accentStart: string;
    accentEnd: string;
    quote: string;
    rating: string;
}

interface DesignPreset {
    label: string;
    description: string;
    copyTone: string;
    imageStyle: string;
    backgroundGuide: string;
    defaultTextColor: string;
    reviewTheme: ReviewTheme;
}

interface DetailInputInfo {
    name: string;
    category: string;
    target: string;
    imageInstruction: string;
    combinationType: CombinationType;
    designPreset: DesignPresetKey;
    conversionEnabled: boolean;
    conversionMode: ConversionModeKey;
    modelGender: ModelGenderKey;
    modelAge: ModelAgeKey;
    shotPreference: ShotPreferenceKey;
}

const DESIGN_PRESETS: Record<DesignPresetKey, DesignPreset> = {
    premium: {
        label: '프리미엄',
        description: '고급스럽고 신뢰감 있는 럭셔리 톤',
        copyTone: '절제된 고급 카피, 신뢰감, 프리미엄 가치 중심',
        imageStyle: 'premium Korean e-commerce editorial model cut, refined pose, elegant styling, soft luxury lighting',
        backgroundGuide: 'warm neutral studio background, subtle depth, no harsh contrast, polished premium mood',
        defaultTextColor: '#111827',
        reviewTheme: {
            tag: 'PREMIUM REVIEW',
            bgStart: '#f8fafc',
            bgMid: '#eef2ff',
            bgEnd: '#fff7ed',
            heading: '#111827',
            body: '#1e293b',
            muted: '#64748b',
            badgeBg: '#111827',
            badgeText: '#ffffff',
            cardBg: 'rgba(255, 255, 255, 0.92)',
            accentStart: '#2563eb',
            accentEnd: '#ec4899',
            quote: '#94a3b8',
            rating: '#f59e0b',
        },
    },
    minimal: {
        label: '미니멀',
        description: '여백과 제품 선명도를 살리는 깔끔한 톤',
        copyTone: '짧고 명료한 카피, 군더더기 없는 표현, 제품 본질 중심',
        imageStyle: 'minimal Korean e-commerce model cut, clean composition, calm pose, refined simplicity',
        backgroundGuide: 'pure white or very light gray seamless studio background with generous negative space',
        defaultTextColor: '#0f172a',
        reviewTheme: {
            tag: 'CUSTOMER VOICE',
            bgStart: '#ffffff',
            bgMid: '#f8fafc',
            bgEnd: '#f1f5f9',
            heading: '#0f172a',
            body: '#334155',
            muted: '#64748b',
            badgeBg: '#f8fafc',
            badgeText: '#0f172a',
            cardBg: 'rgba(255, 255, 255, 0.96)',
            accentStart: '#cbd5e1',
            accentEnd: '#94a3b8',
            quote: '#cbd5e1',
            rating: '#f59e0b',
        },
    },
    street: {
        label: '스트릿',
        description: '강한 대비와 도시적인 모델컷',
        copyTone: '대담하고 직관적인 카피, 강한 존재감과 스타일 강조',
        imageStyle: 'street fashion Korean e-commerce model cut, confident pose, urban styling, bold contrast',
        backgroundGuide: 'dark gray, concrete, or city-inspired seamless background with dramatic directional lighting',
        defaultTextColor: '#ffffff',
        reviewTheme: {
            tag: 'STREET PROOF',
            bgStart: '#111827',
            bgMid: '#1f2937',
            bgEnd: '#0f172a',
            heading: '#f8fafc',
            body: '#e5e7eb',
            muted: '#cbd5e1',
            badgeBg: '#f8fafc',
            badgeText: '#111827',
            cardBg: 'rgba(17, 24, 39, 0.9)',
            accentStart: '#f97316',
            accentEnd: '#ef4444',
            quote: '#475569',
            rating: '#fbbf24',
        },
    },
    lifestyle: {
        label: '감성 라이프',
        description: '따뜻하고 자연스러운 생활감 중심',
        copyTone: '부드럽고 감성적인 카피, 일상 속 만족감과 편안함 강조',
        imageStyle: 'warm lifestyle Korean e-commerce model cut, natural pose, cozy atmosphere, approachable styling',
        backgroundGuide: 'soft beige, warm daylight, home or lifestyle-inspired seamless scene with gentle texture',
        defaultTextColor: '#3f2f24',
        reviewTheme: {
            tag: 'LIFE REVIEW',
            bgStart: '#fff7ed',
            bgMid: '#fffbeb',
            bgEnd: '#fef3c7',
            heading: '#3f2f24',
            body: '#4b5563',
            muted: '#78716c',
            badgeBg: '#7c2d12',
            badgeText: '#fff7ed',
            cardBg: 'rgba(255, 251, 235, 0.94)',
            accentStart: '#f59e0b',
            accentEnd: '#fb7185',
            quote: '#d6a35d',
            rating: '#f59e0b',
        },
    },
    deal: {
        label: '세일/혜택',
        description: '혜택과 구성 가치를 강하게 보여주는 톤',
        copyTone: '혜택 중심의 명확한 카피, 구성 가치와 구매 이유 강조',
        imageStyle: 'high-impact Korean e-commerce model cut, energetic pose, clear product visibility, promotional mood',
        backgroundGuide: 'bright seamless background with vivid accent colors, dynamic but uncluttered composition',
        defaultTextColor: '#dc2626',
        reviewTheme: {
            tag: 'BEST DEAL REVIEW',
            bgStart: '#fff1f2',
            bgMid: '#fff7ed',
            bgEnd: '#fef2f2',
            heading: '#991b1b',
            body: '#1f2937',
            muted: '#64748b',
            badgeBg: '#dc2626',
            badgeText: '#ffffff',
            cardBg: 'rgba(255, 255, 255, 0.94)',
            accentStart: '#dc2626',
            accentEnd: '#f97316',
            quote: '#fecaca',
            rating: '#f59e0b',
        },
    },
    clean: {
        label: '클린 정보형',
        description: '정보 전달과 비교가 쉬운 정돈된 톤',
        copyTone: '논리적이고 정돈된 카피, 기능과 차별점 중심',
        imageStyle: 'clean informational Korean e-commerce model cut, clear front-facing product view, balanced posture',
        backgroundGuide: 'bright seamless studio background with subtle blue-gray tone and organized negative space',
        defaultTextColor: '#1e3a8a',
        reviewTheme: {
            tag: 'VERIFIED REVIEW',
            bgStart: '#eff6ff',
            bgMid: '#f8fafc',
            bgEnd: '#e0f2fe',
            heading: '#1e3a8a',
            body: '#1e293b',
            muted: '#64748b',
            badgeBg: '#1e40af',
            badgeText: '#ffffff',
            cardBg: 'rgba(255, 255, 255, 0.95)',
            accentStart: '#2563eb',
            accentEnd: '#06b6d4',
            quote: '#bfdbfe',
            rating: '#f59e0b',
        },
    },
};

const COMBINATION_OPTIONS: Array<{ value: CombinationType; label: string; desc: string }> = [
    { value: 'single', label: '일반 상품', desc: '단품 중심 상세페이지' },
    { value: '1+1', label: '1+1 상품', desc: '인트로에 2개 구성을 강조' },
    { value: '1+1+1', label: '1+1+1 상품', desc: '인트로에 3개 구성을 강조' },
];

const CONVERSION_MODE_OPTIONS: Array<{ value: ConversionModeKey; label: string; desc: string }> = [
    { value: 'auto', label: '자동 추천', desc: '상품 구성과 디자인 스타일에 맞춰 설득 흐름 자동 선택' },
    { value: 'premiumTrust', label: '프리미엄 신뢰형', desc: '고급감, 소재, 품질 근거를 중심으로 구성' },
    { value: 'bundleValue', label: '조합상품 혜택형', desc: '1+1, 1+1+1 구성 가치와 활용성을 강조' },
    { value: 'problemSolution', label: '문제 해결형', desc: '고객 고민을 먼저 짚고 해결 장면을 강화' },
    { value: 'dealFocus', label: '세일/혜택형', desc: '검증되지 않은 할인율 없이 구성 가치와 구매 이유 강조' },
];

const MODEL_GENDER_OPTIONS: Array<{ value: ModelGenderKey; label: string }> = [
    { value: 'auto', label: '자동' },
    { value: 'female', label: '여성 모델' },
    { value: 'male', label: '남성 모델' },
    { value: 'mixed', label: '혼합 모델' },
];

const MODEL_AGE_OPTIONS: Array<{ value: ModelAgeKey; label: string }> = [
    { value: 'auto', label: '자동' },
    { value: '20s', label: '20대' },
    { value: '30s', label: '30대' },
    { value: '40s', label: '40대' },
];

const SHOT_PREFERENCE_OPTIONS: Array<{ value: ShotPreferenceKey; label: string }> = [
    { value: 'auto', label: '자동 배정' },
    { value: 'full', label: '전신컷' },
    { value: 'half', label: '반신컷' },
    { value: 'closeup', label: '클로즈업' },
    { value: 'lifestyle', label: '라이프컷' },
];

const getCombinationCount = (type: CombinationType): number => {
    if (type === '1+1') return 2;
    if (type === '1+1+1') return 3;
    return 1;
};

const getCombinationCountLabel = (count: number): string => {
    if (count === 2) return '두 개';
    if (count === 3) return '세 개';
    return '한 개';
};

const getEffectiveConversionMode = (
    enabled: boolean,
    selectedMode: ConversionModeKey,
    combinationType: CombinationType,
    designPreset: DesignPresetKey
): ConversionModeKey => {
    if (!enabled) return 'auto';
    if (selectedMode !== 'auto') return selectedMode;
    if (combinationType !== 'single') return 'bundleValue';
    if (designPreset === 'premium') return 'premiumTrust';
    if (designPreset === 'deal') return 'dealFocus';
    return 'problemSolution';
};

const getConversionModeLabel = (mode: ConversionModeKey): string => (
    CONVERSION_MODE_OPTIONS.find(option => option.value === mode)?.label || '자동 추천'
);

const getFallbackConversionRole = (index: number, combinationType: CombinationType): string => {
    if (index === 0) return combinationType === 'single' ? '핵심 오퍼' : '조합 핵심 오퍼';
    if (index === 1) return '고객 문제/상황';
    if (index === 2) return '구매 근거';
    if (index === 3) return '제품 디테일';
    if (index === 4) return '활용 장면';
    return '구매 안심';
};

const getFallbackSectionType = (index: number, combinationType: CombinationType): string => {
    const role = getFallbackConversionRole(index, combinationType);
    if (role.includes('오퍼')) return 'offer';
    if (role.includes('문제')) return 'problem';
    if (role.includes('근거')) return 'proof';
    if (role.includes('디테일')) return 'detail';
    if (role.includes('활용')) return 'lifestyle';
    return 'trust';
};

const getAutoShotType = (segment: any, index: number): ShotPreferenceKey => {
    const text = `${segment.title || ''} ${segment.conversionRole || ''} ${segment.sectionType || ''}`.toLowerCase();
    if (index === 0) return 'full';
    if (text.includes('디테일') || text.includes('detail') || text.includes('소재') || text.includes('마감')) return 'closeup';
    if (text.includes('활용') || text.includes('라이프') || text.includes('상황') || text.includes('lifestyle')) return 'lifestyle';
    if (text.includes('핏') || text.includes('실루엣') || text.includes('착용')) return 'full';
    return index % 3 === 0 ? 'full' : index % 3 === 1 ? 'half' : 'closeup';
};

const NATURAL_MODEL_COMPOSITION_RULES = `
NATURAL MODEL COMPOSITION:
-- The model must appear at realistic human scale in the same physical scene as the product, with consistent perspective, lighting, and shadows.
-- Never create a tiny, shrunken, miniature, sticker-like, pasted, or picture-in-picture model.
-- Never show a person or model being held in a hand, placed on top of a product close-up, or floating over the product.
-- Do not use an oversized product print, logo, texture, or fabric close-up as a backdrop behind a separate small model.
-- Product artwork, logos, patterns, and texture must appear on the product at believable scale, unless the whole frame is a pure macro detail with no separate full-body model.
-- For detail or close-up sections, use one natural close crop of the product being worn or used, such as torso fabric, neckline, print, texture, seam, hand interaction, or fit detail. Do not add a separate full-body model in the same frame.
-- If a full-body or half-body model is shown, make the model life-size and fully integrated into the environment.
`;

const GPT_EDITORIAL_REFERENCE_LAYOUT = `
GPT-STYLE EDITORIAL DETAIL PAGE LAYOUT:
-- Use the attached example style as the target mood: a tall premium fashion/product story page with a large realistic model or product scene and clean Korean editorial typography.
-- For hero, offer, fit, lifestyle, and problem sections, prefer a magazine-like layout: large model/product on the right or center-right, generous clean negative space on the left, and a calm premium interior or studio background.
-- Render a bold Korean headline in the upper-left area, 2 to 4 short lines, with strong black or high-contrast typography.
-- Under the headline, render 1 to 3 short supporting Korean copy lines in a smaller clean font when space allows.
-- When the section naturally supports feature points, include a thin divider line and 3 to 4 small circular line icons with short Korean labels stacked vertically on the left, like a refined shopping-mall detail page. Keep icons minimal and relevant, not decorative clutter.
-- Text and icons must sit directly on the clean background, not inside cards, boxes, speech bubbles, badges, or floating panels.
-- Keep the model/product full, realistic, and easy to inspect. Avoid covering the face, chest print, logo, texture, or main product detail with text.
-- The image should feel like a finished GPT-generated Korean e-commerce visual similar to a premium fashion landing section, not a raw catalog photo and not a collage.
`;

const MASTER_DETAIL_IMAGE_QUALITY_RULES = `
MASTER DETAIL PAGE IMAGE QUALITY:
-- Behave like a top-tier Korean ecommerce advertising designer, performance marketer, CRO expert, and brand strategist.
-- The goal is high conversion, not decoration. Every image must clearly support one persuasion role: attention, empathy, problem recognition, solution, trust, confidence, or CTA.
-- Apply at least one conversion trigger naturally: loss aversion, social proof without fake numbers, authority without fake certifications, convenience, emotional reward, comparison advantage, or purchase confidence.
-- Use these visual qualities where appropriate: photorealistic, commercial product photography, premium ecommerce detail page, natural lighting, ultra realistic texture, high-end advertising, clean layout, professional typography area, Korean ecommerce style, smartstore optimized, 860px width composition, high conversion design, premium visual merchandising, realistic shadows, premium UI elements, information-rich layout, luxury branding.
-- Keep information density high but readable. Use hierarchy: main headline, short subcopy, 3 to 5 support points, and one trust cue only when it is visually natural.
-- Never invent unverifiable facts such as sales rank, exact satisfaction rate, cumulative sales, guaranteed effects, certification, patent, award, review count, rating, or discount.
`;

const getSectionEditorialDirection = (segment: any, segmentIndex: number): string => {
    const sectionType = String(segment.sectionType || '').toLowerCase();
    const role = String(segment.conversionRole || '').toLowerCase();
    const title = String(segment.title || '').toLowerCase();
    const signatureVariant = [
        'calm studio room with left-side editorial copy space, full or three-quarter body fashion composition',
        'warm daily-life interior with natural daylight, candid posture, product used naturally',
        'close product texture and fit detail, hands or body context only, tactile macro realism',
        'clean product-focused still life or folded product scene with premium shadows and enough empty space',
        'outdoor or cafe lifestyle scene with movement, relaxed expression, product clearly visible',
        'minimal final hero composition with product as the confident focus and generous copy-safe space',
    ][segmentIndex % 6];

    const roleDirection =
        sectionType.includes('detail') || title.includes('디테일') || title.includes('소재') || title.includes('마감')
            ? 'Use a detail-first composition: fabric, finish, print, logo, stitching, grip, texture, or functional part shown at realistic scale.'
            : sectionType.includes('lifestyle') || role.includes('상황') || title.includes('활용')
                ? 'Use a lifestyle composition that shows the product inside a believable day-to-day moment.'
                : sectionType.includes('trust') || role.includes('안심') || title.includes('summary') || title.includes('cta')
                    ? 'Use a quiet product-story composition that can close the page without looking like a sale banner.'
                    : segmentIndex === 0
                        ? 'Use a main hero composition similar to the provided GPT example: bold Korean headline on the left, feature icon list below, large realistic model/product on the right, clean premium interior.'
                        : 'Use a distinct editorial composition that does not repeat the previous section camera angle, pose, or background.';

    return `
EDITORIAL VARIATION:
- Section visual variant: ${signatureVariant}
- ${roleDirection}
- Vary camera distance, model pose, room/background, props, and product angle from every other section.
- Avoid repeated centered torso close-ups unless this section is explicitly a close-up detail section.
- Do not create frosted glass cards, white pill badges, UI panels, price tags, sale stickers, or text boxes inside the generated image.
`;
};

const buildModelProfileInstruction = (info: DetailInputInfo): string => {
    const genderText = {
        auto: 'Choose the model gender that best matches the product category and target customer.',
        female: 'Use a fictional female Korean model.',
        male: 'Use a fictional male Korean model.',
        mixed: 'Use a natural mix of fictional Korean models when multiple models appear.',
    }[info.modelGender];
    const ageText = {
        auto: 'Choose a realistic adult age range that best matches the target customer.',
        '20s': 'Use a fictional model in their 20s.',
        '30s': 'Use a fictional model in their 30s.',
        '40s': 'Use a fictional model in their 40s.',
    }[info.modelAge];

    return `
MODEL PROFILE CONTROL:
- ${genderText}
- ${ageText}
- The model must be a newly generated fictional person and must not copy any real person from the reference images.
`;
};

const buildShotCompositionInstruction = (segment: any, segmentIndex: number, shotPreference: ShotPreferenceKey): string => {
    const shotType = shotPreference === 'auto'
        ? (segment.shotType || getAutoShotType(segment, segmentIndex))
        : shotPreference;
    const shotGuide: Record<ShotPreferenceKey, string> = {
        auto: 'Use the most suitable editorial e-commerce composition for this section.',
        full: 'Use a full-body or three-quarter model cut with the whole outfit/product visible and no cropped head or feet.',
        half: 'Use a waist-up or half-body model cut only when it helps the section; avoid repeating the same torso crop across sections.',
        closeup: 'Use one natural close crop of the product being worn or used, showing texture, fit, finish, and product details. Do not combine a giant product close-up background with a tiny/full-body model overlay.',
        lifestyle: 'Use a natural lifestyle model scene that shows how the product is used in daily life.',
    };

    return `
SECTION SHOT COMPOSITION:
- Conversion role: ${segment.conversionRole || getFallbackConversionRole(segmentIndex, 'single')}
- Required shot type: ${shotType}
- ${shotGuide[shotType as ShotPreferenceKey] || shotGuide.auto}
- Leave natural copy-safe negative space near the top-left or left side when possible, but keep the scene continuous and photographic.
- Avoid placing model faces or critical product details under the likely Korean copy area.
`;
};

const buildConversionImageInstruction = (segment: any): string => {
    if (!segment.conversionRole && !segment.sectionType) return '';
    return `
CONVERSION FUNNEL PURPOSE:
- This image supports: ${segment.conversionRole || 'purchase persuasion'}
- Section type: ${segment.sectionType || 'conversion'}
- The image must visually support this selling purpose while rendering only the requested Korean copy. Do not add unrelated badges, prices, reviews, captions, or extra claims.
`;
};

const buildDetailImagePrompt = (
    segment: any,
    segmentIndex: number,
    info: DetailInputInfo,
    designPreset: DesignPreset
): string => {
    const colorInstruction = info.imageInstruction
        ? `ADDITIONAL COLOR REQUEST: ${info.imageInstruction}`
        : 'CRITICAL: Use ONLY the exact colors shown in the reference images. DO NOT change or add any new colors. Maintain the original product colors precisely.';
    const modelCutInstruction = buildModelCutInstruction(info.combinationType, segmentIndex);
    const combinationInstruction = buildCombinationImageInstruction(info.combinationType, segmentIndex);
    const designPresetInstruction = buildDesignPresetImageInstruction(designPreset);
    const modelProfileInstruction = buildModelProfileInstruction(info);
    const shotInstruction = buildShotCompositionInstruction(segment, segmentIndex, info.shotPreference);
    const conversionInstruction = buildConversionImageInstruction(segment);
    const editorialDirection = getSectionEditorialDirection(segment, segmentIndex);
    const layoutHeight = getSegmentLayoutHeight(segment, segmentIndex);
    const sourceAspectRatio = getGenerationAspectRatio(layoutHeight);
    const headline = String(segment.keyMessage || segment.title || info.name || '상품 포인트').trim();
    const supportingCopy = Array.isArray(segment.logicalSections)
        ? segment.logicalSections.filter(Boolean).slice(0, 3).join(' · ')
        : '';
    const posKo = segment.textPosition === 'top' ? 'top area' : segment.textPosition === 'middle' ? 'middle area' : 'bottom area';
    const typographyHint = `Use ${segment.textColor || designPreset.defaultTextColor} or the closest readable premium color for the Korean typography. Scale preference ${segment.fontScale ?? DEFAULT_DETAIL_FONT_SCALE}; keep it elegant and readable.`;

    return `Create ONE finished premium vertical Korean e-commerce editorial detail-page image. STRICT REQUIREMENTS:
- Final app canvas is exactly ${DETAIL_CANVAS_WIDTH}x${layoutHeight}px. Compose for this canvas size, using a ${sourceAspectRatio} source guide. Keep all model faces, product details, and copy-safe negative space inside the frame.
- Render the requested Korean copy as part of the image, like a polished GPT-generated product story page. Korean typography must be natural, sharp, correctly spelled, and never romanized.
- Use one seamless full-page photographic scene across the entire vertical image. Do NOT create a separate blank text area, header band, footer band, split-screen collage, panels, boxes, vertical seams, side-by-side reference-image composites, or hard dividers.
- Aim for the refined GPT-style detail-page feeling: realistic product story, tasteful negative space, editorial composition, natural light, and premium Korean shopping-mall polish.
- Place the Korean text block in the ${posKo}, directly on clean negative space. Avoid frosted glass cards, white pill badges, UI panels, speech bubbles, price tags, sale stickers, or generic ad banner boxes.
- EXACT KOREAN HEADLINE TO RENDER, preserving line breaks and wording: "${headline}"
${supportingCopy ? `- Optional small supporting labels, only if they fit naturally: "${supportingCopy}"` : ''}
- ${typographyHint}
- For the first hero image and other model/product story sections, strongly follow the GPT-style reference layout: bold left-aligned Korean headline, smaller supporting copy, optional thin divider, optional circular icon feature list, and a large realistic model/product occupying the right side.
- If using feature icons, use simple line icons only and pair them with short Korean labels derived from the product benefits. Do not add fake prices, discounts, ratings, review counts, brand names, or unverifiable claims.
- The image must feel like a complete high-conversion Korean detail-page section: main copy, subcopy or support points, trust cue if available, and a clear visual hierarchy.
- If the reference image contains a real model/person, use it ONLY to understand product fit and scale. Replace the model with a completely new fictional Korean model with a different face, hair, pose, body impression, and expression.
- Replace the reference photo background completely. Do NOT copy rooms, walls, mirrors, posters, furniture, doors, bathrooms, studios, or any visible environment from the uploaded reference photos.
- The final image must look like a physically believable single photograph, not an artificial composite of product close-up and pasted model.
- Preserve the EXACT colors from ALL reference product images - do not alter or add colors unless specifically requested
- CRITICAL: Multiple reference images are provided showing different angles (front, back, side). Each image may have logos, brand marks, or design elements. You MUST preserve ALL logos and brand marks from ALL reference images exactly as they appear in their respective angles.
- If generating a back view and the reference back image has a logo, include that logo exactly
- If generating a front view and the reference front image has a logo, include that logo exactly
- DO NOT add any new logos, watermarks, or brand marks that are not in the reference images
- Focus on visual composition only: ${segment.visualPrompt}
${designPresetInstruction}
${modelCutInstruction}
${combinationInstruction}
${modelProfileInstruction}
${GPT_EDITORIAL_REFERENCE_LAYOUT}
${MASTER_DETAIL_IMAGE_QUALITY_RULES}
${NATURAL_MODEL_COMPOSITION_RULES}
${shotInstruction}
${conversionInstruction}
${editorialDirection}
${colorInstruction}
Maintain ALL original product details including logos and colors from ALL reference images while making this section visually distinct from the others.`;
};

const buildCombinationIntroSegment = (combinationType: CombinationType, productName: string) => {
    const count = getCombinationCount(combinationType);
    const countLabel = getCombinationCountLabel(count);

    return {
        id: 'combination-intro-' + Date.now(),
        title: `${combinationType} 조합 인트로`,
        logicalSections: ['인트로', '조합 혜택'],
        keyMessage: `${combinationType} 구성\n${countLabel}를 한 번에`,
        layoutHeight: 1529,
        visualPrompt: `A high-quality professional Korean e-commerce model cut for exactly ${count} separate units of ${productName || 'the product'} arranged together on one vertical intro page. Use one seamless studio background across the entire frame, including the top copy-safe area and the model area. The models must stand together in one continuous scene, not in separated columns. Do not create a separate white header band, split-screen collage, panel layout, boxed sections, vertical seams, hard dividers, or different backgrounds behind each model. If reference photos include real models, replace every face and person with completely new fictional Korean models; use the reference only for product design, fit, logo, color, and texture. Replace any reference room/background with a new premium studio background. Reserve the top 22% as clean negative space with the same continuous background, and place the ${count} fictional fashion models below that area so their heads, bodies, and products are not cropped by the integrated Korean headline. Keep the products large and clearly visible, preserve product details, logos, colors, and texture, use clean premium lighting, and do not include unrelated text, prices, numbers, labels, badges, or extra typography beyond the requested Korean copy.`,
    };
};

const buildModelCutInstruction = (combinationType: CombinationType, segmentIndex: number): string => {
    const count = getCombinationCount(combinationType);
    const bundleIntro = combinationType !== 'single' && segmentIndex === 0
        ? `- For the intro, create a bundle model cut with exactly ${count} visible product-wearing/using models together in one vertical page.
- Use one continuous seamless studio background for the entire image. Do NOT use split-screen panels, vertical seams, separate boxes, hard dividers, different backgrounds per model, side-by-side reference-photo composites, or a white header block.
- Reserve the top 22% of the image as clean negative space on the same continuous background for the integrated Korean headline.
- Place models and products below that copy-safe area and keep faces, heads, outfits, and products fully visible without top cropping.`
        : '';

    return `
MODEL CUT STYLE:
- Use a professional Korean e-commerce editorial composition, not a generic catalog banner.
- For hero, lifestyle, fit, and offer sections, show a fictional model wearing/using the product naturally.
- For detail, summary, CTA, trust, or product-info-like sections, product-only still life, folded product, close-up texture, or clean object composition is allowed when it fits the section better.
- Do not use mannequins. Use hangers or flat lays only when the section is clearly a product detail or still-life scene and the result feels premium, not cheap catalog-like.
- Use a new fictional model face and body; do not copy any real person, face, hair, pose, body impression, or expression from reference images.
- Change the environment completely; do not reuse reference rooms, walls, posters, mirrors, furniture, doors, or indoor backgrounds.
- Keep the product as the clear hero subject, large and easy to inspect.
- Keep the model, product, hands, and background at realistic scale in one physically believable scene.
- Never create a miniature model pasted over a large product close-up, picture-in-picture model, sticker cutout, or hand-held tiny person.
- Do not enlarge product artwork or fabric into a giant background behind a separate model.
${bundleIntro}
`;
};

const buildCombinationImageInstruction = (combinationType: CombinationType, segmentIndex: number): string => {
    if (combinationType === 'single') return '';

    const count = getCombinationCount(combinationType);
    const introInstruction = segmentIndex === 0
        ? `- INTRO SECTION: Show exactly ${count} model-cut product presentations together in one vertical frame, using the reference images as the product source.
- Keep the top area visually open for the requested Korean headline; do not place important model faces or product details in the top 22% of the frame.
- The intro must look like one unified photo scene with a single continuous background, not a collage, not a side-by-side split, and not separated panels.`
        : `- Keep the bundle context visible where natural; use multiple units together in one unified scene when it supports the section concept. Never use split panels or visible seams.`;

    return `
COMBINATION PRODUCT MODE (${combinationType}):
- This detail page is for a ${combinationType} bundle containing ${count} product units.
${introInstruction}
- Do NOT render unrelated bundle numbers, plus signs, sale badges, prices, or extra typography. Only render the requested Korean headline/copy from this prompt.
`;
};

const buildDesignPresetImageInstruction = (designPreset: DesignPreset): string => `
DESIGN PRESET (${designPreset.label}):
- Copy tone: ${designPreset.copyTone}
- Image style: ${designPreset.imageStyle}
- Background direction: ${designPreset.backgroundGuide}
- Keep the selected brand mood consistent, but vary the camera angle, scene, framing, and background so the page does not feel like the same image repeated.
`;

const drawCanvasRoundRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
};

const drawCanvasWrappedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number
) => {
    const chars = text.split('');
    let line = '';
    let lineY = y;
    let lines = 0;

    for (let i = 0; i < chars.length; i++) {
        const testLine = line + chars[i];
        if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
            ctx.fillText(line, x, lineY);
            line = chars[i];
            lineY += lineHeight;
            lines++;
            if (lines >= maxLines - 1) {
                while (ctx.measureText(line + '...').width > maxWidth && line.length > 0) {
                    line = line.slice(0, -1);
                }
                line += '...';
                break;
            }
        } else {
            line = testLine;
        }
    }

    ctx.fillText(line, x, lineY);
};

const fillPresetBackground = (ctx: CanvasRenderingContext2D, width: number, height: number, designPreset: DesignPreset) => {
    const theme = designPreset.reviewTheme;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, theme.bgStart);
    gradient.addColorStop(0.5, theme.bgMid);
    gradient.addColorStop(1, theme.bgEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
};

const loadCanvasImage = (imageUrl?: string): Promise<HTMLImageElement | null> => {
    if (!imageUrl) return Promise.resolve(null);

    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
};

const drawCoverImage = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
) => {
    const imgRatio = img.width / img.height;
    const targetRatio = width / height;
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

    ctx.save();
    drawCanvasRoundRect(ctx, x, y, width, height, radius);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
    ctx.restore();
};

const generateConversionVisualImage = async (
    templateTitle: string,
    visualDirection: string,
    visualVariant: string,
    productName: string,
    category: string,
    referenceImages: string[],
    designPreset: DesignPreset,
    combinationType: CombinationType
): Promise<string> => {
    try {
        const count = getCombinationCount(combinationType);
        const bundleGuide = combinationType !== 'single'
            ? `Show the value of a ${combinationType} bundle with exactly ${count} product-wearing/using model cuts when natural.`
            : 'Show one clear hero product-use model cut.';
        const prompt = `Create a premium Korean e-commerce model cut image for a conversion template.
Template: ${templateTitle}
Product: ${productName || category}
Category: ${category}
Design style: ${designPreset.label}
Visual direction: ${visualDirection}
Unique visual variant: ${visualVariant}

STRICT REQUIREMENTS:
- NO TEXT, NO LETTERS, NO NUMBERS, NO BADGES, NO CAPTIONS in the image
- Professional fictional Korean model cut or lifestyle model scene
- Product must be clearly visible and faithful to the reference images
- ${bundleGuide}
- Use this style: ${designPreset.imageStyle}
- Background direction: ${designPreset.backgroundGuide}
- Use a completely new fictional model face/person and a new background; never copy reference people, faces, rooms, walls, posters, doors, mirrors, furniture, or indoor environments
- Do not reuse the same pose, scene, or background as other conversion template visuals
- Use one continuous scene only. Never create split-screen panels, vertical seams, side-by-side photo composites, or divided backgrounds
${NATURAL_MODEL_COMPOSITION_RULES}
- Leave clean negative space and avoid cropping model faces, heads, or product details`;

        return await generateImage(prompt, referenceImages, '9:16') || '';
    } catch (error) {
        console.error('Conversion visual image generation failed:', error);
        return '';
    }
};

const generateConversionTemplateImage = async (
    label: string,
    title: string,
    _subtitle: string,
    items: Array<{ label: string; text: string }>,
    designPreset: DesignPreset,
    visualImageUrl?: string
): Promise<string> => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    const theme = designPreset.reviewTheme;
    const visualImage = await loadCanvasImage(visualImageUrl);

    fillPresetBackground(ctx, canvas.width, canvas.height, designPreset);

    const accent = ctx.createLinearGradient(56, 0, canvas.width - 56, 0);
    accent.addColorStop(0, theme.accentStart);
    accent.addColorStop(1, theme.accentEnd);
    ctx.fillStyle = accent;
    drawCanvasRoundRect(ctx, 56, 62, canvas.width - 112, 8, 4);
    ctx.fill();

    ctx.fillStyle = theme.badgeBg;
    drawCanvasRoundRect(ctx, 62, 112, 178, 42, 21);
    ctx.fill();
    ctx.fillStyle = theme.badgeText;
    ctx.font = 'bold 18px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 151, 133);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 54px "Noto Sans KR", sans-serif';
    drawCanvasWrappedText(ctx, title, 62, 232, canvas.width - 124, 62, 2);

    const cardX = 64;
    const cardW = canvas.width - 128;
    const hasVisual = Boolean(visualImage);

    if (visualImage) {
        ctx.shadowColor = designPreset.defaultTextColor === '#ffffff' ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.13)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 14;
        drawCanvasRoundRect(ctx, cardX, 328, cardW, 388, 30);
        ctx.fillStyle = theme.cardBg;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        drawCoverImage(ctx, visualImage, cardX, 328, cardW, 388, 30);
        const imageShade = ctx.createLinearGradient(cardX, 328, cardX, 716);
        imageShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
        imageShade.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
        ctx.fillStyle = imageShade;
        drawCanvasRoundRect(ctx, cardX, 328, cardW, 388, 30);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.font = 'bold 26px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(title, cardX + 34, 674);
    }

    const cardStartY = hasVisual ? 746 : 420;
    const compactCard = hasVisual;
    const cardH = compactCard ? 70 : items.length > 3 ? 128 : 154;
    let y = cardStartY;

    items.slice(0, compactCard ? 3 : 4).forEach((item, idx) => {
        ctx.shadowColor = compactCard ? 'transparent' : designPreset.defaultTextColor === '#ffffff' ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.13)';
        ctx.shadowBlur = compactCard ? 0 : 22;
        ctx.shadowOffsetY = compactCard ? 0 : 12;
        drawCanvasRoundRect(ctx, cardX, y, cardW, cardH, compactCard ? 18 : 26);
        ctx.fillStyle = theme.cardBg;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = accent;
        drawCanvasRoundRect(ctx, cardX + 22, y + (compactCard ? 18 : 30), compactCard ? 34 : 62, compactCard ? 34 : 62, compactCard ? 17 : 31);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${compactCard ? 17 : 24}px "Noto Sans KR", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), cardX + (compactCard ? 39 : 57), y + (compactCard ? 35 : 61));

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = theme.heading;
        ctx.font = `bold ${compactCard ? 20 : 26}px "Noto Sans KR", sans-serif`;
        ctx.fillText(item.label, cardX + (compactCard ? 74 : 112), y + (compactCard ? 28 : 52));
        ctx.fillStyle = theme.body;
        ctx.font = `${compactCard ? 17 : 22}px "Noto Sans KR", sans-serif`;
        drawCanvasWrappedText(ctx, item.text, cardX + (compactCard ? 74 : 112), y + (compactCard ? 55 : 92), cardW - (compactCard ? 100 : 150), compactCard ? 24 : 32, compactCard ? 1 : 2);
        y += cardH + (compactCard ? 12 : 24);
    });

    return canvas.toDataURL('image/png');
};

// ✅ 인증서 이미지 생성 함수
const generateCertificateImage = (certType: string, certNumber: string, certDate: string, designPreset: DesignPreset): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    const theme = designPreset.reviewTheme;

    fillPresetBackground(ctx, canvas.width, canvas.height, designPreset);

    ctx.shadowColor = designPreset.defaultTextColor === '#ffffff' ? 'rgba(0, 0, 0, 0.38)' : 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 18;
    drawCanvasRoundRect(ctx, 72, 82, canvas.width - 144, canvas.height - 164, 34);
    ctx.fillStyle = theme.cardBg;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    const accent = ctx.createLinearGradient(120, 0, canvas.width - 120, 0);
    accent.addColorStop(0, theme.accentStart);
    accent.addColorStop(1, theme.accentEnd);
    ctx.fillStyle = accent;
    drawCanvasRoundRect(ctx, 142, 140, 140, 140, 70);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(178, 210);
    ctx.lineTo(206, 238);
    ctx.lineTo(250, 184);
    ctx.stroke();

    ctx.fillStyle = theme.badgeBg;
    drawCanvasRoundRect(ctx, 324, 146, 214, 42, 21);
    ctx.fill();
    ctx.fillStyle = theme.badgeText;
    ctx.font = 'bold 18px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QUALITY PROOF', 431, 167);

    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 48px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('품질 인증서', 324, 246);

    ctx.fillStyle = theme.muted;
    ctx.font = '23px "Noto Sans KR", sans-serif';
    ctx.fillText(`${designPreset.label} 톤앤매너에 맞춘 신뢰 정보`, 326, 294);

    const infoItems = [
        ['인증 타입', certType],
        ['인증번호', certNumber],
        ['발급일자', certDate],
    ];

    let y = 390;
    infoItems.forEach(([label, value]) => {
        ctx.fillStyle = designPreset.defaultTextColor === '#ffffff' ? 'rgba(255, 255, 255, 0.07)' : 'rgba(15, 23, 42, 0.045)';
        drawCanvasRoundRect(ctx, 132, y, canvas.width - 264, 92, 22);
        ctx.fill();
        ctx.fillStyle = theme.muted;
        ctx.font = 'bold 20px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, 168, y + 35);
        ctx.fillStyle = theme.heading;
        ctx.font = 'bold 27px "Noto Sans KR", sans-serif';
        ctx.fillText(value, 168, y + 70);
        y += 118;
    });

    ctx.strokeStyle = designPreset.defaultTextColor === '#ffffff' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(132, 770);
    ctx.lineTo(canvas.width - 132, 770);
    ctx.stroke();

    ctx.fillStyle = theme.body;
    ctx.font = '24px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('입력한 인증 정보를 바탕으로 구성된 신뢰 섹션입니다.', canvas.width / 2, 826);
    ctx.fillStyle = theme.muted;
    ctx.font = '21px "Noto Sans KR", sans-serif';
    ctx.fillText('판매 전 실제 인증 정보와 표시 기준을 반드시 확인하세요.', canvas.width / 2, 866);

    return canvas.toDataURL('image/png');
};

// ✅ 고객 후기 배경 이미지를 AI로 생성하는 함수
const generateReviewImageWithAI = async (
    reviews: Array<{ rating: number; text: string; author: string }>,
    productName: string,
    category: string,
    referenceImages: string[],
    designPreset: DesignPreset
): Promise<string> => {
    try {
        // AI로 후기 배경 이미지 생성
        const prompt = `Create a soft, elegant background image for customer reviews section of an e-commerce product detail page.
Product: ${productName}
Category: ${category}
Design style: ${designPreset.label}
Background direction: ${designPreset.backgroundGuide}

REQUIREMENTS:
- Subtle, professional background that doesn't distract from text
- Match this style: ${designPreset.imageStyle}
- Include minimal decorative elements (subtle patterns, soft shapes, or textures)
- Maintain the product's color scheme from reference images
- NO text, NO words, NO letters
- Clean, modern, professional feel
- Aspect ratio 9:16
- Leave plenty of clean space for text overlay

Style: ${designPreset.copyTone}`;

        const bgImageUrl = await generateImage(prompt, referenceImages, "9:16");
        return bgImageUrl;
    } catch (error) {
        console.error("Review background generation failed:", error);
        // 실패 시 기본 배경 반환
        return '';
    }
};

// ✅ 고객 후기 이미지 생성 함수 (Canvas + AI 배경)
const generateReviewImage = (reviews: Array<{ rating: number; text: string; author: string }>, designPreset: DesignPreset, bgImageUrl?: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    const safeReviews = reviews.length > 0 ? reviews : [{ rating: 5, text: '만족스러운 품질과 사용감이 인상적입니다.', author: '고객**' }];
    const theme = designPreset.reviewTheme;

    const drawRoundRect = (x: number, y: number, width: number, height: number, radius: number) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    };

    const drawWrappedText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) => {
        const chars = text.split('');
        let line = '';
        let lineY = y;
        let lineCount = 0;

        for (let i = 0; i < chars.length; i++) {
            const testLine = line + chars[i];
            if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
                ctx.fillText(line, x, lineY);
                line = chars[i];
                lineY += lineHeight;
                lineCount++;
                if (lineCount >= maxLines - 1) {
                    const remaining = chars.slice(i + 1).join('');
                    if (remaining.length > 0) {
                        while (ctx.measureText(line + '...').width > maxWidth && line.length > 0) {
                            line = line.slice(0, -1);
                        }
                        line += '...';
                    }
                    break;
                }
            } else {
                line = testLine;
            }
        }

        ctx.fillText(line, x, lineY);
    };

    const bgGradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bgGradient.addColorStop(0, theme.bgStart);
    bgGradient.addColorStop(0.48, theme.bgMid);
    bgGradient.addColorStop(1, theme.bgEnd);
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    try {
        if (bgImageUrl) {
            const img = new window.Image();
            img.src = bgImageUrl;
            ctx.globalAlpha = 0.12;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
        }
    } catch {
        ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.beginPath();
    ctx.arc(735, 145, 170, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.beginPath();
    ctx.arc(120, 830, 210, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 18px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'left';
    const tagW = Math.max(138, ctx.measureText(theme.tag).width + 42);
    drawRoundRect(64, 58, tagW, 42, 21);
    ctx.fillStyle = theme.badgeBg;
    ctx.fill();
    ctx.fillStyle = theme.badgeText;
    ctx.fillText(theme.tag, 86, 85);

    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 52px "Noto Sans KR", sans-serif';
    ctx.fillText('고객이 먼저 알아본', 64, 155);
    ctx.fillText('만족감의 차이', 64, 218);

    const avgRating = safeReviews.reduce((sum, r) => sum + r.rating, 0) / safeReviews.length;
    ctx.fillStyle = theme.muted;
    ctx.font = '24px "Noto Sans KR", sans-serif';
    ctx.fillText(`평균 ${avgRating.toFixed(1)}점 · 실제 사용 후기 ${safeReviews.length}건`, 66, 270);

    ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    drawRoundRect(566, 72, 230, 126, 28);
    ctx.fillStyle = theme.cardBg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(avgRating.toFixed(1), 681, 124);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = theme.rating;
    ctx.fillText('★'.repeat(Math.round(avgRating)), 681, 164);

    const cardX = 64;
    const cardW = canvas.width - 128;
    const cardH = 178;
    let yOffset = 335;

    safeReviews.slice(0, 3).forEach((review, idx) => {
        ctx.shadowColor = 'rgba(15, 23, 42, 0.11)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 12;
        drawRoundRect(cardX, yOffset, cardW, cardH, 28);
        ctx.fillStyle = theme.cardBg;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        const accentGradient = ctx.createLinearGradient(cardX, yOffset, cardX, yOffset + cardH);
        accentGradient.addColorStop(0, theme.accentStart);
        accentGradient.addColorStop(1, theme.accentEnd);
        drawRoundRect(cardX, yOffset, 8, cardH, 4);
        ctx.fillStyle = accentGradient;
        ctx.fill();

        ctx.strokeStyle = 'rgba(226, 232, 240, 0.95)';
        ctx.lineWidth = 1.5;
        drawRoundRect(cardX, yOffset, cardW, cardH, 28);
        ctx.stroke();

        ctx.fillStyle = theme.rating;
        ctx.font = 'bold 23px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('★'.repeat(review.rating), cardX + 34, yOffset + 44);

        ctx.fillStyle = theme.quote;
        ctx.font = 'bold 46px Georgia, serif';
        ctx.fillText('“', cardX + cardW - 92, yOffset + 58);

        ctx.fillStyle = theme.body;
        ctx.font = 'bold 25px "Noto Sans KR", sans-serif';
        drawWrappedText(review.text, cardX + 34, yOffset + 88, cardW - 96, 34, 2);

        const authorText = review.author || '고객**';
        ctx.font = 'bold 19px "Noto Sans KR", sans-serif';
        const badgeW = Math.max(102, ctx.measureText(authorText).width + 42);
        drawRoundRect(cardX + cardW - badgeW - 28, yOffset + cardH - 56, badgeW, 34, 17);
        ctx.fillStyle = theme.bgMid;
        ctx.fill();
        ctx.fillStyle = theme.muted;
        ctx.textAlign = 'center';
        ctx.fillText(authorText, cardX + cardW - badgeW / 2 - 28, yOffset + cardH - 33);

        yOffset += cardH + 32;
    });

    return canvas.toDataURL('image/png');
};

// ✅ 제품 정보 및 관리방법 이미지 생성 함수
const generateProductInfoImage = (data: {
    material: string;
    origin: string;
    manufacturer: string;
    washingMethod: string;
    precautions: string;
}, designPreset: DesignPreset): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;
    const theme = designPreset.reviewTheme;

    fillPresetBackground(ctx, canvas.width, canvas.height, designPreset);

    const accent = ctx.createLinearGradient(62, 0, canvas.width - 62, 0);
    accent.addColorStop(0, theme.accentStart);
    accent.addColorStop(1, theme.accentEnd);
    ctx.fillStyle = accent;
    drawCanvasRoundRect(ctx, 62, 68, canvas.width - 124, 8, 4);
    ctx.fill();

    ctx.fillStyle = theme.badgeBg;
    drawCanvasRoundRect(ctx, 66, 118, 184, 42, 21);
    ctx.fill();
    ctx.fillStyle = theme.badgeText;
    ctx.font = 'bold 18px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRODUCT INFO', 158, 139);

    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 48px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('제품 정보 및', 64, 236);
    ctx.fillText('관리방법', 64, 292);

    ctx.fillStyle = theme.muted;
    ctx.font = '23px "Noto Sans KR", sans-serif';
    ctx.fillText('구매 전 확인이 필요한 기본 정보를 정리했습니다.', 66, 346);

    const items = [
        ['소재', data.material],
        ['원산지', data.origin],
        ['제조사', data.manufacturer],
        ['세탁방법', data.washingMethod],
        ['주의사항', data.precautions],
    ].filter(([, value]) => value.trim());

    const safeItems = items.length > 0
        ? items
        : [['안내', '입력된 제품 정보가 없습니다. 필요 정보를 입력한 뒤 다시 생성해 주세요.']];

    let yPos = 420;
    safeItems.slice(0, 5).forEach(([label, value]) => {
        const cardH = label === '세탁방법' || label === '주의사항' ? 104 : 86;
        ctx.shadowColor = designPreset.defaultTextColor === '#ffffff' ? 'rgba(0, 0, 0, 0.30)' : 'rgba(15, 23, 42, 0.10)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 10;
        drawCanvasRoundRect(ctx, 64, yPos, canvas.width - 128, cardH, 22);
        ctx.fillStyle = theme.cardBg;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = accent;
        drawCanvasRoundRect(ctx, 92, yPos + 24, 112, 36, 18);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 148, yPos + 42);

        ctx.fillStyle = theme.body;
        ctx.font = '23px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        drawCanvasWrappedText(ctx, value, 232, yPos + 48, canvas.width - 320, 30, cardH > 90 ? 2 : 1);
        yPos += cardH + 22;
    });

    ctx.fillStyle = theme.muted;
    ctx.font = '20px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('상품 판매 전 실제 표시 기준과 필수 고지사항을 확인하세요.', canvas.width / 2, canvas.height - 74);

    return canvas.toDataURL('image/png');
};

const generateSizeChartImage = (
    gender: 'women' | 'men',
    data: Record<string, Record<string, string>>,
    designPreset: DesignPreset
): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1422;
    const ctx = canvas.getContext('2d')!;
    const theme = designPreset.reviewTheme;
    const isDarkTheme = designPreset.defaultTextColor === '#ffffff';
    const lineColor = isDarkTheme ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.12)';
    const softFill = isDarkTheme ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.035)';
    const shadowColor = isDarkTheme ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.12)';

    const drawRoundRect = (x: number, y: number, width: number, height: number, radius: number) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    };

    const hexToRgb = (hex: string) => {
        const normalized = hex.replace('#', '');
        if (normalized.length !== 6) return null;
        const value = Number.parseInt(normalized, 16);
        if (Number.isNaN(value)) return null;
        return {
            r: (value >> 16) & 255,
            g: (value >> 8) & 255,
            b: value & 255,
        };
    };

    const getReadableText = (hex: string) => {
        const rgb = hexToRgb(hex);
        if (!rgb) return '#ffffff';
        const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        return brightness > 174 ? theme.heading : '#ffffff';
    };

    const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, theme.bgStart);
    background.addColorStop(0.5, theme.bgMid);
    background.addColorStop(1, theme.bgEnd);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const topAccent = ctx.createLinearGradient(56, 0, canvas.width - 56, 0);
    topAccent.addColorStop(0, theme.accentStart);
    topAccent.addColorStop(1, theme.accentEnd);
    ctx.fillStyle = topAccent;
    drawRoundRect(56, 74, canvas.width - 112, 8, 4);
    ctx.fill();

    const sizes = gender === 'women' ? ['55', '66', '77', '88'] : ['95', '100', '105', '110'];
    const columns = ['사이즈', '어깨넓이', '가슴넓이', '소매길이', '총장'];
    const startX = 54;
    const tableWidth = canvas.width - 108;
    const headerHeight = 82;
    const rowHeight = 94;
    const firstColWidth = 118;
    const dataColWidth = (tableWidth - firstColWidth) / 4;
    const tableHeight = headerHeight + rowHeight * sizes.length;
    const startY = 410;

    ctx.fillStyle = theme.badgeBg;
    drawRoundRect(58, 112, 178, 42, 21);
    ctx.fill();
    ctx.fillStyle = theme.badgeText;
    ctx.font = 'bold 19px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SIZE GUIDE', 147, 133);

    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 62px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('사이즈 가이드', 58, 234);

    ctx.font = '24px "Noto Sans KR", sans-serif';
    ctx.fillStyle = theme.muted;
    ctx.fillText(`${gender === 'women' ? '여성' : '남성'} 의류 기준 · 단면 측정(cm)`, 60, 286);
    ctx.fillText('측정 방법에 따라 1~3cm 오차가 있을 수 있습니다.', 60, 324);

    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 16;
    drawRoundRect(startX, startY, tableWidth, tableHeight, 30);
    ctx.fillStyle = theme.cardBg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    const headerGradient = ctx.createLinearGradient(startX, startY, startX + tableWidth, startY);
    headerGradient.addColorStop(0, theme.accentStart);
    headerGradient.addColorStop(1, theme.accentEnd);
    drawRoundRect(startX, startY, tableWidth, headerHeight, 30);
    ctx.fillStyle = headerGradient;
    ctx.fill();
    ctx.fillRect(startX, startY + 38, tableWidth, headerHeight - 38);

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    drawRoundRect(startX, startY, tableWidth, tableHeight, 30);
    ctx.stroke();

    ctx.fillStyle = getReadableText(theme.accentStart);
    ctx.font = 'bold 22px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let xOffset = startX;
    columns.forEach((col, i) => {
        const width = i === 0 ? firstColWidth : dataColWidth;
        ctx.fillText(col, xOffset + width / 2, startY + headerHeight / 2);
        xOffset += width;
    });

    sizes.forEach((size, rowIndex) => {
        const y = startY + headerHeight + rowHeight * rowIndex;
        if (rowIndex % 2 === 1) {
            ctx.fillStyle = softFill;
            ctx.fillRect(startX, y, tableWidth, rowHeight);
        }

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX + 24, y);
        ctx.lineTo(startX + tableWidth - 24, y);
        ctx.stroke();

        const rowData = data[size] || {};
        const values = [size, rowData.shoulder || '-', rowData.chest || '-', rowData.sleeve || '-', rowData.length || '-'];
        let cellX = startX;
        values.forEach((value, idx) => {
            const width = idx === 0 ? firstColWidth : dataColWidth;
            ctx.fillStyle = idx === 0 ? theme.heading : theme.body;
            ctx.font = `${idx === 0 ? 'bold ' : ''}25px "Noto Sans KR", sans-serif`;
            ctx.fillText(value, cellX + width / 2, y + rowHeight / 2);
            cellX += width;
        });
    });

    const guideY = startY + tableHeight + 72;
    const guideItems = [
        ['단면 측정', '상품을 평평하게 놓고 잰 기준입니다.'],
        ['오차 범위', '원단과 측정 위치에 따라 1~3cm 차이가 날 수 있습니다.'],
        ['추천 확인', '평소 착용 상품과 실측을 비교해 선택해 주세요.'],
    ];

    ctx.fillStyle = theme.cardBg;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    drawRoundRect(58, guideY, canvas.width - 116, 278, 28);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = theme.heading;
    ctx.font = 'bold 30px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('측정 안내', 96, guideY + 58);

    guideItems.forEach(([label, value], idx) => {
        const itemY = guideY + 104 + idx * 56;
        ctx.fillStyle = theme.badgeBg;
        drawRoundRect(96, itemY - 28, 104, 34, 17);
        ctx.fill();
        ctx.fillStyle = theme.badgeText;
        ctx.font = 'bold 17px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, 148, itemY - 11);
        ctx.fillStyle = theme.body;
        ctx.font = '22px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(value, 224, itemY - 9);
    });

    ctx.fillStyle = theme.muted;
    ctx.font = '20px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${designPreset.label} 톤앤매너에 맞춘 사이즈 정보`, canvas.width / 2, canvas.height - 92);

    return canvas.toDataURL('image/png');
};

// ✅ 이미지 품질 검증 함수
const validateImageQuality = (imageUrl: string): Promise<{ isValid: boolean; reason?: string }> => {
    return new Promise((resolve) => {
        if (!imageUrl || imageUrl === 'undefined') {
            resolve({ isValid: false, reason: '이미지 URL이 유효하지 않습니다.' });
            return;
        }

        const img = new window.Image();
        img.onload = () => {
            // 최소 크기 검증 (너무 작은 이미지 방지)
            if (img.width < 400 || img.height < 400) {
                resolve({ isValid: false, reason: `이미지 크기가 너무 작습니다 (${img.width}x${img.height})` });
                return;
            }

            // 비율 검증 (너무 극단적인 비율 방지)
            const ratio = img.width / img.height;
            if (ratio < 0.3 || ratio > 3) {
                resolve({ isValid: false, reason: `이미지 비율이 비정상적입니다 (${ratio.toFixed(2)})` });
                return;
            }

            // Canvas로 이미지 데이터 분석
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(img.width, 200);
            canvas.height = Math.min(img.height, 200);
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const pixels = imageData.data;

                // 완전히 검은색/흰색만 있는 이미지 체크
                let allBlack = true;
                let allWhite = true;
                for (let i = 0; i < pixels.length; i += 4) {
                    const r = pixels[i];
                    const g = pixels[i + 1];
                    const b = pixels[i + 2];
                    if (r > 10 || g > 10 || b > 10) allBlack = false;
                    if (r < 245 || g < 245 || b < 245) allWhite = false;
                }

                if (allBlack) {
                    resolve({ isValid: false, reason: '이미지가 완전히 검은색입니다.' });
                    return;
                }
                if (allWhite) {
                    resolve({ isValid: false, reason: '이미지가 완전히 흰색입니다.' });
                    return;
                }

                resolve({ isValid: true });
            } catch (e) {
                // Canvas 데이터 분석 실패시에도 기본적으로 통과
                resolve({ isValid: true });
            }
        };

        img.onerror = () => {
            resolve({ isValid: false, reason: '이미지 로드에 실패했습니다.' });
        };

        img.src = imageUrl;
    });
};

// AI 이미지를 860px 고정 상세페이지 컷으로 리사이즈 후 한글 텍스트 Canvas 덧씌우기
const TARGET_WIDTH = DETAIL_CANVAS_WIDTH;

// 선택 가능한 문구 색상 팔레트 (라벨/채움색)
export const TEXT_COLOR_OPTIONS = [
    { key: 'black',  label: '검정',   fill: '#1a1a1a' },
    { key: 'white',  label: '흰색',   fill: '#ffffff' },
    { key: 'red',    label: '빨강',   fill: '#dc2626' },
    { key: 'orange', label: '주황',   fill: '#f97316' },
    { key: 'yellow', label: '노랑',   fill: '#facc15' },
    { key: 'green',  label: '초록',   fill: '#16a34a' },
    { key: 'blue',   label: '파랑',   fill: '#2563eb' },
    { key: 'pink',   label: '분홍',   fill: '#ec4899' },
] as const;

// 채움 색의 명도에 따라 가독성 좋은 외곽선 색을 자동 산출
const getContrastStroke = (hexColor: string): string => {
    const h = hexColor.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    // ITU-R BT.601 휘도
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
};

// 자동 계산되는 기본 크기에 곱할 배율 프리셋
export const FONT_SCALE_OPTIONS = [
    { key: 'sm', label: '작게',     value: 0.8 },
    { key: 'md', label: '보통',     value: 1.0 },
    { key: 'lg', label: '크게',     value: 1.2 },
    { key: 'xl', label: '아주크게', value: 1.4 },
    { key: 'xxl', label: '초대형',   value: INTRO_DETAIL_FONT_SCALE },
] as const;

const overlayTextOnImage = (
    imageUrl: string,
    keyMessage: string,
    position: 'top' | 'middle' | 'bottom',
    textColor: string = '#1a1a1a',
    fontScale: number = DEFAULT_DETAIL_FONT_SCALE,
    layoutHeight: DetailLayoutHeight = 1529
): Promise<string> => {
    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => {
            const targetHeight = normalizeLayoutHeight(layoutHeight, 1529);
            const canvas = document.createElement('canvas');
            canvas.width = TARGET_WIDTH;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d')!;

            const imgRatio = img.width / img.height;
            const canvasRatio = TARGET_WIDTH / targetHeight;
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (imgRatio > canvasRatio) {
                sh = img.height;
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                sw = img.width;
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, targetHeight);

            if (!keyMessage.trim()) {
                resolve(canvas.toDataURL('image/png'));
                return;
            }

            const lines = keyMessage.split('\n').filter(l => l.trim());
            const isLightText = getContrastStroke(textColor) === '#1a1a1a';
            const shade = position === 'bottom'
                ? ctx.createLinearGradient(0, targetHeight * 0.52, 0, targetHeight)
                : position === 'middle'
                    ? ctx.createLinearGradient(0, targetHeight * 0.18, 0, targetHeight * 0.82)
                    : ctx.createLinearGradient(0, 0, 0, targetHeight * 0.44);
            const shadeColor = isLightText ? '0, 0, 0' : '255, 255, 255';
            if (position === 'top') {
                shade.addColorStop(0, `rgba(${shadeColor}, ${isLightText ? 0.36 : 0.52})`);
                shade.addColorStop(1, `rgba(${shadeColor}, 0)`);
            } else if (position === 'middle') {
                shade.addColorStop(0, `rgba(${shadeColor}, 0)`);
                shade.addColorStop(0.5, `rgba(${shadeColor}, ${isLightText ? 0.32 : 0.48})`);
                shade.addColorStop(1, `rgba(${shadeColor}, 0)`);
            } else {
                shade.addColorStop(0, `rgba(${shadeColor}, 0)`);
                shade.addColorStop(1, `rgba(${shadeColor}, ${isLightText ? 0.42 : 0.58})`);
            }
            ctx.fillStyle = shade;
            if (position === 'bottom') {
                ctx.fillRect(0, targetHeight * 0.52, TARGET_WIDTH, targetHeight * 0.48);
            } else if (position === 'middle') {
                ctx.fillRect(0, targetHeight * 0.18, TARGET_WIDTH, targetHeight * 0.64);
            } else {
                ctx.fillRect(0, 0, TARGET_WIDTH, targetHeight * 0.44);
            }

            const x = 68;
            const maxWidth = TARGET_WIDTH - 136;
            const baseFontSize = position === 'top' ? 58 : 64;
            let fontSize = Math.round(baseFontSize * fontScale);
            const minFontSize = 34;

            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            while (fontSize > minFontSize) {
                ctx.font = `900 ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
                const widest = Math.max(...lines.map(line => ctx.measureText(line).width));
                if (widest <= maxWidth) break;
                fontSize -= 2;
            }

            const lineHeight = Math.round(fontSize * 1.18);
            const totalTextHeight = lines.length * lineHeight;
            let startY = 86;
            if (position === 'middle') {
                startY = Math.round((targetHeight - totalTextHeight) / 2);
            } else if (position === 'bottom') {
                startY = Math.round(targetHeight - totalTextHeight - 150);
            }

            ctx.shadowColor = isLightText ? 'rgba(0, 0, 0, 0.42)' : 'rgba(255, 255, 255, 0.72)';
            ctx.shadowBlur = isLightText ? 14 : 10;
            ctx.shadowOffsetY = isLightText ? 3 : 2;
            ctx.fillStyle = textColor;
            ctx.font = `900 ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;

            lines.forEach((line, i) => {
                ctx.fillText(line, x, startY + i * lineHeight);
            });

            ctx.shadowColor = 'transparent';
            const accentY = startY + totalTextHeight + 36;
            ctx.fillStyle = textColor;
            ctx.globalAlpha = 0.76;
            drawCanvasRoundRect(ctx, x, accentY, 68, 4, 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => {
            const canvas = document.createElement('canvas');
            canvas.width = TARGET_WIDTH;
            canvas.height = layoutHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, TARGET_WIDTH, layoutHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('이미지 로드 실패', TARGET_WIDTH / 2, layoutHeight / 2);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = imageUrl;
    });
};

const getRenderableKeyMessage = (segment: any): string => {
    const message = String(segment.keyMessage || '').trim();
    if (message) return segment.keyMessage;
    const title = String(segment.title || '상품 포인트').trim();
    return `${title.slice(0, 18)}\n확인해보세요`;
};

const getSegmentPreviewSize = (segment: any, index: number = 0, total: number = 1) => {
    if (segment?.staticImage) {
        const id = String(segment.id || '');
        if (id.startsWith('size-chart-')) return { width: 800, height: 1422 };
        return { width: DETAIL_CANVAS_WIDTH, height: 1000 };
    }

    return {
        width: DETAIL_CANVAS_WIDTH,
        height: getSegmentLayoutHeight(segment, index, total),
    };
};

export const DetailPlanner: React.FC = () => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
    const [info, setInfo] = useState<DetailInputInfo>({
        name: '',
        category: '',
        target: '',
        imageInstruction: '',
        combinationType: 'single' as CombinationType,
        designPreset: 'premium' as DesignPresetKey,
        conversionEnabled: true,
        conversionMode: 'auto',
        modelGender: 'auto',
        modelAge: 'auto',
        shotPreference: 'auto',
    });
    const [length, setLength] = useState<number | 'auto'>('auto');
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [includeSizeChart, setIncludeSizeChart] = useState(false);
    const [sizeGender, setSizeGender] = useState<'women' | 'men'>('women');
    const [sizeData, setSizeData] = useState<Record<string, Record<string, string>>>({});
    const [includeProductInfo, setIncludeProductInfo] = useState(false);
    const [productInfoData, setProductInfoData] = useState({
        material: '',
        origin: '',
        manufacturer: '',
        washingMethod: '',
        precautions: ''
    });
    const [includeCertificate, setIncludeCertificate] = useState(false);
    const [certData, setCertData] = useState({ type: 'KC 안전인증', number: '', date: '' });
    const [includeReviews, setIncludeReviews] = useState(false);
    const [reviewsData, setReviewsData] = useState([
        { rating: 5, text: '일주일 사용해봤는데 정말 만족스러워요. 품질이 기대 이상입니다.', author: '김**' },
        { rating: 5, text: '배송도 빠르고 실물이 사진보다 더 예뻐요. 가격 대비 훌륭합니다.', author: '이**' },
        { rating: 4, text: '사용감이 좋아서 가족들에게도 추천했어요. 재구매 의사 100%입니다.', author: '박**' }
    ]);
    const [segments, setSegments] = useState<any[]>([]);
    const [draggedSegmentIndex, setDraggedSegmentIndex] = useState<number | null>(null);
    const [previewSegmentIndex, setPreviewSegmentIndex] = useState<number | null>(null);
    const [activeResultIndex, setActiveResultIndex] = useState(0);

    const moveSegment = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
        setSegments(prev => {
            if (fromIndex >= prev.length || toIndex >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    const handleSegmentDragStart = (e: DragEvent<HTMLElement>, index: number) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setDraggedSegmentIndex(index);
    };

    const handleSegmentDragOver = (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleSegmentDrop = (index: number) => {
        const sourceIndex = draggedSegmentIndex ?? Number.NaN;
        if (Number.isNaN(sourceIndex)) return;
        moveSegment(sourceIndex, index);
        setDraggedSegmentIndex(null);
    };

    const handleSegmentDragEnd = () => {
        setDraggedSegmentIndex(null);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                setReferenceImages(prev => [...prev, reader.result as string]);
            };
            reader.readAsDataURL(file as Blob);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeImage = (index: number) => {
        setReferenceImages(prev => prev.filter((_, i) => i !== index));
    };

    const handlePlan = async () => {
        if (!info.name) {
            alert("상품명을 입력해주세요.");
            return;
        }
        const requiredImageCount = 1;
        if (referenceImages.length < requiredImageCount) {
            alert(`최소 ${requiredImageCount}장 이상의 실제 제품 사진이 필요합니다.`);
            return;
        }
        setLoading(true);
        try {
            const selectedPreset = DESIGN_PRESETS[info.designPreset];
            const effectiveConversionMode = getEffectiveConversionMode(
                info.conversionEnabled,
                info.conversionMode,
                info.combinationType,
                info.designPreset
            );
            const combinationCount = getCombinationCount(info.combinationType);
            const plannedSegments = await planDetail({
                ...info,
                length,
                combinationCount,
                designPreset: selectedPreset,
                effectiveConversionMode,
            });
            const segmentsWithCombinationIntro = info.combinationType === 'single'
                ? plannedSegments
                : plannedSegments.length > 0
                    ? [
                        {
                            ...plannedSegments[0],
                            ...buildCombinationIntroSegment(info.combinationType, info.name),
                        },
                        ...plannedSegments.slice(1),
                    ]
                    : [buildCombinationIntroSegment(info.combinationType, info.name)];
            
            // 각 세그먼트에 텍스트 위치와 캔버스 높이 기본값 설정
            const totalPlannedSegments = segmentsWithCombinationIntro.length;
            const mappedSegments = segmentsWithCombinationIntro.map((seg: any, index: number) => {
                const isStyleSection = seg.title.includes('스타일') || 
                                     seg.title.includes('코디') || 
                                     seg.title.includes('연출');
                const isCombinationIntro = info.combinationType !== 'single' && seg.title.includes('조합 인트로');
                const conversionRole = seg.conversionRole || getFallbackConversionRole(index, info.combinationType);
                const sectionType = seg.sectionType || getFallbackSectionType(index, info.combinationType);
                const layoutHeight = normalizeLayoutHeight(
                    seg.layoutHeight,
                    getFallbackLayoutHeight({ ...seg, conversionRole, sectionType }, index, totalPlannedSegments)
                );
                return {
                    ...seg,
                    conversionRole,
                    sectionType,
                    layoutHeight,
                    shotType: seg.shotType || getAutoShotType({ ...seg, conversionRole, sectionType }, index),
                    textPosition: index === 0 || isCombinationIntro || isStyleSection ? 'top' : 'bottom',
                    textColor: selectedPreset.defaultTextColor,
                    fontScale: isCombinationIntro ? INTRO_DETAIL_FONT_SCALE : DEFAULT_DETAIL_FONT_SCALE,
                    rawImageUrl: ''
                };
            });

            const introSegments = mappedSegments.slice(0, 1);
            const bodySegments = mappedSegments.slice(1);
            const afterIntroSegments: any[] = [];
            const bottomSegments: any[] = [];

            // 사이즈표는 옵션 템플릿 중 가장 먼저, 인트로 바로 다음에 배치
            if (includeSizeChart) {
                const sizeChartUrl = generateSizeChartImage(sizeGender, sizeData, selectedPreset);
                afterIntroSegments.push({
                    id: 'size-chart-' + Date.now(),
                    title: '사이즈 가이드',
                    logicalSections: ['정보 제공', '사이즈표'],
                    keyMessage: '상세 사이즈를 확인하세요.',
                    visualPrompt: 'Size chart generated automatically.',
                    imageUrl: sizeChartUrl,
                    rawImageUrl: sizeChartUrl,
                    textPosition: 'bottom',
                    textColor: selectedPreset.defaultTextColor,
                    fontScale: DEFAULT_DETAIL_FONT_SCALE,
                    isGenerating: false,
                    staticImage: true
                });
            }

            // 고객 후기는 사이즈표 다음, 인트로 영역의 신뢰 요소로 고정 배치
            if (includeReviews) {
                // AI로 배경 이미지 생성
                const reviewBgUrl = await generateReviewImageWithAI(reviewsData, info.name, info.category, referenceImages, selectedPreset);

                // 배경과 후기를 합성
                const reviewUrl = await new Promise<string>((resolve) => {
                    if (reviewBgUrl) {
                        const img = new window.Image();
                        img.onload = () => {
                            const finalUrl = generateReviewImage(reviewsData, selectedPreset, reviewBgUrl);
                            resolve(finalUrl);
                        };
                        img.onerror = () => {
                            // 배경 로드 실패 시 기본 배경 사용
                            const finalUrl = generateReviewImage(reviewsData, selectedPreset);
                            resolve(finalUrl);
                        };
                        img.src = reviewBgUrl;
                    } else {
                        const finalUrl = generateReviewImage(reviewsData, selectedPreset);
                        resolve(finalUrl);
                    }
                });

                afterIntroSegments.push({
                    id: 'reviews-' + Date.now(),
                    title: '고객 후기',
                    logicalSections: ['신뢰', '리뷰'],
                    keyMessage: '실제 고객들의 생생한 후기',
                    visualPrompt: 'Customer reviews generated automatically.',
                    imageUrl: reviewUrl,
                    rawImageUrl: reviewUrl,
                    textPosition: 'bottom',
                    textColor: selectedPreset.defaultTextColor,
                    fontScale: DEFAULT_DETAIL_FONT_SCALE,
                    isGenerating: false,
                    staticImage: true
                });
            }

            // 인증서는 본문 이후에 배치하되, 제품 정보 및 관리방법보다는 위에 둔다
            if (includeCertificate) {
                const certUrl = generateCertificateImage(
                    certData.type,
                    certData.number || 'CB-XXX-XXXXXX',
                    certData.date || new Date().toISOString().split('T')[0],
                    selectedPreset
                );
                bottomSegments.push({
                    id: 'certificate-' + Date.now(),
                    title: '품질 인증',
                    logicalSections: ['신뢰', '인증서'],
                    keyMessage: '안전하고 검증된 제품',
                    visualPrompt: 'Certificate generated automatically.',
                    imageUrl: certUrl,
                    rawImageUrl: certUrl,
                    textPosition: 'bottom',
                    textColor: selectedPreset.defaultTextColor,
                    fontScale: DEFAULT_DETAIL_FONT_SCALE,
                    isGenerating: false,
                    staticImage: true
                });
            }

            // 제품 정보 및 관리방법은 상세페이지 맨 하단에 고정
            if (includeProductInfo) {
                const productInfoUrl = generateProductInfoImage(productInfoData, selectedPreset);
                bottomSegments.push({
                    id: 'product-info-' + Date.now(),
                    title: '제품 정보 및 관리방법',
                    logicalSections: ['정보 제공', '관리'],
                    keyMessage: '제품 정보를 확인하세요',
                    visualPrompt: 'Product information generated automatically.',
                    imageUrl: productInfoUrl,
                    rawImageUrl: productInfoUrl,
                    textPosition: 'bottom',
                    textColor: selectedPreset.defaultTextColor,
                    fontScale: DEFAULT_DETAIL_FONT_SCALE,
                    isGenerating: false,
                    staticImage: true
                });
            }

            setSegments([...introSegments, ...afterIntroSegments, ...bodySegments, ...bottomSegments]);
            setActiveResultIndex(0);
            setStep(2);
        } catch (e) {
            console.error(e);
            alert("기획 생성에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateAll = async (regenerate = false) => {
        setStep(3);
        setActiveResultIndex(0);
        const selectedPreset = DESIGN_PRESETS[info.designPreset];

        // 병렬 생성을 위한 인덱스 배열 생성
        const indicesToGenerate = segments
            .map((seg, idx) => ({ seg, idx }))
            .filter(({ seg }) => !seg.staticImage && (regenerate || !seg.imageUrl))
            .map(({ idx }) => idx);

        // 모든 생성할 이미지를 isGenerating true로 설정
        setSegments(prev => {
            const newSegs = [...prev];
            indicesToGenerate.forEach(i => {
                newSegs[i] = { ...newSegs[i], isGenerating: true };
            });
            return newSegs;
        });

        // 병렬로 모든 이미지 생성
        const generatePromises = indicesToGenerate.map(async (i) => {
            const MAX_RETRY = 2; // 최대 재시도 횟수
            let attempt = 0;

            while (attempt <= MAX_RETRY) {
                try {
                    const layoutHeight = getSegmentLayoutHeight(segments[i], i, segments.length);
                    const prompt = buildDetailImagePrompt({ ...segments[i], layoutHeight }, i, info, selectedPreset);

                    const rawImageUrl = await generateImage(prompt, referenceImages, getGenerationAspectRatio(layoutHeight));

                    // ✅ 이미지 품질 검증
                    const validation = await validateImageQuality(rawImageUrl);
                    if (!validation.isValid) {
                        console.warn(`이미지 ${i + 1} 품질 검증 실패 (시도 ${attempt + 1}/${MAX_RETRY + 1}): ${validation.reason}`);
                        if (attempt < MAX_RETRY) {
                            attempt++;
                            continue; // 재시도
                        } else {
                            throw new Error(`품질 검증 실패: ${validation.reason}`);
                        }
                    }

                    // AI가 한글 카피까지 포함한 완성형 이미지를 만들고, 앱은 860px 캔버스 정규화만 수행한다.
                    const imageUrl = await overlayTextOnImage(
                        rawImageUrl,
                        '',
                        segments[i].textPosition || 'bottom',
                        segments[i].textColor || '#1a1a1a',
                        segments[i].fontScale ?? DEFAULT_DETAIL_FONT_SCALE,
                        layoutHeight
                    );

                        setSegments(prev => {
                            const newSegs = [...prev];
                            newSegs[i] = { ...newSegs[i], layoutHeight, imageUrl, rawImageUrl, isGenerating: false, error: false, errorMessage: '' };
                            return newSegs;
                        });
                    setActiveResultIndex(i);
                    break; // 성공하면 루프 탈출
                } catch (e) {
                    console.error(`이미지 ${i + 1} 생성 실패 (시도 ${attempt + 1}/${MAX_RETRY + 1}):`, e);
                    if (attempt >= MAX_RETRY) {
                        setSegments(prev => {
                            const newSegs = [...prev];
                            newSegs[i] = { ...newSegs[i], isGenerating: false, error: true, errorMessage: String(e) };
                            return newSegs;
                        });
                    }
                    attempt++;
                }
            }
        });

        // 모든 이미지 생성 완료 대기
        await Promise.all(generatePromises);
    };

    const handleRegenerateSegment = async (index: number) => {
        const currentSegment = segments[index];
        if (!currentSegment || currentSegment.staticImage) return;

        setSegments(prev => {
            const newSegs = [...prev];
            newSegs[index] = { ...newSegs[index], isGenerating: true, error: false, errorMessage: '' };
            return newSegs;
        });

        try {
            const selectedPreset = DESIGN_PRESETS[info.designPreset];
            const layoutHeight = getSegmentLayoutHeight(currentSegment, index, segments.length);
            const prompt = buildDetailImagePrompt({ ...currentSegment, layoutHeight }, index, info, selectedPreset);
            const rawImageUrl = await generateImage(prompt, referenceImages, getGenerationAspectRatio(layoutHeight));
            const validation = await validateImageQuality(rawImageUrl);

            if (!validation.isValid) {
                throw new Error(`품질 검증 실패: ${validation.reason}`);
            }

            const imageUrl = await overlayTextOnImage(
                rawImageUrl,
                '',
                currentSegment.textPosition || 'bottom',
                currentSegment.textColor || '#1a1a1a',
                currentSegment.fontScale ?? DEFAULT_DETAIL_FONT_SCALE,
                layoutHeight
            );

            setSegments(prev => {
                const newSegs = [...prev];
                newSegs[index] = {
                    ...newSegs[index],
                    layoutHeight,
                    imageUrl,
                    rawImageUrl,
                    isGenerating: false,
                    error: false,
                    errorMessage: ''
                };
                return newSegs;
            });
            setActiveResultIndex(index);
        } catch (e) {
            console.error(`이미지 ${index + 1} 부분 재생성 실패:`, e);
            setSegments(prev => {
                const newSegs = [...prev];
                newSegs[index] = { ...newSegs[index], isGenerating: false, error: true, errorMessage: String(e) };
                return newSegs;
            });
        }
    };

    const handleDownloadAll = () => {
        segments.forEach((seg, idx) => {
            if (seg.imageUrl) {
                const a = document.createElement('a');
                a.href = seg.imageUrl;
                a.download = `detail_page_${idx + 1}.png`;
                a.click();
            }
        });
    };

    const effectiveConversionMode = getEffectiveConversionMode(
        info.conversionEnabled,
        info.conversionMode,
        info.combinationType,
        info.designPreset
    );
    const activeResultSegment = segments[activeResultIndex] ?? segments[0];
    const activeResultSize = activeResultSegment
        ? getSegmentPreviewSize(activeResultSegment, activeResultIndex, segments.length)
        : { width: DETAIL_CANVAS_WIDTH, height: 1200 };

    return (
        <div className="max-w-7xl mx-auto px-6 py-8">
            {/* Stepper */}
            <div className="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="bg-slate-950 px-7 py-6 text-white">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-200">Detail Page Studio</p>
                    <h2 className="mt-2 text-2xl font-black tracking-tight">상세페이지 제작</h2>
                </div>
            <div className="flex items-center justify-between px-7 py-5">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex items-center">
                        <div
                            onClick={() => {
                                // 이미 방문한 단계만 클릭 가능
                                if (s === 1 && step > 1) setStep(1);
                                if (s === 2 && step > 2) setStep(2);
                            }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all
                                ${step >= s ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}
                                ${(s === 1 && step > 1) || (s === 2 && step > 2) ? 'cursor-pointer hover:bg-blue-700 hover:scale-105' : 'cursor-default'}
                            `}
                        >
                            {s}
                        </div>
                        <div className="ml-3">
                            <p className={`text-sm font-medium ${step >= s ? 'text-slate-900' : 'text-slate-500'}`}>
                                {s === 1 ? '정보 입력' : s === 2 ? '전략 기획' : '이미지 생성'}
                            </p>
                            {(s === 1 && step > 1) || (s === 2 && step > 2) ? (
                                <p className="text-xs text-blue-500">클릭해서 수정</p>
                            ) : null}
                        </div>
                        {s < 3 && <ChevronRight className="w-5 h-5 mx-4 text-slate-300" />}
                    </div>
                ))}
            </div>
            </div>

            {step === 1 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="flex justify-between items-center px-8 py-6 border-b border-slate-100 bg-slate-50">
                        <div>
                            <p className="text-xs font-black tracking-[0.18em] text-blue-600 uppercase">Strategy Inputs</p>
                            <h2 className="text-xl font-black text-slate-900 mt-1">상품 정보 입력</h2>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-8">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">상품명 *</label>
                            <input type="text" value={info.name} onChange={e => setInfo({...info, name: e.target.value})} className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-colors" placeholder="예: 무중력 메모리폼 베개" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">카테고리 <span className="text-slate-400 font-normal">(선택)</span></label>
                            <input type="text" value={info.category} onChange={e => setInfo({...info, category: e.target.value})} className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-colors" placeholder="예: 리빙/침구" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">타겟 고객</label>
                            <input type="text" value={info.target} onChange={e => setInfo({...info, target: e.target.value})} className="w-full p-3.5 border border-slate-200 bg-slate-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-colors" placeholder="예: 20-30대 직장인 여성" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">디자인 스타일</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {(Object.entries(DESIGN_PRESETS) as Array<[DesignPresetKey, DesignPreset]>).map(([key, preset]) => {
                                    const selected = info.designPreset === key;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setInfo({ ...info, designPreset: key })}
                                            className={`text-left p-4 rounded-xl border transition-all ${selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300 bg-white'}`}
                                        >
                                            <div className={`font-bold mb-1 ${selected ? 'text-blue-700' : 'text-slate-800'}`}>{preset.label}</div>
                                            <div className="text-xs text-slate-500 leading-relaxed">{preset.description}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">선택한 스타일은 AI 문구, 이미지 분위기, 기본 문구 색상, 고객 후기 템플릿에 함께 적용됩니다.</p>
                        </div>
                        <div className="md:col-span-2">
                            <div className="flex items-center justify-between gap-4 mb-3">
                                <div>
                                    <label className="block text-sm font-bold text-slate-800">전환율 강화 모드</label>
                                    <p className="text-xs text-slate-500 mt-1">첫인상, 문제 해결, 구매 근거, 제품 디테일, 구매 안심 흐름을 자동으로 잡습니다.</p>
                                </div>
                                <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={info.conversionEnabled}
                                        onChange={e => setInfo({ ...info, conversionEnabled: e.target.checked })}
                                        className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                    />
                                    사용
                                </label>
                            </div>
                            <div className={`grid grid-cols-1 md:grid-cols-5 gap-2 ${info.conversionEnabled ? '' : 'opacity-45 pointer-events-none'}`}>
                                {CONVERSION_MODE_OPTIONS.map(option => {
                                    const selected = info.conversionMode === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setInfo({ ...info, conversionMode: option.value })}
                                            className={`text-left p-3 rounded-xl border transition-all ${selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300 bg-white'}`}
                                        >
                                            <div className={`text-sm font-bold mb-1 ${selected ? 'text-blue-700' : 'text-slate-800'}`}>{option.label}</div>
                                            <div className="text-[11px] text-slate-500 leading-relaxed">{option.desc}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            {info.conversionEnabled && (
                                <p className="text-xs text-blue-600 mt-2">
                                    현재 적용: {getConversionModeLabel(effectiveConversionMode)}
                                    {info.conversionMode === 'auto' && info.combinationType !== 'single' ? ' · 조합상품은 혜택형 흐름으로 자동 전환됩니다.' : ''}
                                </p>
                            )}
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                추가 색상 요청 <span className="text-slate-400 font-normal">(선택 - 입력하지 않으면 원본 색상만 유지)</span>
                            </label>
                            <input
                                type="text"
                                value={info.imageInstruction}
                                onChange={e => setInfo({...info, imageInstruction: e.target.value})}
                                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="예: 블루 색상도 추가해주세요 (입력 안하면 사진의 원본 색상만 사용)"
                            />
                            <p className="text-xs text-slate-500 mt-1">💡 빈칸으로 두면 업로드한 제품 사진의 색상만 그대로 유지됩니다.</p>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">상품 구성</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {COMBINATION_OPTIONS.map((option) => {
                                    const selected = info.combinationType === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setInfo({ ...info, combinationType: option.value })}
                                            className={`text-left p-4 rounded-xl border transition-all ${selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}`}
                                        >
                                            <div className={`font-bold mb-1 ${selected ? 'text-blue-700' : 'text-slate-800'}`}>{option.label}</div>
                                            <div className="text-xs text-slate-500">{option.desc}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            {info.combinationType !== 'single' && (
                                <p className="text-xs text-blue-600 mt-2">
                                    {info.combinationType} 선택 시 첫 장에 {info.combinationType} 문구가 들어가고, 제품 {getCombinationCountLabel(getCombinationCount(info.combinationType))}가 한 페이지에 함께 보이도록 생성합니다.
                                </p>
                            )}
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">레퍼런스 이미지 (최소 1장 필수)</label>
                            <div onClick={() => fileInputRef.current?.click()} className="border border-dashed border-slate-300 bg-slate-50 rounded-2xl p-8 text-center cursor-pointer hover:bg-white hover:border-blue-300 transition-colors">
                                <div className="flex flex-col items-center text-slate-500">
                                    <Upload className="w-8 h-8 mb-2 text-slate-400" />
                                    <p className="font-medium">클릭하여 제품 사진 업로드 (다중 선택 가능)</p>
                                    <p className="text-xs mt-1">JPG, PNG (최대 5MB)</p>
                                </div>
                                <input type="file" multiple ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                            </div>
                            {referenceImages.length > 0 && (
                                <div className="grid grid-cols-4 md:grid-cols-6 gap-4 mt-4">
                                    {referenceImages.map((img, idx) => (
                                        <div key={idx} className="relative aspect-square rounded-xl border border-slate-200 overflow-hidden group">
                                            <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                                            <button onClick={() => removeImage(idx)} className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">모델컷 안정화 옵션</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div>
                                    <p className="text-xs font-bold text-slate-600 mb-2">모델 성별</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {MODEL_GENDER_OPTIONS.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setInfo({ ...info, modelGender: option.value })}
                                                className={`py-2 px-2 rounded-lg border text-xs font-bold transition-colors ${info.modelGender === option.value ? 'border-blue-600 bg-white text-blue-700' : 'border-slate-200 bg-white/70 text-slate-500 hover:border-blue-300'}`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-600 mb-2">연령대</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {MODEL_AGE_OPTIONS.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setInfo({ ...info, modelAge: option.value })}
                                                className={`py-2 px-2 rounded-lg border text-xs font-bold transition-colors ${info.modelAge === option.value ? 'border-blue-600 bg-white text-blue-700' : 'border-slate-200 bg-white/70 text-slate-500 hover:border-blue-300'}`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-600 mb-2">컷 구도</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {SHOT_PREFERENCE_OPTIONS.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setInfo({ ...info, shotPreference: option.value })}
                                                className={`py-2 px-2 rounded-lg border text-xs font-bold transition-colors ${info.shotPreference === option.value ? 'border-blue-600 bg-white text-blue-700' : 'border-slate-200 bg-white/70 text-slate-500 hover:border-blue-300'}`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">자동 배정은 섹션 목적에 맞춰 전신, 반신, 클로즈업, 라이프스타일 컷을 나눠 지시합니다.</p>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">상세페이지 길이 (구조)</label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { val: 'auto', label: 'Auto (12~15)', desc: '전환형 마스터 구성' },
                                    { val: 5, label: '5장 (Short)', desc: '저관여/저가 집중형' },
                                    { val: 7, label: '7장 (Standard)', desc: '일반적인 구성' },
                                    { val: 9, label: '9장 (Long)', desc: '고관여/스토리텔링' },
                                    { val: 12, label: '12장 (CRO)', desc: '문제-해결-신뢰형' },
                                    { val: 15, label: '15장 (Master)', desc: '상위 1% 풀 구성' }
                                ].map(opt => (
                                    <div key={opt.val} onClick={() => setLength(opt.val as any)} className={`p-4 rounded-xl border cursor-pointer transition-all ${length === opt.val ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}`}>
                                        <div className="font-medium text-slate-800 mb-1">{opt.label}</div>
                                        <div className="text-xs text-slate-500">{opt.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="md:col-span-2 border-t border-slate-200 pt-6 mt-2">
                            <h3 className="text-lg font-bold text-slate-800 mb-4">추가 템플릿 옵션</h3>

                            {/* 사이즈표 */}
                            <div className="mb-6">
                                <label className="flex items-center text-sm font-bold text-slate-800 cursor-pointer mb-3">
                                    <input type="checkbox" checked={includeSizeChart} onChange={(e) => setIncludeSizeChart(e.target.checked)} className="mr-2 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                    사이즈표 추가하기
                                </label>
                            {includeSizeChart && (
                                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                                    <div className="flex gap-6 mb-4">
                                        <label className="flex items-center cursor-pointer">
                                            <input type="radio" name="gender" checked={sizeGender === 'women'} onChange={() => setSizeGender('women')} className="mr-2 w-4 h-4 text-blue-600" />
                                            <span className="font-medium text-slate-700">여성 (55, 66, 77, 88)</span>
                                        </label>
                                        <label className="flex items-center cursor-pointer">
                                            <input type="radio" name="gender" checked={sizeGender === 'men'} onChange={() => setSizeGender('men')} className="mr-2 w-4 h-4 text-blue-600" />
                                            <span className="font-medium text-slate-700">남성 (95, 100, 105, 110)</span>
                                        </label>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left text-slate-600">
                                            <thead className="text-xs text-slate-700 uppercase bg-slate-200 rounded-t-lg">
                                                <tr>
                                                    <th className="px-4 py-3 rounded-tl-lg text-center">사이즈</th>
                                                    <th className="px-4 py-3 text-center">어깨넓이</th>
                                                    <th className="px-4 py-3 text-center">가슴넓이</th>
                                                    <th className="px-4 py-3 text-center">소매길이</th>
                                                    <th className="px-4 py-3 rounded-tr-lg text-center">총장</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(sizeGender === 'women' ? ['55', '66', '77', '88'] : ['95', '100', '105', '110']).map((size) => (
                                                    <tr key={size} className="bg-white border-b border-slate-200">
                                                        <td className="px-4 py-3 font-bold text-slate-900 text-center">{size}</td>
                                                        {['shoulder', 'chest', 'sleeve', 'length'].map((field) => (
                                                            <td key={field} className="px-4 py-2">
                                                                <input type="text" placeholder="cm" value={sizeData[size]?.[field] || ''} onChange={(e) => { setSizeData(prev => ({ ...prev, [size]: { ...(prev[size] || {}), [field]: e.target.value } })); }} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-center" />
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                            </div>

                            {/* 제품 정보 및 관리방법 */}
                            <div className="mb-6">
                                <label className="flex items-center text-sm font-bold text-slate-800 cursor-pointer mb-3">
                                    <input type="checkbox" checked={includeProductInfo} onChange={(e) => setIncludeProductInfo(e.target.checked)} className="mr-2 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                    제품 정보 및 관리방법 추가하기
                                </label>
                                {includeProductInfo && (
                                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">소재</label>
                                            <input type="text" value={productInfoData.material} onChange={(e) => setProductInfoData({...productInfoData, material: e.target.value})} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 면 100%" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">원산지</label>
                                            <input type="text" value={productInfoData.origin} onChange={(e) => setProductInfoData({...productInfoData, origin: e.target.value})} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 대한민국" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">제조사</label>
                                            <input type="text" value={productInfoData.manufacturer} onChange={(e) => setProductInfoData({...productInfoData, manufacturer: e.target.value})} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: (주)ABC 컴퍼니" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">세탁방법</label>
                                            <textarea value={productInfoData.washingMethod} onChange={(e) => setProductInfoData({...productInfoData, washingMethod: e.target.value})} rows={2} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none resize-none" placeholder="예: 손세탁 권장, 세탁기 사용 시 세탁망 필수" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">주의사항</label>
                                            <textarea value={productInfoData.precautions} onChange={(e) => setProductInfoData({...productInfoData, precautions: e.target.value})} rows={2} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none resize-none" placeholder="예: 드라이클리닝 금지, 표백제 사용 금지" />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 인증서 */}
                            <div className="mb-6">
                                <label className="flex items-center text-sm font-bold text-slate-800 cursor-pointer mb-3">
                                    <input type="checkbox" checked={includeCertificate} onChange={(e) => setIncludeCertificate(e.target.checked)} className="mr-2 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                    품질 인증서 추가하기
                                </label>
                                {includeCertificate && (
                                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">인증 타입</label>
                                            <input type="text" value={certData.type} onChange={(e) => setCertData({...certData, type: e.target.value})} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: KC 안전인증" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">인증번호</label>
                                            <input type="text" value={certData.number} onChange={(e) => setCertData({...certData, number: e.target.value})} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: CB-XXX-XXXXXX" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">발급일자</label>
                                            <input type="date" value={certData.date} onChange={(e) => setCertData({...certData, date: e.target.value})} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 고객 후기 */}
                            <div className="mb-6">
                                <label className="flex items-center text-sm font-bold text-slate-800 cursor-pointer mb-3">
                                    <input type="checkbox" checked={includeReviews} onChange={(e) => setIncludeReviews(e.target.checked)} className="mr-2 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                    고객 후기 추가하기
                                </label>
                                {includeReviews && (
                                    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-slate-50 to-indigo-50/70 p-5 shadow-sm">
                                        <div className="flex items-start justify-between gap-4 mb-5">
                                            <div>
                                                <p className="text-[11px] font-black tracking-[0.18em] text-indigo-600 uppercase">Review Template</p>
                                                <p className="text-sm text-slate-500 mt-1">생성될 후기 섹션의 문장과 작성자 정보를 정리합니다.</p>
                                            </div>
                                            <span className="shrink-0 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold shadow-sm">
                                                {reviewsData.length}개 후기
                                            </span>
                                        </div>
                                        <div className="space-y-3">
                                            {reviewsData.map((review, idx) => (
                                                <div key={idx} className="relative rounded-2xl border border-white bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-black">
                                                                {idx + 1}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-800">고객 후기 {idx + 1}</p>
                                                                <p className="text-xs text-slate-400">상세페이지 신뢰도 섹션에 반영됩니다.</p>
                                                            </div>
                                                        </div>
                                                        {reviewsData.length > 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const newReviews = reviewsData.filter((_, i) => i !== idx);
                                                                    setReviewsData(newReviews);
                                                                }}
                                                                className="w-8 h-8 rounded-full border border-slate-200 bg-white text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-colors"
                                                                aria-label="후기 삭제"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                                                        <div className="md:col-span-2">
                                                            <label className="block text-xs font-bold text-slate-600 mb-1.5">별점</label>
                                                            <select value={review.rating} onChange={(e) => {
                                                                const newReviews = [...reviewsData];
                                                                newReviews[idx].rating = Number(e.target.value);
                                                                setReviewsData(newReviews);
                                                            }} className="w-full p-3 border border-slate-200 bg-slate-50 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-bold text-slate-800">
                                                                <option value={5}>5점</option>
                                                                <option value={4}>4점</option>
                                                                <option value={3}>3점</option>
                                                            </select>
                                                        </div>
                                                        <div className="md:col-span-7">
                                                            <label className="block text-xs font-bold text-slate-600 mb-1.5">후기 내용</label>
                                                            <input type="text" value={review.text} onChange={(e) => {
                                                                const newReviews = [...reviewsData];
                                                                newReviews[idx].text = e.target.value;
                                                                setReviewsData(newReviews);
                                                            }} className="w-full p-3 border border-slate-200 bg-slate-50 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-800" />
                                                        </div>
                                                        <div className="md:col-span-3">
                                                            <label className="block text-xs font-bold text-slate-600 mb-1.5">작성자</label>
                                                            <input type="text" value={review.author} onChange={(e) => {
                                                                const newReviews = [...reviewsData];
                                                                newReviews[idx].author = e.target.value;
                                                                setReviewsData(newReviews);
                                                            }} className="w-full p-3 border border-slate-200 bg-slate-50 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-800" />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => {
                                                setReviewsData([...reviewsData, { rating: 5, text: '', author: '고객**' }]);
                                            }}
                                            className="w-full mt-4 p-3.5 border border-dashed border-slate-300 rounded-xl bg-white/80 text-slate-700 hover:border-slate-900 hover:bg-slate-900 hover:text-white font-bold transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Upload className="w-4 h-4" />
                                            후기 추가하기
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mt-8 flex justify-end">
                        <button onClick={handlePlan} disabled={loading || referenceImages.length < 1} className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors">
                            {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Wand2 className="w-5 h-5 mr-2" />}
                            AI 기획 시작하기
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800">AI 기획안 검토</h2>
                            <p className="text-slate-500 mt-1">AI가 작성한 기획안을 확인하고 필요시 수정하세요. (총 {segments.length}장)</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setStep(1)} className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium py-3 px-6 rounded-xl flex items-center transition-colors">
                                <ChevronRight className="w-5 h-5 mr-2 rotate-180" />
                                이전 단계
                            </button>
                            <button onClick={() => handleGenerateAll(false)} className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl flex items-center transition-colors">
                                <ImageIcon className="w-5 h-5 mr-2" />
                                이미지 생성
                            </button>
                            {segments.some(s => s.imageUrl && !s.staticImage) && (
                                <button onClick={() => handleGenerateAll(true)} className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 px-6 rounded-xl flex items-center transition-colors">
                                    <ImageIcon className="w-5 h-5 mr-2" />
                                    전체 이미지 재생성
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-6">
                        {segments.map((seg, idx) => (
                            <div
                                key={seg.id}
                                onDragOver={handleSegmentDragOver}
                                onDrop={() => handleSegmentDrop(idx)}
                                className={`bg-white p-6 rounded-2xl shadow-sm border flex flex-col md:flex-row gap-6 transition-all ${draggedSegmentIndex === idx ? 'border-blue-400 ring-2 ring-blue-100 opacity-70' : 'border-slate-200'}`}
                            >
                                <div className="w-full md:w-1/4 flex flex-col justify-center items-center bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <div className="w-full flex justify-end mb-2">
                                        <div
                                            draggable
                                            onDragStart={(e) => handleSegmentDragStart(e, idx)}
                                            onDragEnd={handleSegmentDragEnd}
                                            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500"
                                            title="드래그해서 순서 변경"
                                        >
                                            <GripVertical className="w-5 h-5" />
                                        </div>
                                    </div>
                                    <div className="text-4xl font-black text-slate-200 mb-2">{String(idx + 1).padStart(2, '0')}</div>
                                    <div className="font-bold text-slate-700 text-center">{seg.title}</div>
                                    {seg.conversionRole && (
                                        <span className="mt-3 px-2.5 py-1 rounded-full bg-slate-900 text-white text-[11px] font-bold">
                                            {seg.conversionRole}
                                        </span>
                                    )}
                                    {seg.shotType && !seg.staticImage && (
                                        <span className="mt-2 px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-500 text-[11px] font-bold">
                                            {seg.shotType === 'full' ? '전신컷' : seg.shotType === 'half' ? '반신컷' : seg.shotType === 'closeup' ? '클로즈업' : seg.shotType === 'lifestyle' ? '라이프컷' : '자동컷'}
                                        </span>
                                    )}
                                    <div className="mt-3 flex flex-wrap gap-1 justify-center">
                                        {seg.logicalSections.map((tag: string) => (
                                            <span key={tag} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md font-medium">{tag}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="w-full md:w-3/4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Key Message (이미지에 들어갈 카피)</label>
                                        <textarea value={seg.keyMessage} onChange={(e) => { const newSegs = [...segments]; newSegs[idx].keyMessage = e.target.value; setSegments(newSegs); }} rows={2} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none font-medium" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">전환 역할</label>
                                            <input value={seg.conversionRole || ''} onChange={(e) => { const newSegs = [...segments]; newSegs[idx].conversionRole = e.target.value; setSegments(newSegs); }} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">컷 타입</label>
                                            <select value={seg.shotType || 'auto'} onChange={(e) => { const newSegs = [...segments]; newSegs[idx].shotType = e.target.value; setSegments(newSegs); }} disabled={seg.staticImage} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-100 disabled:text-slate-400">
                                                {SHOT_PREFERENCE_OPTIONS.map(option => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">캔버스</label>
                                            <select
                                                value={getSegmentLayoutHeight(seg, idx, segments.length)}
                                                onChange={(e) => {
                                                    const newSegs = [...segments];
                                                    newSegs[idx].layoutHeight = normalizeLayoutHeight(e.target.value);
                                                    setSegments(newSegs);
                                                }}
                                                disabled={seg.staticImage}
                                                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                            >
                                                {DETAIL_HEIGHT_PRESETS.map(height => (
                                                    <option key={height} value={height}>{DETAIL_CANVAS_WIDTH}x{height} · {getHeightLabel(height)}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Visual Prompt (이미지 연출 지시)</label>
                                        <textarea value={seg.visualPrompt} onChange={(e) => { const newSegs = [...segments]; newSegs[idx].visualPrompt = e.target.value; setSegments(newSegs); }} rows={2} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm text-slate-600" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end mt-2">
                        <p className="text-xs text-slate-400">💡 수정 후 이미지 일괄 생성을 눌러 새로 만들어보세요.</p>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-5">
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex flex-col gap-4 bg-slate-950 px-7 py-6 text-white lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-200">Detail Output Board</p>
                                <h2 className="mt-2 text-2xl font-black tracking-tight">상세페이지 이미지 생성</h2>
                                <p className="mt-1 text-sm text-slate-300">각 이미지를 선택하면 전체 비율로 바로 확인하고, 선택한 컷만 수정/재생성할 수 있습니다.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => setStep(2)} className="inline-flex items-center rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15">
                                    <ChevronRight className="mr-2 h-4 w-4 rotate-180" />
                                    이전 단계
                                </button>
                                <button onClick={handleDownloadAll} className="inline-flex items-center rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 transition-colors hover:bg-blue-50">
                                    <Download className="mr-2 h-4 w-4" />
                                    전체 다운로드
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Selected Image</p>
                                    <h3 className="truncate text-lg font-black text-slate-900">
                                        {activeResultSegment ? `${activeResultIndex + 1}. ${activeResultSegment.title}` : '이미지 대기 중'}
                                    </h3>
                                </div>
                                <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                    {activeResultSize.width}x{activeResultSize.height}
                                </div>
                            </div>
                            <div className="flex h-[min(68vh,720px)] min-h-[460px] items-center justify-center rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2ff_50%,#f8fafc_100%)] p-4">
                                <div
                                    className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
                                    style={{
                                        aspectRatio: `${activeResultSize.width} / ${activeResultSize.height}`,
                                        height: activeResultSize.height >= activeResultSize.width ? '100%' : 'auto',
                                        width: activeResultSize.height < activeResultSize.width ? '100%' : 'auto',
                                    }}
                                >
                                    {activeResultSegment?.imageUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => setPreviewSegmentIndex(activeResultIndex)}
                                            className="h-full w-full cursor-zoom-in"
                                            title="이미지 전체 미리보기"
                                        >
                                            <img src={activeResultSegment.imageUrl} alt={`Section ${activeResultIndex + 1}`} className="h-full w-full object-contain" />
                                        </button>
                                    ) : activeResultSegment?.isGenerating ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-slate-500">
                                            <Loader2 className="mb-3 h-10 w-10 animate-spin text-blue-500" />
                                            <p className="font-bold">이미지 생성 중...</p>
                                        </div>
                                    ) : activeResultSegment?.error ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-red-500">
                                            <p className="mb-2 font-black">생성 실패</p>
                                            <p className="text-xs text-red-400">{activeResultSegment.errorMessage || '재생성이 필요합니다.'}</p>
                                        </div>
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-slate-400">
                                            <ImageIcon className="mb-3 h-10 w-10" />
                                            <p className="font-medium">선택한 이미지가 이곳에 전체 비율로 표시됩니다.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4">
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Edit Selected</p>
                                <h3 className="text-lg font-black text-slate-900">선택 이미지 수정</h3>
                            </div>
                            {activeResultSegment ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white">#{activeResultIndex + 1}</span>
                                        {activeResultSegment.conversionRole && (
                                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{activeResultSegment.conversionRole}</span>
                                        )}
                                        {activeResultSegment.staticImage && (
                                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">템플릿</span>
                                        )}
                                    </div>
                                    {activeResultSegment.error && (
                                        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                                            {activeResultSegment.errorMessage || '생성 품질이 부족합니다. 재생성을 시도하세요.'}
                                        </div>
                                    )}
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-slate-600">AI 이미지에 넣을 카피</label>
                                        <textarea
                                            value={activeResultSegment.keyMessage}
                                            onChange={(e) => {
                                                const newSegs = [...segments];
                                                newSegs[activeResultIndex].keyMessage = e.target.value;
                                                setSegments(newSegs);
                                            }}
                                            rows={3}
                                            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                                        />
                                    </div>
                                    {!activeResultSegment.staticImage && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="mb-1 block text-xs font-bold text-slate-600">캔버스</label>
                                                <select
                                                    value={getSegmentLayoutHeight(activeResultSegment, activeResultIndex, segments.length)}
                                                    onChange={(e) => {
                                                        const newSegs = [...segments];
                                                        newSegs[activeResultIndex].layoutHeight = normalizeLayoutHeight(e.target.value);
                                                        setSegments(newSegs);
                                                    }}
                                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                                >
                                                    {DETAIL_HEIGHT_PRESETS.map(height => (
                                                        <option key={height} value={height}>{DETAIL_CANVAS_WIDTH}x{height} · {getHeightLabel(height)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-bold text-slate-600">컷 타입</label>
                                                <select
                                                    value={activeResultSegment.shotType || 'auto'}
                                                    onChange={(e) => {
                                                        const newSegs = [...segments];
                                                        newSegs[activeResultIndex].shotType = e.target.value;
                                                        setSegments(newSegs);
                                                    }}
                                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                                >
                                                    {SHOT_PREFERENCE_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                    {!activeResultSegment.staticImage && (
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-slate-600">이미지 연출 지시</label>
                                            <textarea
                                                value={activeResultSegment.visualPrompt}
                                                onChange={(e) => {
                                                    const newSegs = [...segments];
                                                    newSegs[activeResultIndex].visualPrompt = e.target.value;
                                                    setSegments(newSegs);
                                                }}
                                                rows={5}
                                                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 outline-none transition-colors focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                                            />
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => handleRegenerateSegment(activeResultIndex)}
                                            disabled={activeResultSegment.isGenerating || activeResultSegment.staticImage}
                                            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
                                        >
                                            {activeResultSegment.isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                            재생성
                                        </button>
                                        <button
                                            onClick={() => activeResultSegment.imageUrl && setPreviewSegmentIndex(activeResultIndex)}
                                            disabled={!activeResultSegment.imageUrl}
                                            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:text-slate-300"
                                        >
                                            <Maximize2 className="mr-2 h-4 w-4" />
                                            크게 보기
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                                    생성할 이미지가 없습니다.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-end justify-between gap-3">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Image Cards</p>
                                <h3 className="text-lg font-black text-slate-900">각 이미지 미리보기</h3>
                            </div>
                            <p className="text-xs font-bold text-slate-400">클릭해서 위 화면에 표시</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {segments.map((seg, idx) => {
                                const previewSize = getSegmentPreviewSize(seg, idx, segments.length);
                                const selected = idx === activeResultIndex;
                                return (
                                    <div
                                        key={seg.id}
                                        draggable
                                        onDragStart={(e) => handleSegmentDragStart(e, idx)}
                                        onDragOver={handleSegmentDragOver}
                                        onDrop={() => handleSegmentDrop(idx)}
                                        onDragEnd={handleSegmentDragEnd}
                                        className={`group rounded-2xl border bg-slate-50 p-2 transition-all ${selected ? 'border-blue-500 ring-2 ring-blue-100' : draggedSegmentIndex === idx ? 'border-blue-300 opacity-70' : 'border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setActiveResultIndex(idx)}
                                            className="block w-full text-left"
                                        >
                                            <div
                                                className="relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
                                                style={{ aspectRatio: `${previewSize.width} / ${previewSize.height}` }}
                                            >
                                                {seg.imageUrl ? (
                                                    <img src={seg.imageUrl} alt={`Section ${idx + 1}`} className="h-full w-full object-contain" />
                                                ) : seg.isGenerating ? (
                                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-slate-500">
                                                        <Loader2 className="mb-2 h-6 w-6 animate-spin text-blue-500" />
                                                        <span className="text-xs font-bold">생성 중</span>
                                                    </div>
                                                ) : seg.error ? (
                                                    <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs font-bold text-red-500">실패</div>
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs font-bold text-slate-400">대기</div>
                                                )}
                                                <div className="absolute left-2 top-2 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-black text-white backdrop-blur">
                                                    {String(idx + 1).padStart(2, '0')}
                                                </div>
                                                <div className="absolute right-2 top-2 cursor-grab rounded-full bg-white/90 p-1 text-slate-500 shadow-sm active:cursor-grabbing" title="드래그해서 순서 변경">
                                                    <GripVertical className="h-3.5 w-3.5" />
                                                </div>
                                            </div>
                                            <div className="mt-2 min-w-0">
                                                <p className="truncate text-xs font-black text-slate-800">{seg.title}</p>
                                                <p className="mt-0.5 text-[11px] font-bold text-slate-400">{previewSize.width}x{previewSize.height}</p>
                                            </div>
                                        </button>
                                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveResultIndex(idx);
                                                    handleRegenerateSegment(idx);
                                                }}
                                                disabled={seg.isGenerating || seg.staticImage}
                                                className="rounded-lg bg-blue-600 px-2 py-2 text-[10px] font-black text-white transition-colors hover:bg-blue-700 disabled:bg-slate-300"
                                            >
                                                재생성
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveResultIndex(idx);
                                                    if (seg.imageUrl) setPreviewSegmentIndex(idx);
                                                }}
                                                disabled={!seg.imageUrl}
                                                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-[10px] font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:text-slate-300"
                                            >
                                                전체보기
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {previewSegmentIndex !== null && segments[previewSegmentIndex]?.imageUrl && (
                <div
                    className="fixed inset-0 z-50 flex flex-col bg-slate-950/92 backdrop-blur-sm"
                    onClick={() => setPreviewSegmentIndex(null)}
                >
                    <div
                        className="h-16 px-5 md:px-8 flex items-center justify-between border-b border-white/10 text-white"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="min-w-0">
                            <p className="text-xs text-slate-300">#{previewSegmentIndex + 1}</p>
                            <h3 className="font-bold truncate">{segments[previewSegmentIndex].title}</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPreviewSegmentIndex(null)}
                                className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-950 transition-colors hover:bg-blue-50"
                                aria-label="결과 화면으로 돌아가기"
                            >
                                돌아가기
                            </button>
                            <button
                                type="button"
                                onClick={() => setPreviewSegmentIndex(null)}
                                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                                aria-label="미리보기 닫기"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 p-4 md:p-8">
                        <div className="flex h-full items-center justify-center">
                            <img
                                onClick={(e) => e.stopPropagation()}
                                src={segments[previewSegmentIndex].imageUrl}
                                alt={`Section ${previewSegmentIndex + 1} large preview`}
                                className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
