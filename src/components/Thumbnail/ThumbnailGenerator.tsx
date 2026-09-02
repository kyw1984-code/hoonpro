import React, { useState, useRef, useEffect } from 'react';
import { generateImage } from '../../api/aiService';
import { Box, Download, FolderOpen, Image as ImageIcon, Layers3, Loader2, Palette, Sparkles, Type, Upload, Wand2, X, UserRound } from 'lucide-react';
import { getToken } from '../../lib/auth';

export const ThumbnailGenerator: React.FC = () => {
    const [loading, setLoading] = useState(false);
    
    const [productName, setProductName] = useState('');
    const [customPrompt, setCustomPrompt] = useState('');
    const [shotType, setShotType] = useState<'product' | 'model'>('product');
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [resultImage, setResultImage] = useState<string>('');
    // 보관함 저장 (내 작업 탭에서 다시 보기)
    const [workSaving, setWorkSaving] = useState(false);
    const [workSaved, setWorkSaved] = useState(false);

    const saveToWorks = async () => {
        if (!resultImage || workSaving || workSaved) return;
        setWorkSaving(true);
        try {
            const res = await fetch('/api/works?action=save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ kind: 'thumbnail', title: `썸네일 ${new Date().toLocaleDateString('ko-KR')}`, image: resultImage }),
            });
            const data = await res.json();
            if (!res.ok || data.error) alert(data.error || '보관함 저장 실패');
            else setWorkSaved(true);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setWorkSaving(false);
        }
    };
    const [baseImage, setBaseImage] = useState<string>('');
    const [overlayText, setOverlayText] = useState('');
    const [textPosition, setTextPosition] = useState<'top' | 'middle' | 'bottom'>('top');
    const [backgroundType, setBackgroundType] = useState<'white' | 'natural'>('white');
    const [modelEthnicity, setModelEthnicity] = useState<'asian' | 'western'>('asian');
    const [modelGender, setModelGender] = useState<'male' | 'female'>('female');
    
    const fileInputRef = useRef<HTMLInputElement>(null);

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


    const applyTextOverlay = (imageSrc: string, text: string, position: 'top' | 'middle' | 'bottom') => {
        if (!imageSrc) return;
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 1000;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Draw background image
            ctx.drawImage(img, 0, 0, 1000, 1000);

            if (text) {
                // Text settings
                ctx.fillStyle = 'white';
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 12;
                ctx.lineJoin = 'round';
                ctx.textAlign = 'center';
                ctx.font = 'bold 80px "Inter", sans-serif';

                let y = 0;
                if (position === 'top') y = 150;
                else if (position === 'middle') y = 500;
                else if (position === 'bottom') y = 850;

                // Draw stroke first
                ctx.strokeText(text, 500, y);
                // Draw fill
                ctx.fillText(text, 500, y);
            }

            setResultImage(canvas.toDataURL('image/png'));
        };
        img.src = imageSrc;
    };

    useEffect(() => {
        if (baseImage) {
            applyTextOverlay(baseImage, overlayText, textPosition);
        }
    }, [overlayText, textPosition, baseImage]);

    const handleGenerate = async () => {
        setLoading(true);
        try {
            const referenceCount = referenceImages.length;
            let prompt = "High quality e-commerce product thumbnail. Clean and professional style. SINGLE UNIFIED IMAGE ONLY: no collage, no split-screen, no divided panels, no duplicated same model in multiple poses, no side-by-side separate photos, no vertical divider line, no before/after layout.";
            
            if (shotType === 'model') {
                const modelCount = Math.max(1, referenceCount);
                prompt += ` A professional ${modelEthnicity === 'asian' ? 'Asian' : 'Western'} ${modelGender} fashion model thumbnail with the product. 
                CRITICAL INSTRUCTIONS: 
                1. The model must have a COMPLETELY UNIQUE and FRESH face with ZERO resemblance to any person in the attached reference images. 
                2. Every generation MUST use a DIFFERENT facial structure, hairstyle, and appearance to ensure variety. 
                3. Exact model count lock: generate exactly ${modelCount} model${modelCount > 1 ? 's' : ''}, not more and not fewer.
                4. If there is only one reference image, generate exactly ONE model wearing/using that one product. Do NOT duplicate the same model, do NOT show the same model in multiple poses, and do NOT create a split layout.
                5. If multiple product reference images are attached, generate exactly ${modelCount} models in one unified scene, one model per reference product/color. The models should share the same camera angle, scale, lighting, background, styling, and pose family so the image feels cohesive.`;
            } else {
                prompt += " A professional product-only shot. CRITICAL: NO mannequins, NO hangers, NO hands, NO stands, NO human limbs, NO props, NO accessories, NO decoration, NO jewelry, NO flowers, NO plants, NO boxes, NO fabric, NO ribbons, NO tools, NO extra objects. Show only the product itself.";
            }

            if (backgroundType === 'white') {
                prompt += " CRITICAL WHITE CATALOG MODE: The background MUST be a PURE SOLID WHITE (#FFFFFF) EMPTY SPACE. ABSOLUTELY NO SHADOWS, NO GRAY TONES, NO GRADIENTS, NO STUDIO WALLS, NO FLOOR LINES, NO TABLE, NO PEDESTAL, NO PLATFORM, NO SURFACE, NO PROPS, NO ACCESSORIES, NO DECORATION, and NO EXTRA OBJECTS. The subject must float in a pure white vacuum. The background must be 100% flat white hex #FFFFFF.";
            } else {
                prompt += " Create a SINGLE UNIFIED SCENE with a SEAMLESS CONSISTENT natural background captured in A SINGLE CONTINUOUS PHOTOGRAPH. ABSOLUTELY NO COLLAGE, NO SPLIT-SCREEN, NO SIDE-BY-SIDE PANELS, and NO VERTICAL DIVIDER LINES IN THE CENTER. All models/items must coexist naturally in the EXACT SAME 3D environmental space with continuous flooring and walls.";
            }

            if (shotType === 'product') {
                prompt += " Product-only catalog composition. All subjects MUST be centered and occupy 70-80% of the square frame. Maintain a 10% safety margin from the edges. DO NOT CROP any part of the product (sleeves, collar, etc.). Ensure the ENTIRE product is visible. No styling objects around it.";
            } else {
                prompt += " Maintain a tight portrait scale (waist-up or half-body portrait). The product size MUST be SMALL and REALISTIC relative to the model's hand and body. DO NOT enlarge the product. CRITICAL: The FRONT FACE and key features of the product must be ORIENTED TOWARD THE CAMERA for maximum visibility. Ensure the product is shown from its BEST HERO ANGLE.";
            }

            if (productName) {
                prompt += ` CRITICAL PRODUCT IDENTITY: The subject is ${productName}. You MUST generate this EXACT category of item. DO NOT change it into anything else.`;
            } else {
                prompt += " CRITICAL PRODUCT IDENTITY: You MUST identify the EXACT category and shape of the main object in the reference images and replicate its identity perfectly. DO NOT transform the product into a different object (e.g. do not turn a device into clothing).";
            }

            prompt += " Maintain the original geometry, material texture, and functional details exactly as shown in the references.";

            if (customPrompt) {
                prompt += ` User specific instructions: ${customPrompt}.`;
            }

            if (referenceImages.length > 0) {
                if (referenceImages.length > 1) {
                    prompt += ` IMPORTANT: I have attached ${referenceImages.length} different reference images. You MUST extract ALL items (front, back, or different colors) and place them together in A SINGLE UNIFIED COMPOSITION. If shotType is 'model', generate exactly ${referenceImages.length} models, one model wearing one different referenced product/color. Do not create extra models and do not duplicate one reference product while ignoring another. If shotType is 'product', show only the referenced products themselves, with no accessories or extra objects. Ensure they are in a SINGLE unified scene with a CONSISTENT background. Every model MUST have a NEW, UNIQUE face.`;
                } else {
                    prompt += " Use the attached image ONLY as the product detail reference. Focus on the product's shape, texture, and color. If shotType is 'model', generate exactly ONE model only, wearing or using the single referenced product. If there is a person in the reference, DO NOT use their likeness. Generate a COMPLETELY NEW face and person.";
                }
            }

            const result = await generateImage(prompt, referenceImages, "1:1", undefined, {
                referenceRoles: referenceImages.map((_, idx) => (
                    referenceImages.length > 1
                        ? `Image ${idx + 1}: thumbnail bundle item ${idx + 1} reference - preserve as a separate product/color in the unified thumbnail`
                        : `Image ${idx + 1}: single thumbnail product reference - use one model only if model cut`
                )),
            });
            const imageUrl = result?.image;
            if (imageUrl) {
                setWorkSaved(false);
                const resizedUrl = await new Promise<string>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = 1000;
                        canvas.height = 1000;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillRect(0, 0, 1000, 1000);
                            
                             const scale = backgroundType === 'natural' 
                                ? Math.max(1000 / img.width, 1000 / img.height)
                                : Math.min(1000 / img.width, 1000 / img.height);
                            
                            const x = (1000 / 2) - (img.width / 2) * scale;
                            const y = (1000 / 2) - (img.height / 2) * scale;
                            
                            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                            resolve(canvas.toDataURL('image/png'));
                        } else {
                            resolve(imageUrl);
                        }
                    };
                    img.src = imageUrl;
                });
                setBaseImage(resizedUrl);
            }
        } catch (e) {
            console.error(e);
            alert("썸네일 생성에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const selectedTone = backgroundType === 'white' ? '순백 제품 중심' : '공간감 있는 연출';
    const selectedShot = shotType === 'product' ? '제품컷' : '모델컷';

    return (
        <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-accent-line bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
                        <Sparkles className="h-3.5 w-3.5" />
                        THUMBNAIL STUDIO
                    </div>
                    <h2 className="mt-3 text-[26px] font-semibold tracking-tight text-ink">썸네일 제작</h2>
                    <p className="mt-2 text-sm text-ink-2">제품 사진을 기반으로 커머스용 정사각 썸네일을 생성합니다.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    {[
                        ['컷 타입', selectedShot],
                        ['배경', selectedTone],
                        ['레퍼런스', `${referenceImages.length}장`],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-card border border-line bg-paper px-4 py-3">
                            <p className="font-semibold text-ink-3">{label}</p>
                            <p className="mt-1 font-semibold text-ink">{value}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
                {/* Input Form */}
                <div className="rounded-card border border-line bg-paper">
                    <div className="border-b border-line px-6 py-5">
                        <div className="flex items-center gap-2">
                            <div className="flex h-9 w-9 items-center justify-center rounded-card bg-ink text-paper">
                                <Palette className="h-4.5 w-4.5" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-ink">제작 설정</h3>
                                <p className="text-xs text-ink-2">컷, 배경, 문구, 레퍼런스를 지정하세요.</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-5 p-6">
                    <div>
                        <label className="block text-sm font-medium text-ink mb-1">상품명 (선택 사항)</label>
                        <input 
                            type="text" 
                            value={productName} 
                            onChange={e => setProductName(e.target.value)} 
                            className="w-full p-3 border border-line-strong rounded-card focus:border-accent outline-none" 
                            placeholder="상품명을 입력해주세요" 
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink mb-2">컷 타입 선택</label>
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <button
                                onClick={() => setShotType('product')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-card border font-semibold transition-all ${shotType === 'product' ? 'border-ink bg-ink text-paper ' : 'border-line text-ink-2 hover:border-line-strong hover:bg-paper-2'}`}
                            >
                                <Box className="h-4 w-4" />
                                제품컷 (Product)
                            </button>
                            <button
                                onClick={() => setShotType('model')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-card border font-semibold transition-all ${shotType === 'model' ? 'border-ink bg-ink text-paper ' : 'border-line text-ink-2 hover:border-line-strong hover:bg-paper-2'}`}
                            >
                                <UserRound className="h-4 w-4" />
                                모델컷 (Model)
                            </button>
                        </div>
                    </div>

                    {shotType === 'model' && (
                        <div className="space-y-4 mb-5 p-4 bg-paper-2 rounded-card border border-line">
                            <div>
                                <label className="block text-xs font-semibold text-ink-2 uppercase mb-2">모델 인종</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setModelEthnicity('asian')}
                                        className={`p-2 rounded-control border text-sm font-semibold transition-all ${modelEthnicity === 'asian' ? 'bg-paper border-ink text-ink ' : 'bg-transparent border-line text-ink-2 hover:bg-paper'}`}
                                    >
                                        동양인
                                    </button>
                                    <button
                                        onClick={() => setModelEthnicity('western')}
                                        className={`p-2 rounded-control border text-sm font-semibold transition-all ${modelEthnicity === 'western' ? 'bg-paper border-ink text-ink ' : 'bg-transparent border-line text-ink-2 hover:bg-paper'}`}
                                    >
                                        서양인
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-ink-2 uppercase mb-2">모델 성별</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setModelGender('female')}
                                        className={`p-2 rounded-control border text-sm font-semibold transition-all ${modelGender === 'female' ? 'bg-paper border-ink text-ink ' : 'bg-transparent border-line text-ink-2 hover:bg-paper'}`}
                                    >
                                        여성
                                    </button>
                                    <button
                                        onClick={() => setModelGender('male')}
                                        className={`p-2 rounded-control border text-sm font-semibold transition-all ${modelGender === 'male' ? 'bg-paper border-ink text-ink ' : 'bg-transparent border-line text-ink-2 hover:bg-paper'}`}
                                    >
                                        남성
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-ink mb-2">배경 선택</label>
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <button
                                onClick={() => setBackgroundType('white')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-card border font-semibold transition-all ${backgroundType === 'white' ? 'border-ink bg-ink text-paper ' : 'border-line text-ink-2 hover:border-line-strong hover:bg-paper-2'}`}
                            >
                                <ImageIcon className="h-4 w-4" />
                                화이트 배경
                            </button>
                            <button
                                onClick={() => setBackgroundType('natural')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-card border font-semibold transition-all ${backgroundType === 'natural' ? 'border-ink bg-ink text-paper ' : 'border-line text-ink-2 hover:border-line-strong hover:bg-paper-2'}`}
                            >
                                <Layers3 className="h-4 w-4" />
                                자연스러운 배경
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="flex items-center gap-1.5 text-sm font-medium text-ink mb-1"><Type className="h-4 w-4 text-ink-3" />상단/하단 문구 (선택 사항)</label>
                        <input 
                            type="text" 
                            value={overlayText} 
                            onChange={e => setOverlayText(e.target.value)} 
                            className="w-full p-3 border border-line-strong rounded-card focus:border-accent outline-none mb-3" 
                            placeholder="이미지 위에 표시할 문구를 입력하세요" 
                        />
                        <div className="grid grid-cols-3 gap-2">
                            {(['top', 'middle', 'bottom'] as const).map((pos) => (
                                <button
                                    key={pos}
                                    onClick={() => setTextPosition(pos)}
                                    className={`py-2 px-3 rounded-control border text-sm font-semibold transition-all ${textPosition === pos ? 'border-ink bg-ink text-paper' : 'border-line text-ink-2 hover:border-line-strong hover:bg-paper-2'}`}
                                >
                                    {pos === 'top' ? '상단' : pos === 'middle' ? '중간' : '하단'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink mb-1">추가 요청사항 (선택 사항)</label>
                        <textarea 
                            value={customPrompt} 
                            onChange={e => setCustomPrompt(e.target.value)} 
                            rows={2}
                            className="w-full p-3 border border-line-strong rounded-card focus:border-accent outline-none resize-none" 
                            placeholder="예: 상의만 두 사진을 한 장에 넣어줘, 배경은 바다로 해줘 등" 
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink mb-2">레퍼런스 이미지 (다중 선택 가능)</label>
                        <div className="flex flex-col gap-3">
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="border border-dashed border-line-strong rounded-card bg-paper-2/70 p-6 text-center cursor-pointer transition-colors hover:border-ink hover:bg-paper"
                            >
                                <div className="flex flex-col items-center text-ink-2">
                                    <Upload className="w-6 h-6 mb-2 text-ink-3" />
                                    <p className="font-medium text-sm">클릭하여 제품 사진 업로드</p>
                                </div>
                                <input type="file" multiple ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                            </div>

                            {referenceImages.length > 0 && (
                                <div className="grid grid-cols-3 gap-3 mt-2">
                                    {referenceImages.map((img, idx) => (
                                        <div key={idx} className="relative aspect-square rounded-card border border-line overflow-hidden group">
                                            <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                                            <button 
                                                onClick={() => removeImage(idx)}
                                                className="absolute top-1 right-1 bg-black/50 text-paper p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <button 
                        onClick={handleGenerate} 
                        disabled={loading}
                        className="w-full bg-ink hover:bg-ink-2 disabled:bg-line-strong text-paper font-semibold py-3.5 px-8 rounded-card flex items-center justify-center transition-colors mt-4"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Wand2 className="w-5 h-5 mr-2" />}
                        썸네일 생성하기
                    </button>
                </div>
            </div>

            {/* Result View */}
            <div className="rounded-card border border-line bg-paper p-6 lg:sticky lg:top-24 lg:self-start">
                <div className="mb-5 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-ink">결과물</h2>
                        <p className="mt-1 text-xs text-ink-2">1000 x 1000 PNG</p>
                    </div>
                    {resultImage && (
                        <div className="flex items-center gap-2">
                        <button onClick={saveToWorks} disabled={workSaving || workSaved}
                            title="내 작업 탭에 저장 — 새로고침해도 사라지지 않습니다"
                            className="flex items-center rounded-card border border-line px-4 py-2.5 font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60">
                            {workSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FolderOpen className="w-4 h-4 mr-2" />}
                            {workSaved ? '저장됨 ✓' : '보관함에 저장'}
                        </button>
                        <a 
                            href={resultImage}
                            download="thumbnail.png"
                            className="bg-ink hover:bg-ink-2 text-paper font-semibold py-2.5 px-4 rounded-card flex items-center transition-colors"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            다운로드
                        </a>
                        </div>
                    )}
                </div>
                
                <div className="flex items-center justify-center overflow-hidden relative aspect-square w-full rounded-card border border-line bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]">
                    {resultImage ? (
                        <img src={resultImage} alt="Generated Thumbnail" className="w-full h-full object-contain" />
                    ) : loading ? (
                        <div className="flex flex-col items-center text-ink-2">
                            <Loader2 className="w-10 h-10 animate-spin mb-3 text-accent" />
                            <p className="font-medium">AI가 썸네일을 디자인하고 있습니다...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center text-ink-3">
                            <ImageIcon className="w-12 h-12 mb-3 opacity-50" />
                            <p>생성된 썸네일이 이곳에 표시됩니다.</p>
                        </div>
                    )}
                </div>
            </div>
            </div>
        </div>
    );
};
