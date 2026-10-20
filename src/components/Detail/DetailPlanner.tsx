import { useRef, useState, type DragEvent } from 'react';
import { Upload, X, Loader2, RefreshCw, Download, Sparkles, Image as ImageIcon, Check, FolderOpen } from 'lucide-react';
import { generateDetailPlan, generateImage, type DetailPlan, type DetailPlanImage } from '../../api/aiService';
import { overlayCopy, formatMainCopy } from '../../lib/detailCanvas';
import { getToken } from '../../lib/auth';

/**
 * 상세페이지 제작 — 입력 → 기획안 → 이미지, 세 단계.
 *
 * 예전 화면은 2,900줄이었다. 조합상품·마스터 레퍼런스·비전 QA·변형 선택·
 * 필터·브리프 편집이 겹겹이 붙어 있었고, 그만큼 프롬프트도 서로 충돌하는
 * 지시로 길어져 결과가 오히려 평범했다. 이번 화면은 하나만 한다 — 업로드한
 * 제품 사진을 정확히 지키면서, 구간마다 잡지 화보급 사진 한 장을 만든다.
 *
 * 품질 원칙:
 *  - 항상 최고 품질(quality high · input_fidelity high), 구간당 1장
 *  - 프롬프트는 짧고 모순 없이. 제품 보존 / 장면 / 글자 금지 세 덩어리만
 *  - 한글 카피는 캔버스가 얹는다 (모델이 그리는 한글은 깨진다)
 */

type Tone = 'auto' | '프리미엄' | '미니멀' | '감성' | '내추럴';
const TONES: Tone[] = ['auto', '프리미엄', '미니멀', '감성', '내추럴'];
const COUNTS = [6, 8, 10] as const;
const MAX_REFS = 4;

type Status = 'idle' | 'generating' | 'done' | 'failed';

interface Section {
    id: string;
    number: number;
    role: string;
    sectionType: string;
    shotType: DetailPlanImage['shotType'];
    mainCopy: string;
    subCopy: string;
    textPosition: 'top' | 'middle' | 'bottom';
    visualPrompt: string;
    imageUrl: string;
    status: Status;
    error?: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** 업로드 사진은 긴 변 1600px로 줄여 보낸다 — 원본 그대로면 요청이 수 MB가 된다 */
const shrinkImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
            const max = 1600;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = () => resolve(String(reader.result));
        img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
});

const SHOT_GUIDE: Record<string, string> = {
    model: 'One fictional Korean model naturally using or wearing the product in a real environment. The product is the clear hero, large and sharp. Natural pose, candid editorial feel.',
    product: 'Product-only hero shot on a styled surface with one or two category-relevant props. Shallow depth of field, premium still-life styling.',
    detail: 'Extreme close-up of the most important functional detail of the product. Macro lens look, crisp texture, controlled soft light.',
    texture: 'Macro texture shot of the product material. Raking light to reveal surface grain, fabric weave or finish.',
    lifestyle: 'The product in a real-life scene where it is actually used. Warm, aspirational, candid, magazine editorial.',
    cta: 'Clean, confident final hero of the product with calm negative space. Feels like the last page of a premium brochure.',
};

const POSITION_KO = { top: 'upper', middle: 'center', bottom: 'lower' } as const;

/** 프롬프트는 세 덩어리만: 제품 보존, 장면, 글자 금지. 길고 모순된 지시는 품질을 깎는다. */
const buildPrompt = (sec: Section, productName: string, tone: string, refCount: number, bundleCount = 1, hasHero = false): string => {
    const shot = SHOT_GUIDE[sec.shotType || 'product'] || SHOT_GUIDE.product;
    const problem = sec.sectionType === 'problem';
    return [
        `Premium Korean e-commerce detail page section photo for "${productName}", vertical 4:5.`,
        `Look: ${tone} magazine editorial. Real photo-shoot quality — soft directional key light, natural fill, true-to-life color, accurate contact shadows, real material texture, shallow depth of field. Not a collage, not a stock photo, not a catalog cutout.`,
        '',
        problem
            ? 'SCENE: a relatable BEFORE / problem moment without this product — show the inconvenience the product solves. Do not show the uploaded product here.'
            : `SCENE: ${shot}`,
        `Direction: ${sec.visualPrompt}`,
        '',
        problem ? '' : bundleCount >= 2
            ? [
                `PRODUCT FIDELITY (most important): this is a ${bundleCount}-item set. Each of the ${refCount} uploaded images is a DIFFERENT item of the set. Keep every item's shape, color, print, logo, material and proportions identical to its reference. Never merge items into one, never recolor, never swap.`,
                sec.shotType === 'model' || sec.shotType === 'lifestyle' || sec.shotType === 'cta' || sec.number === 1
                    ? `Show all ${bundleCount} items together with equal visual weight. For apparel, use ${bundleCount} fictional Korean models side by side, each wearing one different item — same scale, same light, same background. Do not show one item worn and the others folded or held.`
                    : `This section may focus on one item, but it must be one of the exact reference items.`,
            ].join('\n')
            : [
                `PRODUCT FIDELITY (most important): the ${refCount} uploaded image${refCount > 1 ? 's are' : ' is'} the exact product. Keep its shape, color, print, logo, material, proportions and every visible detail identical. Never redesign, recolor, simplify or swap the product. If a person appears, use a new fictional Korean model, but the product stays the same.`,
            ].join('\n'),
        '',
        hasHero ? 'CONSISTENCY: the last input image is the approved hero of this same page. Use the same model (same face, hair, body), the same location family, the same light quality and the same color grade, but a different pose, angle and crop for this section. The page must read as one photo shoot.' : '',
        `COMPOSITION: one focal subject, calm negative space. Keep the ${POSITION_KO[sec.textPosition]} third of the frame clean and uncluttered — Korean copy will be placed there later. Keep faces, hands and key product details out of that area.`,
        'NO TEXT: do not render any letters, numbers, logos, badges, labels, watermarks or signage. Only lettering that already exists on the uploaded product may remain.',
        'AVOID: plastic skin, warped hands, floating objects, mismatched light, HDR glow, heavy vignette, split panels, white header/footer bands.',
    ].filter(Boolean).join('\n');
};

/** 사람이 입고 쓰는 장면이 가장 잘 팔린다. 기획안이 디테일컷으로 채워 와도 60% 이상은 모델컷으로 돌린다. */
const balanceShots = (imgs: DetailPlanImage[]): DetailPlanImage['shotType'][] => {
    const n = imgs.length;
    const want = Math.ceil(n * 0.6);
    const shots = imgs.map((img, i) => (i === 0 ? 'model' : img.shotType || 'product') as NonNullable<DetailPlanImage['shotType']>);
    const isPerson = (s: string) => s === 'model' || s === 'lifestyle';
    let have = shots.filter(isPerson).length;
    // 문제 공감은 사람 장면으로(제품 없이), 그다음 proof/detail 중 앞에서부터 모델컷으로 바꾼다
    for (let i = 1; i < n && have < want; i++) {
        if (isPerson(shots[i])) continue;
        if (imgs[i].sectionType === 'problem') { shots[i] = 'lifestyle'; have++; continue; }
    }
    for (let i = 1; i < n && have < want; i++) {
        if (isPerson(shots[i]) || imgs[i].sectionType === 'problem') continue;
        if (shots[i] === 'texture') continue; // 소재 클로즈업 하나는 남긴다
        shots[i] = 'model'; have++;
    }
    return shots;
};

const toSections = (plan: DetailPlan, bundleCount = 1): Section[] => {
  const shots = balanceShots(plan.images);
  return plan.images.map((img, i) => ({
    id: uid(),
    number: img.number || i + 1,
    role: img.role,
    sectionType: img.sectionType,
    shotType: shots[i],
    mainCopy: formatMainCopy(img.mainCopy),
    subCopy: (img.subCopy || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    textPosition: img.textPosition || (i % 2 === 0 ? 'top' : 'bottom'),
    visualPrompt: img.visualPrompt,
    imageUrl: '',
    status: 'idle',
  }));
};

export function DetailPlanner() {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [tone, setTone] = useState<Tone>('auto');
    const [count, setCount] = useState<(typeof COUNTS)[number]>(8);
    const [refs, setRefs] = useState<string[]>([]);
    // 사진이 2장 이상이면 기본은 '서로 다른 구성품'(조합상품). 같은 제품의 다른 각도면 끌 수 있다.
    const [bundle, setBundle] = useState(true);
    const bundleCount = bundle && refs.length >= 2 ? refs.length : 1;
    const [plan, setPlan] = useState<DetailPlan | null>(null);
    // 대표컷. 나머지 모든 장이 이 컷의 모델·장소·조명·색감을 따라간다.
    // 장마다 따로 만들면 모델도 배경도 제각각이라 "한 브랜드 페이지"로 안 보인다.
    const [hero, setHero] = useState<string>('');
    const [heroBusy, setHeroBusy] = useState(false);
    const [sections, setSections] = useState<Section[]>([]);
    const [planning, setPlanning] = useState(false);
    const [running, setRunning] = useState(false);
    const [zipping, setZipping] = useState(false);
    const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
    const fileRef = useRef<HTMLInputElement>(null);
    const sectionsRef = useRef<Section[]>([]);
    sectionsRef.current = sections;

    const addFiles = async (files: FileList | null) => {
        if (!files) return;
        const room = MAX_REFS - refs.length;
        const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, Math.max(0, room));
        const urls = await Promise.all(picked.map(shrinkImage));
        setRefs(prev => [...prev, ...urls].slice(0, MAX_REFS));
        if (fileRef.current) fileRef.current.value = '';
    };
    const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); void addFiles(e.dataTransfer.files); };

    const patch = (id: string, p: Partial<Section>) =>
        setSections(prev => prev.map(s => (s.id === id ? { ...s, ...p } : s)));

    // ── 1 → 2: 기획안 ──
    const makePlan = async () => {
        if (!name.trim()) { alert('상품명을 입력해주세요.'); return; }
        if (refs.length === 0) { alert('제품 사진을 1장 이상 올려주세요.'); return; }
        setPlanning(true);
        try {
            const result = await generateDetailPlan({
                name: name.trim(),
                category: '',
                description: description.trim(),
                target: '',
                designTone: tone,
                combinationType: bundleCount >= 2 ? `bundle-${bundleCount}` : 'single',
                combinationCount: bundleCount,
                length: count,
            });
            if (!result || !result.images?.length) { alert('기획안을 만들지 못했습니다. 다시 시도해주세요.'); return; }
            setPlan(result);
            setSections(toSections(result, bundleCount));
            setHero('');
            setSaved('idle');
            setStep(2);
        } catch (e) {
            console.error(e);
            alert('기획안 생성 중 오류가 났습니다.');
        } finally {
            setPlanning(false);
        }
    };

    // ── 이미지 한 장 ──
    const generateOne = async (sec: Section) => {
        patch(sec.id, { status: 'generating', error: '' });
        try {
            const latest = sectionsRef.current.find(s => s.id === sec.id) || sec;
            const designTone = tone === 'auto' ? (plan?.designSystem?.tone || 'premium') : tone;
            const prompt = buildPrompt(latest, name.trim(), designTone, refs.length, bundleCount, Boolean(hero) && latest.number !== 1);
            const problem = latest.sectionType === 'problem';
            const useRefs = problem ? [] : [...refs, ...(hero && latest.number !== 1 ? [hero] : [])];
            const roles = problem ? [] : [
                ...refs.map((_, i) => `Image ${i + 1}: the exact product to preserve`),
                ...(hero && latest.number !== 1 ? [`Image ${refs.length + 1}: APPROVED HERO — match this model's identity, the location, lighting and color grade`] : []),
            ];
            const result = await generateImage(prompt, useRefs, '9:16', 'high', {
                inputFidelity: 'high',
                variantCount: 1,
                referenceRoles: roles,
                pacingMode: 'auto',
                priority: latest.number,
            });
            const raw = result?.image;
            if (!raw) { patch(sec.id, { status: 'failed', error: '이미지를 받지 못했습니다. 다시 시도해주세요.' }); return; }
            const imageUrl = await overlayCopy(raw, latest, plan?.designSystem);
            patch(sec.id, { imageUrl, status: 'done' });
        } catch (e: any) {
            patch(sec.id, { status: 'failed', error: e?.message || '생성 실패' });
        }
    };

    // ── 대표컷: 1번(Hook) 장면을 먼저 한 장 만들어 확인받는다 ──
    const makeHero = async () => {
        const first = sectionsRef.current[0];
        if (!first || heroBusy) return;
        setHeroBusy(true);
        try {
            const designTone = tone === 'auto' ? (plan?.designSystem?.tone || 'premium') : tone;
            const prompt = buildPrompt({ ...first, shotType: 'model' }, name.trim(), designTone, refs.length, bundleCount, false);
            const result = await generateImage(prompt, refs, '9:16', 'high', {
                inputFidelity: 'high',
                variantCount: 1,
                referenceRoles: refs.map((_, i) => `Image ${i + 1}: the exact product to preserve`),
                pacingMode: 'auto',
                priority: 1,
            });
            if (!result?.image) { alert('대표컷을 받지 못했습니다. 다시 시도해주세요.'); return; }
            setHero(result.image);
            // 1번 장은 대표컷 그대로 쓴다 (문구만 얹어서)
            const imageUrl = await overlayCopy(result.image, first, plan?.designSystem);
            patch(first.id, { imageUrl, status: 'done' });
        } catch (e: any) {
            alert(e?.message || '대표컷 생성 실패');
        } finally {
            setHeroBusy(false);
        }
    };

    // ── 2 → 3: 전체 동시 생성. 분당 한도(429)는 aiService가 기다렸다 다시 보낸다 ──
    const generateAll = async () => {
        if (running) return;
        setRunning(true);
        setStep(3);
        await Promise.all(sectionsRef.current.filter(s => s.status !== 'done').map(s => generateOne(s)));
        setRunning(false);
    };

    const retryFailed = async () => {
        if (running) return;
        setRunning(true);
        await Promise.all(sectionsRef.current.filter(x => x.status === 'failed').map(s => generateOne(s)));
        setRunning(false);
    };

    // ── 내려받기 ──
    const downloadZip = async () => {
        const done = sections.filter(s => s.imageUrl);
        if (!done.length || zipping) return;
        setZipping(true);
        try {
            const { default: JSZip } = await import('jszip');
            const zip = new JSZip();
            for (let i = 0; i < done.length; i++) {
                const blob = await (await fetch(done[i].imageUrl)).blob();
                zip.file(`detail_${String(i + 1).padStart(2, '0')}.png`, blob);
            }
            const out = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(out);
            const a = document.createElement('a');
            a.href = url;
            a.download = `상세페이지_${name.replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 30) || '상품'}.zip`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e: any) {
            alert(`ZIP 생성 실패: ${e?.message || e}`);
        } finally {
            setZipping(false);
        }
    };

    const planText = () => sections.map(s => `${s.number}. [${s.role}]\n${s.mainCopy.replace(/\n/g, ' ')}\n${s.subCopy}`).join('\n\n');

    const savePlan = async () => {
        if (saved !== 'idle') return;
        setSaved('saving');
        try {
            const res = await fetch('/api/works?action=save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ kind: 'detail-plan', title: name || '상세페이지 기획안', payload: { planText: planText() } }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || '저장 실패');
            setSaved('saved');
        } catch (e: any) {
            alert(e.message);
            setSaved('idle');
        }
    };

    const doneCount = sections.filter(s => s.status === 'done').length;
    const failedCount = sections.filter(s => s.status === 'failed').length;

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            {/* 단계 표시 */}
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
                {(['상품 정보', '기획안', '이미지'] as const).map((label, i) => (
                    <span key={label} className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 font-semibold ${step === i + 1 ? 'bg-accent text-black' : step > i + 1 ? 'text-ink-2' : ''}`}>{i + 1}. {label}</span>
                        {i < 2 && <span>›</span>}
                    </span>
                ))}
            </div>

            {/* ── 1. 상품 정보 ── */}
            {step === 1 && (
                <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
                    <div className="space-y-4 rounded-card border border-line bg-paper p-5">
                        <div>
                            <label className="mb-1 block text-[12px] font-semibold text-ink-2">상품명 *</label>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="예: 하루한잔 스테인리스 진공 보온텀블러 500ml"
                                className="w-full rounded-control border border-line bg-paper-2 px-3 py-2.5 text-sm text-ink focus:border-line-strong focus:outline-none" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[12px] font-semibold text-ink-2">핵심 특징·장점 <span className="font-normal text-ink-3">(한 줄에 하나씩, 없으면 비워도 됩니다)</span></label>
                            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6}
                                placeholder={'12시간 보온·보냉\n이중 진공 스테인리스 304\n한 손에 잡히는 슬림 바디\n식기세척기 사용 가능'}
                                className="w-full rounded-control border border-line bg-paper-2 px-3 py-2.5 text-sm text-ink focus:border-line-strong focus:outline-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-[12px] font-semibold text-ink-2">분위기</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {TONES.map(t => (
                                        <button key={t} type="button" onClick={() => setTone(t)}
                                            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${tone === t ? 'border-accent bg-accent text-black' : 'border-line text-ink-2 hover:border-line-strong'}`}>
                                            {t === 'auto' ? '자동' : t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="mb-1 block text-[12px] font-semibold text-ink-2">장수</label>
                                <div className="flex gap-1.5">
                                    {COUNTS.map(c => (
                                        <button key={c} type="button" onClick={() => setCount(c)}
                                            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${count === c ? 'border-accent bg-accent text-black' : 'border-line text-ink-2 hover:border-line-strong'}`}>
                                            {c}장
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <button type="button" onClick={makePlan} disabled={planning}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60">
                            {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {planning ? '기획안을 짜는 중…' : '기획안 만들기'}
                        </button>
                    </div>

                    <div className="rounded-card border border-line bg-paper p-5">
                        <p className="mb-1 text-[12px] font-semibold text-ink-2">제품 사진 * <span className="font-normal text-ink-3">(최대 {MAX_REFS}장)</span></p>
                        <p className="mb-3 text-[12px] text-ink-3">배경이 단순한 정면·측면 사진이 가장 정확하게 보존됩니다. 이 사진의 색·모양·로고가 모든 구간에 그대로 유지됩니다.</p>
                        <div onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current?.click()}
                            className="flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-paper-2 px-4 py-8 text-center hover:border-accent">
                            <Upload className="mb-2 h-5 w-5 text-ink-3" />
                            <p className="text-sm text-ink-2">클릭하거나 끌어다 놓기</p>
                            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => void addFiles(e.target.files)} />
                        </div>
                        {refs.length >= 2 && (
                            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-control border border-line bg-paper-2 px-3 py-2 text-[12px] text-ink-2">
                                <input type="checkbox" checked={bundle} onChange={e => setBundle(e.target.checked)} className="mt-0.5" />
                                <span><b className="text-ink">사진은 서로 다른 구성품입니다 ({refs.length}종 세트)</b><br />켜면 조합상품으로 기획하고 인트로·활용·마무리 컷에 {refs.length}개가 함께 나옵니다. 같은 제품의 다른 각도라면 끄세요.</span>
                            </label>
                        )}
                        {refs.length > 0 && (
                            <div className="mt-3 grid grid-cols-4 gap-2">
                                {refs.map((src, i) => (
                                    <div key={i} className="relative aspect-square overflow-hidden rounded-control border border-line">
                                        <img src={src} alt="" className="h-full w-full object-cover" />
                                        <button type="button" onClick={() => setRefs(prev => prev.filter((_, j) => j !== i))}
                                            className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"><X className="h-3 w-3" /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── 2. 기획안 ── */}
            {step === 2 && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-lg font-semibold text-ink">{name}</h3>
                            <p className="text-[12px] text-ink-3">구간별 문구를 고친 뒤 이미지를 만드세요. 문구는 이미지 위에 선명하게 얹힙니다.</p>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStep(1)} className="rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-2 hover:border-line-strong">← 정보 수정</button>
                            <button type="button" onClick={savePlan} disabled={saved !== 'idle'}
                                className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60">
                                {saved === 'saved' ? <Check className="h-3.5 w-3.5 text-positive" /> : <FolderOpen className="h-3.5 w-3.5" />}
                                {saved === 'saved' ? '내 작업에 담았습니다' : '기획안 저장'}
                            </button>
                            {hero ? (
                                <button type="button" onClick={generateAll}
                                    className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black hover:opacity-90">
                                    <ImageIcon className="h-4 w-4" /> 이 느낌으로 {sections.length - 1}장 만들기
                                </button>
                            ) : (
                                <button type="button" onClick={makeHero} disabled={heroBusy}
                                    className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60">
                                    {heroBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                    {heroBusy ? '대표컷 만드는 중…' : '대표컷 먼저 만들기'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* 대표컷 — 모델·장소·조명·색감의 기준. 마음에 들 때까지 이것만 다시 만든다 */}
                    <div className="grid gap-4 rounded-card border border-line bg-paper p-4 md:grid-cols-[220px_1fr]">
                        <div className="aspect-[860/1000] overflow-hidden rounded-control bg-paper-2">
                            {hero
                                ? <img src={hero} alt="대표컷" className="h-full w-full object-cover" />
                                : <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-ink-3">{heroBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : '아직 없음'}</div>}
                        </div>
                        <div className="space-y-2 text-sm text-ink-2">
                            <p className="font-semibold text-ink">1. 대표컷을 먼저 확정하세요</p>
                            <p>나머지 {Math.max(0, sections.length - 1)}장은 이 컷의 <b className="text-ink">모델·장소·조명·색감</b>을 그대로 따라 만듭니다. 장마다 따로 만들면 모델도 배경도 제각각이라 한 브랜드의 페이지처럼 보이지 않습니다.</p>
                            <p className="text-[12px] text-ink-3">마음에 들 때까지 대표컷만 다시 만드세요. 한 장 비용으로 전체 톤이 정해집니다.</p>
                            {hero && (
                                <button type="button" onClick={makeHero} disabled={heroBusy}
                                    className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60">
                                    <RefreshCw className={`h-3.5 w-3.5 ${heroBusy ? 'animate-spin' : ''}`} /> 대표컷 다시 만들기
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        {sections.map(s => (
                            <div key={s.id} className="rounded-card border border-line bg-paper p-4">
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{s.number}. {s.role}</p>
                                <textarea value={s.mainCopy} onChange={e => patch(s.id, { mainCopy: e.target.value })} rows={2}
                                    className="mb-2 w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-sm font-semibold text-ink focus:border-line-strong focus:outline-none" />
                                <input value={s.subCopy} onChange={e => patch(s.id, { subCopy: e.target.value.slice(0, 40) })} placeholder="서브 문구 (선택)"
                                    className="w-full rounded-control border border-line bg-paper-2 px-3 py-1.5 text-[13px] text-ink-2 focus:border-line-strong focus:outline-none" />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 3. 이미지 ── */}
            {step === 3 && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-lg font-semibold text-ink">{name}</h3>
                            <p className="text-[12px] text-ink-3">
                                {running ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> 만드는 중 — {doneCount}/{sections.length}</span>
                                    : `완성 ${doneCount}/${sections.length}${failedCount ? ` · 실패 ${failedCount}` : ''}`}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setStep(2)} disabled={running} className="rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60">← 문구 수정</button>
                            {failedCount > 0 && !running && (
                                <button type="button" onClick={retryFailed} className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-2 hover:border-line-strong">
                                    <RefreshCw className="h-3.5 w-3.5" /> 실패 {failedCount}장 다시
                                </button>
                            )}
                            <button type="button" onClick={downloadZip} disabled={doneCount === 0 || zipping}
                                className="inline-flex items-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60">
                                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} ZIP 내려받기
                            </button>
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {sections.map(s => (
                            <div key={s.id} className="overflow-hidden rounded-card border border-line bg-paper">
                                <div className="relative aspect-[860/1000] bg-paper-2">
                                    {s.imageUrl ? (
                                        <img src={s.imageUrl} alt={s.role} className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-ink-3">
                                            {s.status === 'generating' ? <><Loader2 className="h-5 w-5 animate-spin" /> 만드는 중…</>
                                                : s.status === 'failed' ? <span className="text-critical">{s.error || '실패'}</span>
                                                    : '대기 중'}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-2 px-3 py-2">
                                    <p className="truncate text-[12px] text-ink-2">{s.number}. {s.role}</p>
                                    <div className="flex shrink-0 gap-1">
                                        {s.imageUrl && (
                                            <a href={s.imageUrl} download={`detail_${String(s.number).padStart(2, '0')}.png`}
                                                className="rounded-control border border-line p-1.5 text-ink-2 hover:border-line-strong" title="이 장만 저장"><Download className="h-3.5 w-3.5" /></a>
                                        )}
                                        <button type="button" onClick={() => void generateOne(s)} disabled={s.status === 'generating'}
                                            className="rounded-control border border-line p-1.5 text-ink-2 hover:border-line-strong disabled:opacity-50" title="다시 만들기">
                                            <RefreshCw className={`h-3.5 w-3.5 ${s.status === 'generating' ? 'animate-spin' : ''}`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
