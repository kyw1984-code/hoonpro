import React, { useState, useRef } from 'react';
import { planDetail, generateImage } from '../../api/aiService';
import { Loader2, Upload, Image as ImageIcon, Download, Wand2, ChevronRight, X } from 'lucide-react';

// ✅ 인증서 이미지 생성 함수
const generateCertificateImage = (certType: string, certNumber: string, certDate: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;

    // 배경 그라디언트
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#f8fafc');
    gradient.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 테두리
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

    // 인증 아이콘 (체크마크)
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 200, 60, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 30, 200);
    ctx.lineTo(canvas.width / 2 - 10, 220);
    ctx.lineTo(canvas.width / 2 + 30, 180);
    ctx.stroke();

    // 제목
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 48px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('품질 인증서', canvas.width / 2, 320);

    // 인증 타입
    ctx.font = 'bold 38px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(certType, canvas.width / 2, 420);

    // 인증 정보
    ctx.font = '28px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`인증번호: ${certNumber}`, canvas.width / 2, 520);
    ctx.fillText(`발급일자: ${certDate}`, canvas.width / 2, 580);

    // 설명
    ctx.font = '24px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#94a3b8';
    const desc = '본 제품은 엄격한 품질 기준을 통과한';
    const desc2 = '안전하고 신뢰할 수 있는 제품입니다.';
    ctx.fillText(desc, canvas.width / 2, 700);
    ctx.fillText(desc2, canvas.width / 2, 750);

    return canvas.toDataURL('image/png');
};

// ✅ 고객 후기 이미지 생성 함수
const generateReviewImage = (reviews: Array<{ rating: number; text: string; author: string }>): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;

    // 배경
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 제목
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 42px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('고객 후기', canvas.width / 2, 80);

    // 평점 표시
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#fbbf24';
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    ctx.fillText('★'.repeat(Math.round(avgRating)), canvas.width / 2, 140);

    // 후기 카드들
    let yOffset = 200;
    reviews.forEach((review, idx) => {
        if (idx >= 3) return; // 최대 3개만

        // 카드 배경
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(60, yOffset, canvas.width - 120, 200);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(60, yOffset, canvas.width - 120, 200);

        // 별점
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'left';
        ctx.fillText('★'.repeat(review.rating), 80, yOffset + 40);

        // 후기 텍스트
        ctx.font = '22px "Noto Sans KR", sans-serif';
        ctx.fillStyle = '#334155';
        const maxWidth = canvas.width - 160;
        const words = review.text.split(' ');
        let line = '';
        let lineY = yOffset + 85;

        for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && i > 0) {
                ctx.fillText(line, 80, lineY);
                line = words[i] + ' ';
                lineY += 30;
                if (lineY > yOffset + 150) break; // 최대 3줄
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, 80, lineY);

        // 작성자
        ctx.font = 'bold 20px "Noto Sans KR", sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText(`- ${review.author}`, canvas.width - 80, yOffset + 170);

        yOffset += 240;
    });

    return canvas.toDataURL('image/png');
};

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

// ✅ AI 이미지를 860×1000으로 리사이즈 후 한글 텍스트 Canvas 덧씌우기
const TARGET_WIDTH = 860;
const TARGET_HEIGHT = 1000;

const overlayTextOnImage = (imageUrl: string, keyMessage: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new window.Image();
        // base64 이미지는 crossOrigin 불필요 - 오히려 깨짐 원인
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = TARGET_WIDTH;
            canvas.height = TARGET_HEIGHT;
            const ctx = canvas.getContext('2d')!;

            // 이미지를 860×1000에 cover 방식으로 그리기 (꽉 채우기, 검정 없음)
            const imgRatio = img.width / img.height;
            const canvasRatio = TARGET_WIDTH / TARGET_HEIGHT;
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (imgRatio > canvasRatio) {
                // 이미지가 더 넓음 → 좌우 크롭
                sh = img.height;
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                // 이미지가 더 높음 → 상하 크롭 (중앙 기준)
                sw = img.width;
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

            if (!keyMessage.trim()) {
                resolve(canvas.toDataURL('image/png'));
                return;
            }

            const lines = keyMessage.split('\n').filter(l => l.trim());

            // 줄 수에 따라 폰트 크기 조정 (더 많은 줄 = 작은 폰트)
            let fontSize = lines.length === 1 ? 48 : lines.length === 2 ? 42 : 36;
            const lineHeight = fontSize * 1.5;
            const totalTextHeight = lines.length * lineHeight;

            // 하단 그라디언트 오버레이 (여유 공간 확보)
            const overlayH = totalTextHeight + fontSize * 3;
            const overlayY = TARGET_HEIGHT - overlayH;
            const gradient = ctx.createLinearGradient(0, overlayY, 0, TARGET_HEIGHT);
            gradient.addColorStop(0, 'rgba(0,0,0,0)');
            gradient.addColorStop(0.3, 'rgba(0,0,0,0.7)');
            gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, overlayY, TARGET_WIDTH, overlayH);

            // 텍스트 렌더링
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.95)';
            ctx.shadowBlur = 12;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 3;

            // 시작 Y 위치 계산 (중앙 정렬)
            const startY = TARGET_HEIGHT - overlayH / 2 - (totalTextHeight / 2) + (fontSize / 2);

            lines.forEach((line, i) => {
                const y = startY + i * lineHeight;
                ctx.font = `bold ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
                ctx.fillStyle = '#ffffff';

                // 텍스트가 너무 길면 줄임표 처리
                let displayText = line;
                const maxWidth = TARGET_WIDTH - 80; // 좌우 여백
                let textWidth = ctx.measureText(displayText).width;

                if (textWidth > maxWidth) {
                    while (textWidth > maxWidth && displayText.length > 0) {
                        displayText = displayText.slice(0, -1);
                        textWidth = ctx.measureText(displayText + '...').width;
                    }
                    displayText += '...';
                }

                ctx.fillText(displayText, TARGET_WIDTH / 2, y);
            });

            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => {
            // 오류시 빈 캔버스라도 반환
            const canvas = document.createElement('canvas');
            canvas.width = TARGET_WIDTH;
            canvas.height = TARGET_HEIGHT;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('이미지 로드 실패', TARGET_WIDTH / 2, TARGET_HEIGHT / 2);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = imageUrl;
    });
};

export const DetailPlanner: React.FC = () => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
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
    const [includeSizeChart, setIncludeSizeChart] = useState(false);
    const [sizeGender, setSizeGender] = useState<'women' | 'men'>('women');
    const [sizeData, setSizeData] = useState<Record<string, Record<string, string>>>({});
    const [includeCertificate, setIncludeCertificate] = useState(false);
    const [certData, setCertData] = useState({ type: 'KC 안전인증', number: '', date: '' });
    const [includeReviews, setIncludeReviews] = useState(false);
    const [reviewsData, setReviewsData] = useState([
        { rating: 5, text: '품질이 정말 좋아요!', author: '김**' },
        { rating: 5, text: '가격 대비 만족스럽습니다', author: '이**' },
        { rating: 4, text: '재구매 의사 있어요', author: '박**' }
    ]);
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

            // 사이즈표 추가
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

            // 인증서 추가
            if (includeCertificate) {
                const certUrl = generateCertificateImage(
                    certData.type,
                    certData.number || 'CB-XXX-XXXXXX',
                    certData.date || new Date().toISOString().split('T')[0]
                );
                plannedSegments.push({
                    id: 'certificate-' + Date.now(),
                    title: '품질 인증',
                    logicalSections: ['신뢰', '인증서'],
                    keyMessage: '안전하고 검증된 제품',
                    visualPrompt: 'Certificate generated automatically.',
                    imageUrl: certUrl,
                    isGenerating: false
                });
            }

            // 고객 후기 추가
            if (includeReviews) {
                const reviewUrl = generateReviewImage(reviewsData);
                plannedSegments.push({
                    id: 'reviews-' + Date.now(),
                    title: '고객 후기',
                    logicalSections: ['신뢰', '리뷰'],
                    keyMessage: '실제 고객들의 생생한 후기',
                    visualPrompt: 'Customer reviews generated automatically.',
                    imageUrl: reviewUrl,
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

    const handleGenerateAll = async (regenerate = false) => {
        setStep(3);

        // 병렬 생성을 위한 인덱스 배열 생성
        const indicesToGenerate = segments
            .map((seg, idx) => ({ seg, idx }))
            .filter(({ seg }) => regenerate || !seg.imageUrl)
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
                    // ✅ 프롬프트에서 한글 텍스트 제거 — 배경/비주얼만 요청, 제품 로고 보존
                    const prompt = `High quality e-commerce product banner image. IMPORTANT RULES:
- NO TEXT, NO WORDS, NO LETTERS, NO CAPTIONS anywhere in the generated image
- If the reference product has logos or brand marks, preserve them exactly as they appear
- DO NOT add any new logos, watermarks, or brand marks
- Focus on visual composition only: ${segments[i].visualPrompt}
${info.imageInstruction ? `CRITICAL USER REQUIREMENT: ${info.imageInstruction}` : ''}
Clean background, professional product photography style, maintain original product details including any existing logos.`;

                    const rawImageUrl = await generateImage(prompt, referenceImages, "9:16");

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

                    // ✅ Canvas로 한글 텍스트 덧씌우기
                    const imageUrl = await overlayTextOnImage(rawImageUrl, segments[i].keyMessage);

                    // 개별 이미지 생성 완료 시 즉시 업데이트
                    setSegments(prev => {
                        const newSegs = [...prev];
                        newSegs[i] = { ...newSegs[i], imageUrl, isGenerating: false, error: false };
                        return newSegs;
                    });
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

            {step === 1 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">상품 정보 입력</h2>
                    </div>
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
                            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center cursor-pointer hover:bg-slate-50 transition-colors">
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
                            <label className="block text-sm font-medium text-slate-700 mb-2">상세페이지 길이 (구조)</label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { val: 'auto', label: 'Auto (AI 추천)', desc: '최적 길이 자동 판단' },
                                    { val: 5, label: '5장 (Short)', desc: '저관여/저가 집중형' },
                                    { val: 7, label: '7장 (Standard)', desc: '일반적인 구성' },
                                    { val: 9, label: '9장 (Long)', desc: '고관여/스토리텔링' }
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
                                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
                                        {reviewsData.map((review, idx) => (
                                            <div key={idx} className="bg-white p-4 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3">
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-medium text-slate-700 mb-1">별점</label>
                                                    <select value={review.rating} onChange={(e) => {
                                                        const newReviews = [...reviewsData];
                                                        newReviews[idx].rating = Number(e.target.value);
                                                        setReviewsData(newReviews);
                                                    }} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none">
                                                        <option value={5}>⭐⭐⭐⭐⭐</option>
                                                        <option value={4}>⭐⭐⭐⭐</option>
                                                        <option value={3}>⭐⭐⭐</option>
                                                    </select>
                                                </div>
                                                <div className="md:col-span-8">
                                                    <label className="block text-xs font-medium text-slate-700 mb-1">후기 내용</label>
                                                    <input type="text" value={review.text} onChange={(e) => {
                                                        const newReviews = [...reviewsData];
                                                        newReviews[idx].text = e.target.value;
                                                        setReviewsData(newReviews);
                                                    }} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                                                </div>
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-medium text-slate-700 mb-1">작성자</label>
                                                    <input type="text" value={review.author} onChange={(e) => {
                                                        const newReviews = [...reviewsData];
                                                        newReviews[idx].author = e.target.value;
                                                        setReviewsData(newReviews);
                                                    }} className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mt-8 flex justify-end">
                        <button onClick={handlePlan} disabled={loading || referenceImages.length < 2} className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors">
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
                            {segments.some(s => s.imageUrl) && (
                                <button onClick={() => handleGenerateAll(true)} className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 px-6 rounded-xl flex items-center transition-colors">
                                    <ImageIcon className="w-5 h-5 mr-2" />
                                    전체 재생성
                                </button>
                            )}
                        </div>
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
                                        <textarea value={seg.keyMessage} onChange={(e) => { const newSegs = [...segments]; newSegs[idx].keyMessage = e.target.value; setSegments(newSegs); }} rows={2} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none font-medium" />
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
                <div className="space-y-6">
                    <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800">상세페이지 결과물</h2>
                            <p className="text-slate-500 mt-1">생성된 이미지를 확인하고 다운로드하세요.</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setStep(2)} className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium py-3 px-6 rounded-xl flex items-center transition-colors">
                                <ChevronRight className="w-5 h-5 mr-2 rotate-180" />
                                이전 단계
                            </button>
                            <button onClick={handleDownloadAll} className="bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-8 rounded-xl flex items-center transition-colors">
                                <Download className="w-5 h-5 mr-2" />
                                전체 다운로드
                            </button>
                        </div>
                    </div>
                    <div className="flex justify-center">
                        <div className="w-full max-w-md bg-white shadow-2xl overflow-hidden">
                            {segments.map((seg, idx) => (
                                <div key={seg.id} className="relative w-full bg-slate-100 border-b border-slate-200 flex items-center justify-center">
                                    {seg.imageUrl ? (
                                        <img src={seg.imageUrl} alt={`Section ${idx + 1}`} className="w-full h-auto object-contain" />
                                    ) : seg.isGenerating ? (
                                        <div className="flex flex-col items-center text-slate-500 py-20">
                                            <Loader2 className="w-8 h-8 animate-spin mb-2 text-blue-500" />
                                            <p className="font-medium">이미지 생성 중...</p>
                                        </div>
                                    ) : (
                                        <div className="text-slate-400 py-20">대기 중...</div>
                                    )}
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
