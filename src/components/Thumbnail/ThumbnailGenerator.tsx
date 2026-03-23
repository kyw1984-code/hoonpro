import React, { useState, useRef, useEffect } from 'react';
import { removeBackground, generateImage } from '../../api/aiService';
import { Loader2, Upload, Image as ImageIcon, Download, Wand2, Scissors, X } from 'lucide-react';

export const ThumbnailGenerator: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [removingBg, setRemovingBg] = useState(false);
    
    const [productName, setProductName] = useState('');
    const [customPrompt, setCustomPrompt] = useState('');
    const [shotType, setShotType] = useState<'product' | 'model'>('product');
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [resultImage, setResultImage] = useState<string>('');
    const [baseImage, setBaseImage] = useState<string>('');
    const [overlayText, setOverlayText] = useState('');
    const [textPosition, setTextPosition] = useState<'top' | 'middle' | 'bottom'>('top');
    
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

    const handleRemoveBg = async () => {
        if (referenceImages.length === 0) {
            alert("이미지를 먼저 업로드해주세요.");
            return;
        }
        setRemovingBg(true);
        try {
            // Remove background for the first image as an example, or all if needed.
            // Here we'll just process the first one for simplicity, or we can map over all.
            const updatedImages = [...referenceImages];
            updatedImages[0] = await removeBackground(referenceImages[0]);
            setReferenceImages(updatedImages);
            alert("첫 번째 이미지의 배경이 제거되었습니다.");
        } catch (e) {
            console.error(e);
            alert("배경 제거에 실패했습니다. API 키를 확인해주세요.");
        } finally {
            setRemovingBg(false);
        }
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
                prompt += " A professional model posing with the product on a pure white background.";
            } else {
                prompt += " A full shot of the product clearly visible on a pure white background, with absolutely no people or hands.";
            }

            if (productName) {
                prompt += ` Product: ${productName}. Do not include any text or typography in the image.`;
            } else {
                prompt += " Emotional and aesthetic product shot. Do not include any text or typography in the image.";
            }

            if (customPrompt) {
                prompt += ` User specific instructions: ${customPrompt}.`;
            }

            if (referenceImages.length > 0) {
                if (referenceImages.length > 1) {
                    prompt += ` IMPORTANT: I have attached ${referenceImages.length} different reference images. You MUST extract the subjects from ALL attached images and place them together (e.g., side-by-side or composed naturally) in this single generated image. Ensure every single referenced item is clearly visible.`;
                } else {
                    prompt += " Use the attached image as the main product reference.";
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
                            
                            const scale = Math.min(1000 / img.width, 1000 / img.height);
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
                <h2 className="text-2xl font-bold text-slate-800 mb-6">썸네일 설정</h2>
                
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
                        <div className="grid grid-cols-2 gap-3">
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
                            
                            {referenceImages.length > 0 && (
                                <button 
                                    onClick={handleRemoveBg}
                                    disabled={removingBg}
                                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-xl flex items-center justify-center transition-colors border border-slate-200 mt-2"
                                >
                                    {removingBg ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Scissors className="w-4 h-4 mr-2" />}
                                    첫 번째 이미지 누끼 따기
                                </button>
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
