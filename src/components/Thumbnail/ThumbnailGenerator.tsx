import React, { useState, useRef, useEffect } from 'react';
import { generateImage } from '../../api/aiService';
import { Loader2, Upload, Image as ImageIcon, Download, Wand2, X } from 'lucide-react';

export const ThumbnailGenerator: React.FC = () => {
    const [loading, setLoading] = useState(false);
    
    const [productName, setProductName] = useState('');
    const [customPrompt, setCustomPrompt] = useState('');
    const [shotType, setShotType] = useState<'product' | 'model'>('product');
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [resultImage, setResultImage] = useState<string>('');
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
            let prompt = "High quality e-commerce product thumbnail. Clean and professional style.";
            
            if (shotType === 'model') {
                prompt += ` A professional ${modelEthnicity === 'asian' ? 'Asian' : 'Western'} ${modelGender} fashion model posing elegantly with the product. 
                CRITICAL INSTRUCTIONS: 
                1. The model must have a COMPLETELY UNIQUE and FRESH face with ZERO resemblance to any person in the attached reference images. 
                2. Every generation MUST use a DIFFERENT facial structure, hairstyle, and appearance to ensure variety. 
                3. If multiple products are referenced, PLEASE GENERATE TWO SEPARATE MODELS in the same scene, with each model wearing one of the products respectively.`;
            } else {
                prompt += " A professional product shot. CRITICAL: NO mannequins, NO hangers, NO hands, NO stands, and NO human limbs. The product should be displayed as a clean flat lay or naturally draped in the scene.";
            }

            if (backgroundType === 'white') {
                prompt += " CRITICAL: The background MUST be a PURE SOLID WHITE (#FFFFFF) EMPTY SPACE. ABSOLUTELY NO SHADOWS, NO GRAY TONES, NO GRADIENTS, NO STUDIO WALLS, and NO FLOOR LINES. The subject must float in a pure white vacuum. The background must be 100% flat white hex #FFFFFF.";
            } else {
                prompt += " Create a SINGLE UNIFIED SCENE with a SEAMLESS CONSISTENT natural background captured in A SINGLE CONTINUOUS PHOTOGRAPH. ABSOLUTELY NO COLLAGE, NO SPLIT-SCREEN, NO SIDE-BY-SIDE PANELS, and NO VERTICAL DIVIDER LINES IN THE CENTER. Both models/items must coexist naturally in the EXACT SAME 3D environmental space with continuous flooring and walls.";
            }

            if (shotType === 'product') {
                prompt += " All subjects MUST be centered and occupy 70-80% of the square frame. Maintain a 10% safety margin from the edges. DO NOT CROP any part of the product (sleeves, collar, etc.). Ensure the ENTIRE product is visible.";
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
                    prompt += ` IMPORTANT: I have attached ${referenceImages.length} different reference images. You MUST extract ALL items (front, back, or different colors) and place them BOTH together in A SINGLE UNIFIED COMPOSITION. If shotType is 'model', generate TWO DIFFERENT models, one for each product. Ensure they are in a SINGLE unified scene with a CONSISTENT background. Every model MUST have a NEW, UNIQUE face.`;
                } else {
                    prompt += " Use the attached image ONLY as the product detail reference. Focus on the product's shape, texture, and color. If there is a person in the reference, DO NOT use their likeness. Generate a COMPLETELY NEW face and person.";
                }
            }

            const imageUrl = await generateImage(prompt, referenceImages, "1:1");
            if (imageUrl) {
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

    return (
        <div className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Input Form */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                <h2 className="text-2xl font-bold text-slate-800 mb-6">썸네일 제작</h2>
                
                <div className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">상품명 (선택 사항)</label>
                        <input 
                            type="text" 
                            value={productName} 
                            onChange={e => setProductName(e.target.value)} 
                            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                            placeholder="상품명을 입력해주세요" 
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">컷 타입 선택</label>
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <button
                                onClick={() => setShotType('product')}
                                className={`p-3 rounded-xl border font-medium transition-all ${shotType === 'product' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}
                            >
                                제품컷 (Product)
                            </button>
                            <button
                                onClick={() => setShotType('model')}
                                className={`p-3 rounded-xl border font-medium transition-all ${shotType === 'model' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}
                            >
                                모델컷 (Model)
                            </button>
                        </div>
                    </div>

                    {shotType === 'model' && (
                        <div className="space-y-4 mb-5 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">모델 인종</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setModelEthnicity('asian')}
                                        className={`p-2 rounded-lg border text-sm transition-all ${modelEthnicity === 'asian' ? 'bg-white border-blue-500 text-blue-600' : 'bg-transparent border-slate-200 text-slate-500'}`}
                                    >
                                        동양인
                                    </button>
                                    <button
                                        onClick={() => setModelEthnicity('western')}
                                        className={`p-2 rounded-lg border text-sm transition-all ${modelEthnicity === 'western' ? 'bg-white border-blue-500 text-blue-600' : 'bg-transparent border-slate-200 text-slate-500'}`}
                                    >
                                        서양인
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">모델 성별</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setModelGender('female')}
                                        className={`p-2 rounded-lg border text-sm transition-all ${modelGender === 'female' ? 'bg-white border-blue-500 text-blue-600' : 'bg-transparent border-slate-200 text-slate-500'}`}
                                    >
                                        여성
                                    </button>
                                    <button
                                        onClick={() => setModelGender('male')}
                                        className={`p-2 rounded-lg border text-sm transition-all ${modelGender === 'male' ? 'bg-white border-blue-500 text-blue-600' : 'bg-transparent border-slate-200 text-slate-500'}`}
                                    >
                                        남성
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">배경 선택</label>
                        <div className="grid grid-cols-2 gap-3 mb-5">
                            <button
                                onClick={() => setBackgroundType('white')}
                                className={`p-3 rounded-xl border font-medium transition-all ${backgroundType === 'white' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}
                            >
                                화이트 배경
                            </button>
                            <button
                                onClick={() => setBackgroundType('natural')}
                                className={`p-3 rounded-xl border font-medium transition-all ${backgroundType === 'natural' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}
                            >
                                자연스러운 배경
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">상단/하단 문구 (선택 사항)</label>
                        <input 
                            type="text" 
                            value={overlayText} 
                            onChange={e => setOverlayText(e.target.value)} 
                            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-3" 
                            placeholder="이미지 위에 표시할 문구를 입력하세요" 
                        />
                        <div className="grid grid-cols-3 gap-2">
                            {(['top', 'middle', 'bottom'] as const).map((pos) => (
                                <button
                                    key={pos}
                                    onClick={() => setTextPosition(pos)}
                                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${textPosition === pos ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}
                                >
                                    {pos === 'top' ? '상단' : pos === 'middle' ? '중간' : '하단'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">추가 요청사항 (선택 사항)</label>
                        <textarea 
                            value={customPrompt} 
                            onChange={e => setCustomPrompt(e.target.value)} 
                            rows={2}
                            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none" 
                            placeholder="예: 상의만 두 사진을 한 장에 넣어줘, 배경은 바다로 해줘 등" 
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">레퍼런스 이미지 (다중 선택 가능)</label>
                        <div className="flex flex-col gap-3">
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center cursor-pointer hover:bg-slate-50 transition-colors"
                            >
                                <div className="flex flex-col items-center text-slate-500">
                                    <Upload className="w-6 h-6 mb-2 text-slate-400" />
                                    <p className="font-medium text-sm">클릭하여 제품 사진 업로드</p>
                                </div>
                                <input type="file" multiple ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                            </div>

                            {referenceImages.length > 0 && (
                                <div className="grid grid-cols-3 gap-3 mt-2">
                                    {referenceImages.map((img, idx) => (
                                        <div key={idx} className="relative aspect-square rounded-xl border border-slate-200 overflow-hidden group">
                                            <img src={img} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                                            <button 
                                                onClick={() => removeImage(idx)}
                                                className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-8 rounded-xl flex items-center justify-center transition-colors mt-4"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Wand2 className="w-5 h-5 mr-2" />}
                        썸네일 생성하기
                    </button>
                </div>
            </div>

            {/* Result View */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col">
                <h2 className="text-2xl font-bold text-slate-800 mb-6">결과물</h2>
                
                <div className="flex-grow flex items-center justify-center bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden relative aspect-square w-full max-w-[1000px] mx-auto">
                    {resultImage ? (
                        <img src={resultImage} alt="Generated Thumbnail" className="w-full h-full object-contain" />
                    ) : loading ? (
                        <div className="flex flex-col items-center text-slate-500">
                            <Loader2 className="w-10 h-10 animate-spin mb-3 text-blue-500" />
                            <p className="font-medium">AI가 썸네일을 디자인하고 있습니다...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center text-slate-400">
                            <ImageIcon className="w-12 h-12 mb-3 opacity-50" />
                            <p>생성된 썸네일이 이곳에 표시됩니다.</p>
                        </div>
                    )}
                </div>

                {resultImage && (
                    <div className="mt-6 flex justify-end">
                        <a 
                            href={resultImage}
                            download="thumbnail.png"
                            className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl flex items-center transition-colors"
                        >
                            <Download className="w-5 h-5 mr-2" />
                            다운로드
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
};
