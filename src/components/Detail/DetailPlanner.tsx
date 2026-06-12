import React, { useState, useRef, type DragEvent } from 'react';
import { generateImage, generateFeatures, generateDetailPlan, type DetailPlan } from '../../api/aiService';
import { Loader2, Upload, Download, Wand2, ChevronRight, X, RefreshCw, ChevronDown } from 'lucide-react';

// ────────────────────────────── 상수 ──────────────────────────────
type CombinationType = 'single' | '1+1';
type ToneKey = 'auto' | '프리미엄' | '미니멀' | '감성' | '럭셔리' | '건강' | '테크' | '친환경';

const TONE_OPTIONS: ToneKey[] = ['auto', '프리미엄', '미니멀', '감성', '럭셔리', '건강', '테크', '친환경'];
const LENGTH_OPTIONS: Array<{ val: number | 'auto'; label: string; desc: string }> = [
    { val: 'auto', label: 'Auto (추천)', desc: 'V2.1 흐름 12~15장 자동' },
    { val: 12, label: '12장', desc: 'V2.1 표준 구성' },
    { val: 15, label: '15장', desc: '셀링포인트 최대 확장' },
];
const COMBINATION_OPTIONS: Array<{ value: CombinationType; label: string; desc: string }> = [
    { value: 'single', label: '단품', desc: '단품 중심 상세페이지' },
    { value: '1+1', label: '1+1 조합', desc: '1번 이미지에 2개 구성 강조' },
];

// ────────────────────────────── 이미지 프롬프트 빌더 ──────────────────────────────
// GPT Image가 카피·레이아웃·아이콘·타이포까지 이미지에 직접 렌더링하도록 지시한다(오버레이 X).
const buildImagePrompt = (
    img: GenImage,
    combinationType: CombinationType,
    productName: string,
    design?: { tone?: string; colors?: Record<string, string> }
): string => {
    const tone = design?.tone || 'premium';
    const colors = design?.colors || {};
    const colorHint = colors.primary
        ? `Brand colors — primary ${colors.primary}, accent ${colors.accent || colors.primary}, text ${colors.text || '#1a1a1a'}, background ${colors.background || '#ffffff'}.`
        : '';
    const points = (img.points || []).filter(Boolean);
    const pointsBlock = points.length
        ? `\n- 보조 포인트(각 항목마다 어울리는 작은 플랫 아이콘과 함께 깔끔하게 배치):\n${points.map(p => `   · ${p}`).join('\n')}`
        : '';
    const posKo = img.textPosition === 'top' ? '상단' : img.textPosition === 'middle' ? '중앙' : '하단';
    const bundle = combinationType === '1+1' && img.number === 1
        ? '\n- 1+1 세트 구성이므로 동일 제품 2개를 한 장면에 자연스럽게 함께 보여줄 것.'
        : '';

    return `Create ONE finished, polished Korean e-commerce detail-page section image (vertical 860x1000 / 4:5 layout) for the product "${productName}".
This must look like a TOP 1% Korean smartstore/Coupang detail page section: real product photography COMBINED with clean, beautiful Korean text typography rendered DIRECTLY into the image (headline, sub copy, bullet points with small icons/badges) — NOT a plain photo.

SECTION ROLE: ${img.role}${img.stage ? ` (구매 심리 단계: ${img.stage})` : ''}.

이미지 안에 아래 한글 텍스트를 정확히 렌더링하라 (맞춤법 완벽, 자연스러운 한글 타이포그래피, 로마자 변환 금지, 문구 변경 금지):
- 헤드라인(크고 굵게): "${(img.mainCopy || '').replace(/\n/g, ' ')}"
${img.subCopy ? `- 서브 카피(중간 크기): "${img.subCopy}"` : ''}${pointsBlock}

DESIGN DIRECTION:
- 톤: ${tone}. 깔끔하고 현대적인 프리미엄 레이아웃, 명확한 시각적 위계, professional typography area, 넉넉한 여백, high conversion design, premium UI elements. ${colorHint}
- 텍스트 블록은 ${posKo} 영역에 가독성 높게 배치하고, 나머지는 제품 사진이 하나의 자연스러운 장면으로 채울 것.
- Korean smartstore optimized, photorealistic commercial product photography, natural lighting, ultra realistic texture, realistic shadows, premium visual merchandising, information-rich layout.

PRODUCT VISUAL: ${img.visualPrompt}

STRICT:
- 레퍼런스 이미지의 제품 색상·로고·프린트·디테일을 정확히 보존할 것.
- 레퍼런스에 사람이 있으면 완전히 새로운 가상의 한국인 모델(다른 얼굴)로 교체하고 배경도 새로 구성할 것.
- 모든 한글은 또렷하고 맞춤법이 정확해야 하며, 깨진 글자·이상한 외국어 텍스트가 없어야 함.${bundle}`;
};

// ────────────────────────────── 타입 ──────────────────────────────
interface GenImage {
    id: string;
    number: number;
    role: string;
    stage: string;
    sectionType: string;
    mainCopy: string;
    subCopy: string;
    points: string[];
    trustElement: string;
    trigger: string;
    textPosition: 'top' | 'middle' | 'bottom';
    visualPrompt: string;
    imageUrl: string;
    isGenerating: boolean;
}

interface InputInfo {
    name: string;
    category: string;
    description: string;
    features: string;
    target: string;
    designTone: ToneKey;
    combinationType: CombinationType;
}

// ────────────────────────────── 컴포넌트 ──────────────────────────────
export const DetailPlanner: React.FC = () => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
    const [info, setInfo] = useState<InputInfo>({
        name: '',
        category: '',
        description: '',
        features: '',
        target: '',
        designTone: 'auto',
        combinationType: 'single',
    });
    const [length, setLength] = useState<number | 'auto'>('auto');
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [plan, setPlan] = useState<DetailPlan | null>(null);
    const [images, setImages] = useState<GenImage[]>([]);
    const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── 이미지 업로드 ──
    const handleFiles = (files: FileList | null) => {
        if (!files) return;
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => setReferenceImages(prev => [...prev, reader.result as string]);
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    };
    const removeImage = (idx: number) => setReferenceImages(prev => prev.filter((_, i) => i !== idx));

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
            let features = info.features;
            if (!features.trim()) {
                features = await generateFeatures(info.name, info.category);
                setInfo(prev => ({ ...prev, features }));
            }
            const result = await generateDetailPlan({ ...info, features, length });
            if (!result || !result.images?.length) {
                alert('기획안 생성에 실패했습니다. 다시 시도해주세요.');
                return;
            }
            setPlan(result);
            setImages(result.images.map((img, i) => ({
                id: `img-${Date.now()}-${i}`,
                number: img.number,
                role: img.role,
                stage: img.stage,
                sectionType: img.sectionType,
                mainCopy: img.mainCopy,
                subCopy: img.subCopy,
                points: img.points,
                trustElement: img.trustElement,
                trigger: img.trigger,
                textPosition: img.textPosition,
                visualPrompt: img.visualPrompt,
                imageUrl: '',
                isGenerating: false,
            })));
            setStep(2);
        } catch (e) {
            console.error(e);
            alert('기획안 생성 중 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const updateImage = (id: string, patch: Partial<GenImage>) => {
        setImages(prev => prev.map(img => img.id === id ? { ...img, ...patch } : img));
    };

    // ── 단일 이미지 생성 (카피·레이아웃까지 이미지에 직접 렌더링) ──
    const generateOne = async (seg: GenImage) => {
        updateImage(seg.id, { isGenerating: true });
        const prompt = buildImagePrompt(seg, info.combinationType, info.name, plan?.designSystem);
        const raw = await generateImage(prompt, referenceImages, '9:16');
        updateImage(seg.id, { imageUrl: raw || '', isGenerating: false });
    };

    // ── STEP 2 → 전체 이미지 생성 ──
    const handleGenerateAll = async () => {
        setStep(3);
        const snapshot = images.map(img => ({ ...img, isGenerating: true, imageUrl: '' }));
        setImages(snapshot);
        // generateImage 내부에서 동시 2개 + 429 자동 재시도로 분당 한도를 지킴
        await Promise.all(snapshot.map(seg => generateOne(seg)));
    };

    const handleDownloadAll = () => {
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

    const generatedCount = images.filter(i => i.imageUrl).length;
    const generatingCount = images.filter(i => i.isGenerating).length;

    // ────────────────────────────── 렌더 ──────────────────────────────
    return (
        <div className="max-w-5xl mx-auto p-6">
            {/* Stepper */}
            <div className="flex items-center justify-between mb-8">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex items-center">
                        <div
                            onClick={() => { if (s < step) setStep(s as 1 | 2 | 3); }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all
                                ${step >= s ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}
                                ${s < step ? 'cursor-pointer hover:bg-blue-700' : 'cursor-default'}`}
                        >
                            {s}
                        </div>
                        <div className="ml-3">
                            <p className={`text-sm font-medium ${step >= s ? 'text-slate-900' : 'text-slate-500'}`}>
                                {s === 1 ? '정보 입력' : s === 2 ? '기획안 확인' : '이미지 생성'}
                            </p>
                        </div>
                        {s < 3 && <ChevronRight className="w-5 h-5 mx-4 text-slate-300" />}
                    </div>
                ))}
            </div>

            {/* ───── STEP 1: 정보 입력 ───── */}
            {step === 1 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                    <h2 className="text-2xl font-bold text-slate-800 mb-1">상품 정보 입력</h2>
                    <p className="text-sm text-slate-500 mb-6">상품명과 사진 1장만 있으면 V2.1 기준 판매용 상세페이지 기획안을 만들어 드립니다.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">상품명 *</label>
                            <input type="text" value={info.name} onChange={e => setInfo({ ...info, name: e.target.value })} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 무중력 메모리폼 베개" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">카테고리 <span className="text-slate-400 font-normal">(선택 - 비워두면 자동 추정)</span></label>
                            <input type="text" value={info.category} onChange={e => setInfo({ ...info, category: e.target.value })} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 리빙/침구" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">상품 설명 <span className="text-slate-400 font-normal">(선택 - 상품 소개/상세 내용 붙여넣기)</span></label>
                            <textarea value={info.description} onChange={e => setInfo({ ...info, description: e.target.value })} rows={3} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="상품 URL의 설명이나 제품 소개글을 붙여넣으면 기획에 반영됩니다." />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">핵심 특징 <span className="text-slate-400 font-normal">(비워두면 자동 생성)</span></label>
                            <textarea value={info.features} onChange={e => setInfo({ ...info, features: e.target.value })} rows={2} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="상품의 주요 장점을 입력하세요." />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">타겟 고객 <span className="text-slate-400 font-normal">(선택)</span></label>
                            <input type="text" value={info.target} onChange={e => setInfo({ ...info, target: e.target.value })} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 20-30대 직장인 여성" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">디자인 톤</label>
                            <select value={info.designTone} onChange={e => setInfo({ ...info, designTone: e.target.value as ToneKey })} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                {TONE_OPTIONS.map(t => <option key={t} value={t}>{t === 'auto' ? '자동 선택' : t}</option>)}
                            </select>
                        </div>

                        {/* 상품 구성 */}
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">상품 구성</label>
                            <div className="grid grid-cols-2 gap-3">
                                {COMBINATION_OPTIONS.map(opt => {
                                    const selected = info.combinationType === opt.value;
                                    return (
                                        <button key={opt.value} type="button" onClick={() => setInfo({ ...info, combinationType: opt.value })}
                                            className={`text-left p-4 rounded-xl border transition-all ${selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}`}>
                                            <div className={`font-bold mb-1 ${selected ? 'text-blue-700' : 'text-slate-800'}`}>{opt.label}</div>
                                            <div className="text-xs text-slate-500">{opt.desc}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 길이 */}
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">상세페이지 길이</label>
                            <div className="grid grid-cols-3 gap-3">
                                {LENGTH_OPTIONS.map(opt => (
                                    <div key={String(opt.val)} onClick={() => setLength(opt.val)} className={`p-4 rounded-xl border cursor-pointer transition-all ${length === opt.val ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}`}>
                                        <div className="font-medium text-slate-800 mb-1">{opt.label}</div>
                                        <div className="text-xs text-slate-500">{opt.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 레퍼런스 이미지 */}
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">레퍼런스 이미지 (최소 1장 필수)</label>
                            <div onClick={() => fileInputRef.current?.click()} onDrop={onDrop} onDragOver={e => e.preventDefault()}
                                className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
                                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                                <p className="font-medium text-slate-700">클릭 또는 드래그하여 제품 사진 업로드</p>
                                <p className="text-xs text-slate-400 mt-1">여러 각도(앞/뒤/옆) 사진을 넣으면 더 정확합니다</p>
                            </div>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
                            {referenceImages.length > 0 && (
                                <div className="flex flex-wrap gap-3 mt-4">
                                    {referenceImages.map((img, idx) => (
                                        <div key={idx} className="relative w-20 h-20">
                                            <img src={img} alt="" className="w-full h-full object-cover rounded-lg border border-slate-200" />
                                            <button onClick={() => removeImage(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end mt-8">
                        <button onClick={handleGeneratePlan} disabled={loading || referenceImages.length < 1}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors">
                            {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> 기획안 생성 중...</> : <><Wand2 className="w-5 h-5 mr-2" /> 기획안 생성</>}
                        </button>
                    </div>
                </div>
            )}

            {/* ───── STEP 2: 기획안 확인 ───── */}
            {step === 2 && plan && (
                <div className="space-y-6">
                    {/* 전략 분석 */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-4">📊 상품·전환 전략 분석</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="bg-slate-50 rounded-xl p-4">
                                <p className="font-bold text-slate-700 mb-1">제품 정의</p>
                                <p className="text-slate-600 leading-relaxed">{plan.productDefinition}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-4">
                                <p className="font-bold text-slate-700 mb-1">고객 분석</p>
                                <p className="text-slate-600"><span className="text-slate-400">타겟:</span> {plan.customer?.target}</p>
                                <p className="text-slate-600"><span className="text-slate-400">표면 니즈:</span> {plan.customer?.surfaceNeed}</p>
                                <p className="text-slate-600"><span className="text-slate-400">실제 니즈:</span> {plan.customer?.realNeed}</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-4">
                                <p className="font-bold text-slate-700 mb-1">경쟁 대비 차별점</p>
                                <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                                    {plan.differentiators?.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-4">
                                <p className="font-bold text-slate-700 mb-1">구매 저항 요소 (해소 대상)</p>
                                <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                                    {plan.purchaseResistances?.map((d, i) => <li key={i}>{d}</li>)}
                                </ul>
                            </div>
                        </div>
                        {plan.designSystem && (
                            <div className="flex items-center gap-3 mt-4 flex-wrap">
                                <span className="text-sm font-bold text-slate-700">디자인 톤: {plan.designSystem.tone}</span>
                                {plan.designSystem.colors && Object.entries(plan.designSystem.colors).map(([k, v]) => (
                                    <span key={k} className="flex items-center gap-1.5 text-xs text-slate-500">
                                        <span className="w-5 h-5 rounded border border-slate-200" style={{ background: v as string }} />{k}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 이미지별 기획 */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                        <h2 className="text-xl font-bold text-slate-800 mb-1">🖼 이미지별 기획안 (총 {images.length}장)</h2>
                        <p className="text-sm text-slate-500 mb-4">카피는 이미지 안에 직접 렌더링됩니다. 필요하면 여기서 문구를 수정하세요.</p>
                        <div className="space-y-4">
                            {images.map((img) => (
                                <div key={img.id} className="border border-slate-200 rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                                        <span className="bg-blue-600 text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center shrink-0">{img.number}</span>
                                        <span className="font-bold text-slate-800">{img.role}</span>
                                        {img.stage && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{img.stage}</span>}
                                        {img.trigger && <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">트리거: {img.trigger}</span>}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-500 mb-1">메인 카피</label>
                                            <textarea value={img.mainCopy} onChange={e => updateImage(img.id, { mainCopy: e.target.value })} rows={2}
                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                            <label className="block text-xs font-medium text-slate-500 mb-1 mt-2">서브 카피</label>
                                            <input value={img.subCopy} onChange={e => updateImage(img.id, { subCopy: e.target.value })}
                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                                            <div className="mt-2">
                                                <span className="text-xs text-slate-400 mr-2">텍스트 위치</span>
                                                <select value={img.textPosition} onChange={e => updateImage(img.id, { textPosition: e.target.value as any })} className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
                                                    <option value="top">상단</option>
                                                    <option value="middle">중앙</option>
                                                    <option value="bottom">하단</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="text-sm text-slate-600 space-y-1">
                                            {img.points?.length > 0 && (
                                                <ul className="list-disc list-inside text-xs text-slate-500">
                                                    {img.points.map((p, i) => <li key={i}>{p}</li>)}
                                                </ul>
                                            )}
                                            {img.trustElement && <p className="text-xs text-slate-500"><span className="text-slate-400">신뢰:</span> {img.trustElement}</p>}
                                            <button onClick={() => setExpandedPrompt(expandedPrompt === img.id ? null : img.id)} className="text-xs text-blue-500 flex items-center gap-0.5">
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedPrompt === img.id ? 'rotate-180' : ''}`} /> 이미지 프롬프트
                                            </button>
                                            {expandedPrompt === img.id && <p className="text-[11px] text-slate-400 bg-slate-50 p-2 rounded-lg leading-relaxed">{img.visualPrompt}</p>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-between">
                        <button onClick={() => setStep(1)} className="text-slate-600 hover:text-slate-900 font-medium py-3 px-6">← 정보 수정</button>
                        <button onClick={handleGenerateAll} className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-xl flex items-center">
                            <Wand2 className="w-5 h-5 mr-2" /> 이미지 생성 시작 ({images.length}장)
                        </button>
                    </div>
                </div>
            )}

            {/* ───── STEP 3: 이미지 생성 ───── */}
            {step === 3 && (
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">이미지 생성</h2>
                            <p className="text-sm text-slate-500 mt-1">
                                {generatingCount > 0
                                    ? `생성 중... (${generatedCount}/${images.length} 완료, 분당 5장 한도로 자동 대기)`
                                    : `완료 (${generatedCount}/${images.length})`}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setStep(2)} className="text-slate-600 hover:text-slate-900 font-medium py-2.5 px-5 rounded-xl border border-slate-200">← 기획안</button>
                            <button onClick={handleDownloadAll} disabled={generatedCount === 0} className="bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-medium py-2.5 px-5 rounded-xl flex items-center">
                                <Download className="w-5 h-5 mr-2" /> 전체 다운로드
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {images.map((seg) => (
                            <div key={seg.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="relative bg-slate-100" style={{ aspectRatio: '860 / 1000' }}>
                                    {seg.isGenerating ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                                            <Loader2 className="w-8 h-8 animate-spin mb-2" />
                                            <span className="text-xs">생성 중...</span>
                                        </div>
                                    ) : seg.imageUrl ? (
                                        <img src={seg.imageUrl} alt={seg.role} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
                                            <span className="text-xs">생성 실패</span>
                                            <button onClick={() => generateOne(seg)} className="text-xs text-blue-500 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> 다시 생성</button>
                                        </div>
                                    )}
                                    <span className="absolute top-2 left-2 bg-black/60 text-white text-xs font-bold rounded-full px-2 py-0.5">{seg.number}. {seg.role}</span>
                                </div>
                                {seg.imageUrl && (
                                    <div className="p-3 space-y-2">
                                        <textarea value={seg.mainCopy} onChange={e => updateImage(seg.id, { mainCopy: e.target.value })} rows={2}
                                            className="w-full p-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none" placeholder="메인 카피" />
                                        <button onClick={() => generateOne(seg)} className="w-full text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded py-1.5 flex items-center justify-center gap-1">
                                            <RefreshCw className="w-3 h-3" /> 이 문구로 재생성
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
