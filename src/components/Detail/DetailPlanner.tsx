import React, { useState, useRef } from 'react';
import { planDetail, generateImage } from '../../api/aiService';
import { Loader2, Upload, Image as ImageIcon, Download, Wand2, ChevronRight, X } from 'lucide-react';

const generateSizeChartImage = (gender: 'women' | 'men', data: Record<string, Record<string, string>>): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1422;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const sizes = gender === 'women' ? ['55', '66', '77', '88'] : ['85', '100', '105', '110'];
    const columns = ['사이즈', '어깨넓이', '가슴넓이', '소매길이', '총장'];
    
    const startX = 50;
    const rowHeight = 80;
    const colWidth = 140;
    const tableHeight = rowHeight * (sizes.length + 1);
    const startY = (canvas.height - tableHeight) / 2;
    
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SIZE GUIDE', canvas.width / 2, startY - 100);
    
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('단면 기준(cm)이며, 측정 방법에 따라 1~3cm 오차가 있을 수 있습니다.', canvas.width / 2, startY - 40);
    
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(startX, startY, canvas.width - 100, rowHeight);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    columns.forEach((col, i) => {
        ctx.fillText(col, startX + (i * colWidth) + (colWidth / 2), startY + (rowHeight / 2));
    });
    
    ctx.font = '24px sans-serif';
    sizes.forEach((size, rowIndex) => {
        const y = startY + rowHeight * (rowIndex + 1);
        
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(canvas.width - 50, y);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        const rowData = data[size] || {};
        
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(size, startX + (colWidth / 2), y + (rowHeight / 2));
        
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#475569';
        ctx.fillText(rowData.shoulder || '-', startX + colWidth + (colWidth / 2), y + (rowHeight / 2));
        ctx.fillText(rowData.chest || '-', startX + colWidth * 2 + (colWidth / 2), y + (rowHeight / 2));
        ctx.fillText(rowData.sleeve || '-', startX + colWidth * 3 + (colWidth / 2), y + (rowHeight / 2));
        ctx.fillText(rowData.length || '-', startX + colWidth * 4 + (colWidth / 2), y + (rowHeight / 2));
    });
    
    ctx.beginPath();
    ctx.moveTo(startX, startY + rowHeight * (sizes.length + 1));
    ctx.lineTo(canvas.width - 50, startY + rowHeight * (sizes.length + 1));
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    return canvas.toDataURL('image/png');
};

export const DetailPlanner: React.FC = () => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
    
    // Step 1 State
    const [info, setInfo] = useState({
        name: '',
        category: '',
        features: '',
        target: '',
        imageInstruction: '',
    });
    const [length, setLength] = useState<number | 'auto'>('auto');
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Size Chart State
    const [includeSizeChart, setIncludeSizeChart] = useState(false);
    const [sizeGender, setSizeGender] = useState<'women' | 'men'>('women');
    const [sizeData, setSizeData] = useState<Record<string, Record<string, string>>>({});

    // Step 2 State
    const [segments, setSegments] = useState<any[]>([]);

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
        if (!info.name || !info.category) {
            alert("상품명, 카테고리를 입력해주세요.");
            return;
        }
        if (referenceImages.length < 2) {
            alert("최소 2장 이상의 실제 제품 사진을 업로드해주세요.");
            return;
        }
        setLoading(true);
        try {
            const plannedSegments = await planDetail({ ...info, length });
            
            if (includeSizeChart) {
                const sizeChartUrl = generateSizeChartImage(sizeGender, sizeData);
                plannedSegments.push({
                    id: 'size-chart-' + Date.now(),
                    title: '사이즈 가이드',
                    logicalSections: ['정보 제공', '사이즈표'],
                    keyMessage: '상세 사이즈를 확인하세요.',
                    visualPrompt: 'Size chart generated automatically.',
                    imageUrl: sizeChartUrl,
                    isGenerating: false
                });
            }
            
            setSegments(plannedSegments);
            setStep(2);
        } catch (e) {
            console.error(e);
            alert("기획 생성에 실패했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateAll = async () => {
        setStep(3);
        
        for (let i = 0; i < segments.length; i++) {
            if (segments[i].imageUrl) continue; // Skip already generated images (e.g., size chart)

            setSegments(prev => {
                const newSegs = [...prev];
                newSegs[i] = { ...newSegs[i], isGenerating: true };
                return newSegs;
            });
            
            try {
                const prompt = `High quality e-commerce web banner. Visual description: ${segments[i].visualPrompt}. Render the following Korean text clearly and aesthetically on the image: "${segments[i].keyMessage}". ${info.imageInstruction ? `CRITICAL INSTRUCTION: ${info.imageInstruction}` : ''}`;
                const imageUrl = await generateImage(prompt, referenceImages, "9:16");
                setSegments(prev => {
                    const newSegs = [...prev];
                    newSegs[i] = { ...newSegs[i], imageUrl, isGenerating: false };
                    return newSegs;
                });
            } catch (e) {
                console.error(e);
                setSegments(prev => {
                    const newSegs = [...prev];
                    newSegs[i] = { ...newSegs[i], isGenerating: false };
                    return newSegs;
                });
            }
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

    return (
        <div className="max-w-5xl mx-auto p-6">
            {/* Stepper */}
            <div className="flex items-center justify-between mb-8">
                {[1, 2, 3].map((s) => (
                    <div key={s} className="flex items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${step >= s ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                            {s}
                        </div>
                        <div className="ml-3">
                            <p className={`text-sm font-medium ${step >= s ? 'text-slate-900' : 'text-slate-500'}`}>
                                {s === 1 ? '정보 입력' : s === 2 ? '전략 기획' : '이미지 생성'}
                            </p>
                        </div>
                        {s < 3 && <ChevronRight className="w-5 h-5 mx-4 text-slate-300" />}
                    </div>
                ))}
            </div>

            {step === 1 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                    <h2 className="text-2xl font-bold text-slate-800 mb-6">상품 정보 입력</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">상품명 *</label>
                            <input type="text" value={info.name} onChange={e => setInfo({...info, name: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 무중력 메모리폼 베개" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">카테고리 *</label>
                            <input type="text" value={info.category} onChange={e => setInfo({...info, category: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 리빙/침구" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">핵심 특징 (USP)</label>
                            <textarea value={info.features} onChange={e => setInfo({...info, features: e.target.value})} rows={3} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="상품의 주요 장점을 입력하세요." />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">타겟 고객</label>
                            <input type="text" value={info.target} onChange={e => setInfo({...info, target: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 20-30대 직장인 여성" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">이미지 생성 추가 요청사항 <span className="text-slate-400 font-normal">(선택)</span></label>
                            <input type="text" value={info.imageInstruction} onChange={e => setInfo({...info, imageInstruction: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 사진에 있는 색상만 이미지를 만들어줘" />
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">레퍼런스 이미지 (최소 2장 필수)</label>
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center cursor-pointer hover:bg-slate-50 transition-colors"
                            >
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

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">상세페이지 길이 (구조)</label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { val: 'auto', label: 'Auto (AI 추천)', desc: '최적 길이 자동 판단' },
                                    { val: 5, label: '5장 (Short)', desc: '저관여/저가 집중형' },
                                    { val: 7, label: '7장 (Standard)', desc: '일반적인 구성' },
                                    { val: 9, label: '9장 (Long)', desc: '고관여/스토리텔링' }
                                ].map(opt => (
                                    <div 
                                        key={opt.val}
                                        onClick={() => setLength(opt.val as any)}
                                        className={`p-4 rounded-xl border cursor-pointer transition-all ${length === opt.val ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-blue-300'}`}
                                    >
                                        <div className="font-medium text-slate-800 mb-1">{opt.label}</div>
                                        <div className="text-xs text-slate-500">{opt.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="md:col-span-2 border-t border-slate-200 pt-6 mt-2">
                            <div className="flex items-center justify-between mb-4">
                                <label className="flex items-center text-sm font-bold text-slate-800 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={includeSizeChart} 
                                        onChange={(e) => setIncludeSizeChart(e.target.checked)}
                                        className="mr-2 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                    />
                                    사이즈표 추가하기
                                </label>
                            </div>

                            {includeSizeChart && (
                                <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                                    <div className="flex gap-6 mb-4">
                                        <label className="flex items-center cursor-pointer">
                                            <input type="radio" name="gender" checked={sizeGender === 'women'} onChange={() => setSizeGender('women')} className="mr-2 w-4 h-4 text-blue-600" />
                                            <span className="font-medium text-slate-700">여성 (55, 66, 77, 88)</span>
                                        </label>
                                        <label className="flex items-center cursor-pointer">
                                            <input type="radio" name="gender" checked={sizeGender === 'men'} onChange={() => setSizeGender('men')} className="mr-2 w-4 h-4 text-blue-600" />
                                            <span className="font-medium text-slate-700">남성 (85, 100, 105, 110)</span>
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
                                                {(sizeGender === 'women' ? ['55', '66', '77', '88'] : ['85', '100', '105', '110']).map((size) => (
                                                    <tr key={size} className="bg-white border-b border-slate-200">
                                                        <td className="px-4 py-3 font-bold text-slate-900 text-center">{size}</td>
                                                        {['shoulder', 'chest', 'sleeve', 'length'].map((field) => (
                                                            <td key={field} className="px-4 py-2">
                                                                <input 
                                                                    type="text" 
                                                                    placeholder="cm"
                                                                    value={sizeData[size]?.[field] || ''}
                                                                    onChange={(e) => {
                                                                        setSizeData(prev => ({
                                                                            ...prev,
                                                                            [size]: {
                                                                                ...(prev[size] || {}),
                                                                                [field]: e.target.value
                                                                            }
                                                                        }));
                                                                    }}
                                                                    className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-center"
                                                                />
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
                    </div>

                    <div className="mt-8 flex justify-end">
                        <button 
                            onClick={handlePlan} 
                            disabled={loading || referenceImages.length < 2}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors"
                        >
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
                        <button 
                            onClick={handleGenerateAll}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors"
                        >
                            <ImageIcon className="w-5 h-5 mr-2" />
                            이미지 일괄 생성
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        {segments.map((seg, idx) => (
                            <div key={seg.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-6">
                                <div className="w-full md:w-1/4 flex flex-col justify-center items-center bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <div className="text-4xl font-black text-slate-200 mb-2">{String(idx + 1).padStart(2, '0')}</div>
                                    <div className="font-bold text-slate-700 text-center">{seg.title}</div>
                                    <div className="mt-3 flex flex-wrap gap-1 justify-center">
                                        {seg.logicalSections.map((tag: string) => (
                                            <span key={tag} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md font-medium">{tag}</span>
                                        ))}
                                    </div>
                                </div>
                                <div className="w-full md:w-3/4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Key Message (이미지에 들어갈 카피)</label>
                                        <textarea 
                                            value={seg.keyMessage}
                                            onChange={(e) => {
                                                const newSegs = [...segments];
                                                newSegs[idx].keyMessage = e.target.value;
                                                setSegments(newSegs);
                                            }}
                                            rows={2}
                                            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none font-medium"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Visual Prompt (이미지 연출 지시)</label>
                                        <textarea 
                                            value={seg.visualPrompt}
                                            onChange={(e) => {
                                                const newSegs = [...segments];
                                                newSegs[idx].visualPrompt = e.target.value;
                                                setSegments(newSegs);
                                            }}
                                            rows={2}
                                            className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm text-slate-600"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800">상세페이지 결과물</h2>
                            <p className="text-slate-500 mt-1">생성된 이미지를 확인하고 다운로드하세요.</p>
                        </div>
                        <button 
                            onClick={handleDownloadAll}
                            className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors"
                        >
                            <Download className="w-5 h-5 mr-2" />
                            전체 다운로드
                        </button>
                    </div>

                    <div className="flex justify-center">
                        <div className="w-full max-w-md bg-white shadow-2xl overflow-hidden" style={{ minHeight: '800px' }}>
                            {segments.map((seg, idx) => (
                                <div key={seg.id} className="relative w-full aspect-[9/16] bg-slate-100 border-b border-slate-200 flex items-center justify-center">
                                    {seg.imageUrl ? (
                                        <img src={seg.imageUrl} alt={`Section ${idx + 1}`} className="w-full h-full object-cover" />
                                    ) : seg.isGenerating ? (
                                        <div className="flex flex-col items-center text-slate-500">
                                            <Loader2 className="w-8 h-8 animate-spin mb-2 text-blue-500" />
                                            <p className="font-medium">이미지 생성 중...</p>
                                        </div>
                                    ) : (
                                        <div className="text-slate-400">대기 중...</div>
                                    )}
                                    
                                    {/* Overlay for debugging/info */}
                                    <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
                                        {idx + 1}. {seg.title}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
