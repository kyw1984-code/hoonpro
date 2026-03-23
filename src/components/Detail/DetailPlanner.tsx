import React, { useState, useRef } from 'react';
import { planDetail, generateImage, generateFeatures } from '../../api/aiService';
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

// ✅ 고객 후기 배경 이미지를 AI로 생성하는 함수
const generateReviewImageWithAI = async (
    reviews: Array<{ rating: number; text: string; author: string }>,
    productName: string,
    category: string,
    referenceImages: string[]
): Promise<string> => {
    try {
        // AI로 후기 배경 이미지 생성
        const prompt = `Create a soft, elegant background image for customer reviews section of an e-commerce product detail page.
Product: ${productName}
Category: ${category}

REQUIREMENTS:
- Subtle, professional background that doesn't distract from text
- Use soft pastel colors or gentle gradients
- Include minimal decorative elements (subtle patterns, soft shapes, or textures)
- Maintain the product's color scheme from reference images
- NO text, NO words, NO letters
- Clean, modern, premium feel
- Aspect ratio 9:16
- Leave plenty of clean space for text overlay

Style: Minimalist, elegant, e-commerce professional`;

        const bgImageUrl = await generateImage(prompt, referenceImages, "9:16");
        return bgImageUrl;
    } catch (error) {
        console.error("Review background generation failed:", error);
        // 실패 시 기본 배경 반환
        return '';
    }
};

// ✅ 고객 후기 이미지 생성 함수 (Canvas + AI 배경)
const generateReviewImage = (reviews: Array<{ rating: number; text: string; author: string }>, bgImageUrl?: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d')!;

    // 배경 이미지가 있으면 사용, 없으면 단순 흰색
    if (bgImageUrl) {
        const img = new window.Image();
        img.src = bgImageUrl;
        // 동기적으로 그리기 위해 즉시 반환하지 않음
        try {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // 반투명 오버레이로 가독성 향상
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        } catch (e) {
            // 이미지 로드 실패 시 기본 배경
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

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

        // 후기 텍스트 (한 글자씩 처리하여 한글도 잘 줄바꿈)
        ctx.font = '20px "Noto Sans KR", sans-serif';
        ctx.fillStyle = '#334155';
        const maxWidth = canvas.width - 160;
        const chars = review.text.split('');
        let line = '';
        let lineY = yOffset + 75;
        const lineHeight = 28;
        let lineCount = 0;
        const maxLines = 3;

        for (let i = 0; i < chars.length; i++) {
            const testLine = line + chars[i];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line.length > 0) {
                ctx.fillText(line, 80, lineY);
                line = chars[i];
                lineY += lineHeight;
                lineCount++;
                if (lineCount >= maxLines) {
                    // 마지막 줄에 ... 추가
                    const remaining = chars.slice(i).join('');
                    if (remaining.length > 0) {
                        line = line.slice(0, -3) + '...';
                    }
                    break;
                }
            } else {
                line = testLine;
            }
        }
        if (lineCount < maxLines) {
            ctx.fillText(line, 80, lineY);
        }

        // 작성자
        ctx.font = 'bold 20px "Noto Sans KR", sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText(`- ${review.author}`, canvas.width - 80, yOffset + 170);

        yOffset += 240;
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
}): string => {
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

    // 제목
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 40px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('제품 정보 및 관리방법', canvas.width / 2, 80);

    // 구분선
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 120);
    ctx.lineTo(canvas.width - 100, 120);
    ctx.stroke();

    let yPos = 180;
    const lineHeight = 45;
    const sectionGap = 60;

    // 정보 항목 그리기 함수
    const drawInfoItem = (label: string, value: string, y: number) => {
        if (!value.trim()) return y;

        // 레이블
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 26px "Noto Sans KR", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${label}:`, 100, y);

        // 값 (여러 줄 처리)
        ctx.fillStyle = '#1e293b';
        ctx.font = '24px "Noto Sans KR", sans-serif';
        const maxWidth = canvas.width - 250;
        const lines = value.split('\n');
        let currentY = y;

        lines.forEach((line, idx) => {
            // 긴 텍스트 줄바꿈 처리
            const words = line.split('');
            let currentLine = '';
            let lineY = idx === 0 ? currentY : currentY + lineHeight;

            for (let i = 0; i < words.length; i++) {
                const testLine = currentLine + words[i];
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && currentLine.length > 0) {
                    ctx.fillText(currentLine, 250, lineY);
                    currentLine = words[i];
                    lineY += lineHeight;
                } else {
                    currentLine = testLine;
                }
            }
            ctx.fillText(currentLine, 250, lineY);
            currentY = lineY;
        });

        return currentY + sectionGap;
    };

    yPos = drawInfoItem('소재', data.material, yPos);
    yPos = drawInfoItem('원산지', data.origin, yPos);
    yPos = drawInfoItem('제조사', data.manufacturer, yPos);
    yPos = drawInfoItem('세탁방법', data.washingMethod, yPos);
    yPos = drawInfoItem('주의사항', data.precautions, yPos);

    return canvas.toDataURL('image/png');
};

const generateSizeChartImage = (gender: 'women' | 'men', data: Record<string, Record<string, string>>): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1422;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sizes = gender === 'women' ? ['55', '66', '77', '88'] : ['95', '100', '105', '110'];
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

const overlayTextOnImage = (imageUrl: string, keyMessage: string, position: 'top' | 'middle' | 'bottom'): Promise<string> => {
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

            // 줄 수에 따라 폰트 크기 조정
            let fontSize = position === 'top'
                ? (lines.length === 1 ? 32 : lines.length === 2 ? 28 : 24)
                : (lines.length === 1 ? 48 : lines.length === 2 ? 42 : 36);
            const lineHeight = fontSize * 1.5;
            const totalTextHeight = lines.length * lineHeight;

            // 그라디언트 설정
            if (position === 'top') {
                const overlayH = totalTextHeight + fontSize * 2;
                const gradient = ctx.createLinearGradient(0, 0, 0, overlayH);
                gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
                gradient.addColorStop(0.7, 'rgba(0,0,0,0.4)');
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, TARGET_WIDTH, overlayH);
            } else if (position === 'middle') {
                const overlayH = totalTextHeight + fontSize * 4;
                const overlayY = (TARGET_HEIGHT - overlayH) / 2;
                const gradient = ctx.createLinearGradient(0, overlayY, 0, overlayY + overlayH);
                gradient.addColorStop(0, 'rgba(0,0,0,0)');
                gradient.addColorStop(0.5, 'rgba(0,0,0,0.6)');
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, overlayY, TARGET_WIDTH, overlayH);
            } else {
                const overlayH = totalTextHeight + fontSize * 3;
                const overlayY = TARGET_HEIGHT - overlayH;
                const gradient = ctx.createLinearGradient(0, overlayY, 0, TARGET_HEIGHT);
                gradient.addColorStop(0, 'rgba(0,0,0,0)');
                gradient.addColorStop(0.3, 'rgba(0,0,0,0.7)');
                gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, overlayY, TARGET_WIDTH, overlayH);
            }

            // 텍스트 렌더링 세팅
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.95)';
            ctx.shadowBlur = position === 'top' ? 10 : 12;
            ctx.shadowOffsetX = position === 'top' ? 1 : 2;
            ctx.shadowOffsetY = position === 'top' ? 2 : 3;

            let startY = 0;
            if (position === 'top') startY = fontSize + 20;
            else if (position === 'middle') startY = (TARGET_HEIGHT / 2) - (totalTextHeight / 2) + (lineHeight / 2);
            else startY = TARGET_HEIGHT - (totalTextHeight + fontSize) + (lineHeight / 2);

            lines.forEach((line, i) => {
                const y = startY + i * lineHeight;
                ctx.font = `bold ${fontSize}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
                ctx.fillStyle = '#ffffff';

                let displayText = line;
                const maxWidth = TARGET_WIDTH - 80;
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
            // 핵심 특징이 비어있으면 자동 생성
            let features = info.features;
            if (!features.trim()) {
                features = await generateFeatures(info.name, info.category);
                setInfo(prev => ({ ...prev, features }));
            }

            const plannedSegments = await planDetail({ ...info, features, length });
            
            // 각 세그먼트에 텍스트 위치 기본값 설정
            const mappedSegments = plannedSegments.map((seg: any) => {
                const isStyleSection = seg.title.includes('스타일') || 
                                     seg.title.includes('코디') || 
                                     seg.title.includes('연출');
                return {
                    ...seg,
                    textPosition: isStyleSection ? 'top' : 'bottom',
                    rawImageUrl: ''
                };
            });

            // 사이즈표 추가
            if (includeSizeChart) {
                const sizeChartUrl = generateSizeChartImage(sizeGender, sizeData);
                mappedSegments.push({
                    id: 'size-chart-' + Date.now(),
                    title: '사이즈 가이드',
                    logicalSections: ['정보 제공', '사이즈표'],
                    keyMessage: '상세 사이즈를 확인하세요.',
                    visualPrompt: 'Size chart generated automatically.',
                    imageUrl: sizeChartUrl,
                    rawImageUrl: sizeChartUrl,
                    textPosition: 'bottom',
                    isGenerating: false
                });
            }

            // 제품 정보 및 관리방법 추가
            if (includeProductInfo) {
                const productInfoUrl = generateProductInfoImage(productInfoData);
                mappedSegments.push({
                    id: 'product-info-' + Date.now(),
                    title: '제품 정보 및 관리방법',
                    logicalSections: ['정보 제공', '관리'],
                    keyMessage: '제품 정보를 확인하세요',
                    visualPrompt: 'Product information generated automatically.',
                    imageUrl: productInfoUrl,
                    rawImageUrl: productInfoUrl,
                    textPosition: 'bottom',
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
                mappedSegments.push({
                    id: 'certificate-' + Date.now(),
                    title: '품질 인증',
                    logicalSections: ['신뢰', '인증서'],
                    keyMessage: '안전하고 검증된 제품',
                    visualPrompt: 'Certificate generated automatically.',
                    imageUrl: certUrl,
                    rawImageUrl: certUrl,
                    textPosition: 'bottom',
                    isGenerating: false
                });
            }

            // 고객 후기 추가 (AI 배경 생성)
            if (includeReviews) {
                // AI로 배경 이미지 생성
                const reviewBgUrl = await generateReviewImageWithAI(reviewsData, info.name, info.category, referenceImages);

                // 배경과 후기를 합성
                const reviewUrl = await new Promise<string>((resolve) => {
                    if (reviewBgUrl) {
                        const img = new window.Image();
                        img.onload = () => {
                            const finalUrl = generateReviewImage(reviewsData, reviewBgUrl);
                            resolve(finalUrl);
                        };
                        img.onerror = () => {
                            // 배경 로드 실패 시 기본 배경 사용
                            const finalUrl = generateReviewImage(reviewsData);
                            resolve(finalUrl);
                        };
                        img.src = reviewBgUrl;
                    } else {
                        const finalUrl = generateReviewImage(reviewsData);
                        resolve(finalUrl);
                    }
                });

                mappedSegments.push({
                    id: 'reviews-' + Date.now(),
                    title: '고객 후기',
                    logicalSections: ['신뢰', '리뷰'],
                    keyMessage: '실제 고객들의 생생한 후기',
                    visualPrompt: 'Customer reviews generated automatically.',
                    imageUrl: reviewUrl,
                    rawImageUrl: reviewUrl,
                    textPosition: 'bottom',
                    isGenerating: false
                });
            }

            setSegments(mappedSegments);
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
                    // ✅ 프롬프트에서 한글 텍스트 제거 — 배경/비주얼만 요청, 제품 로고 및 색상 보존
                    const colorInstruction = info.imageInstruction
                        ? `ADDITIONAL COLOR REQUEST: ${info.imageInstruction}`
                        : 'CRITICAL: Use ONLY the exact colors shown in the reference images. DO NOT change or add any new colors. Maintain the original product colors precisely.';

                    const prompt = `High quality e-commerce product banner image. STRICT REQUIREMENTS:
- NO TEXT, NO WORDS, NO LETTERS, NO CAPTIONS anywhere in the generated image
- Preserve the EXACT colors from ALL reference product images - do not alter or add colors unless specifically requested
- CRITICAL: Multiple reference images are provided showing different angles (front, back, side). Each image may have logos, brand marks, or design elements. You MUST preserve ALL logos and brand marks from ALL reference images exactly as they appear in their respective angles.
- If generating a back view and the reference back image has a logo, include that logo exactly
- If generating a front view and the reference front image has a logo, include that logo exactly
- DO NOT add any new logos, watermarks, or brand marks that are not in the reference images
- Focus on visual composition only: ${segments[i].visualPrompt}
${colorInstruction}
Clean background, professional product photography style, maintain ALL original product details including logos and colors from ALL reference images.`;

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

                    // ✅ Canvas로 한글 텍스트 덧씌우기 (위치 정보 포함)
                    const imageUrl = await overlayTextOnImage(rawImageUrl, segments[i].keyMessage, segments[i].textPosition || 'bottom');

                    setSegments(prev => {
                        const newSegs = [...prev];
                        newSegs[i] = { ...newSegs[i], imageUrl, rawImageUrl, isGenerating: false, error: false };
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
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                핵심 특징 <span className="text-slate-400 font-normal">(비워두면 상품명 기반 자동 생성)</span>
                            </label>
                            <textarea value={info.features} onChange={e => setInfo({...info, features: e.target.value})} rows={3} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="상품의 주요 장점을 입력하세요. (빈칸으로 두면 자동 생성됩니다)" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">타겟 고객</label>
                            <input type="text" value={info.target} onChange={e => setInfo({...info, target: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" placeholder="예: 20-30대 직장인 여성" />
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
                                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
                                        {reviewsData.map((review, idx) => (
                                            <div key={idx} className="bg-white p-4 rounded-lg border border-slate-200">
                                                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-2">
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
                                                {reviewsData.length > 1 && (
                                                    <button
                                                        onClick={() => {
                                                            const newReviews = reviewsData.filter((_, i) => i !== idx);
                                                            setReviewsData(newReviews);
                                                        }}
                                                        className="text-red-600 hover:text-red-700 text-xs font-medium flex items-center gap-1"
                                                    >
                                                        <X className="w-3 h-3" />
                                                        이 후기 삭제
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => {
                                                setReviewsData([...reviewsData, { rating: 5, text: '', author: '고객**' }]);
                                            }}
                                            className="w-full p-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-500 hover:text-blue-600 font-medium transition-colors flex items-center justify-center gap-2"
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
                            <p className="text-slate-500 mt-1">생성된 이미지를 확인하고 다운로드하세요. 문구를 수정하면 해당 이미지만 재생성됩니다.</p>
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
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* 왼쪽: 이미지 미리보기 */}
                        <div className="flex justify-center">
                            <div className="w-full max-w-md bg-white shadow-2xl overflow-hidden sticky top-6">
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

                        {/* 오른쪽: 문구 수정 패널 */}
                        <div className="space-y-4">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <h3 className="text-lg font-bold text-slate-800 mb-4">문구 수정 및 재생성</h3>
                                {segments.map((seg, idx) => (
                                    <div key={seg.id} className="mb-6 pb-6 border-b border-slate-200 last:border-0 last:mb-0 last:pb-0">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-600">#{idx + 1}</span>
                                                <span className="text-sm font-medium text-slate-800">{seg.title}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">카피 문구</label>
                                                <textarea
                                                    value={seg.keyMessage}
                                                    onChange={(e) => {
                                                        const newSegs = [...segments];
                                                        newSegs[idx].keyMessage = e.target.value;
                                                        setSegments(newSegs);
                                                    }}
                                                    rows={2}
                                                    className="w-full p-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-600 mb-1">문구 위치</label>
                                                <div className="grid grid-cols-3 gap-1">
                                                    {(['top', 'middle', 'bottom'] as const).map((pos) => (
                                                        <button
                                                            key={pos}
                                                            onClick={async () => {
                                                                const newSegs = [...segments];
                                                                newSegs[idx].textPosition = pos;
                                                                if (newSegs[idx].rawImageUrl) {
                                                                    newSegs[idx].imageUrl = await overlayTextOnImage(newSegs[idx].rawImageUrl, newSegs[idx].keyMessage, pos);
                                                                }
                                                                setSegments(newSegs);
                                                            }}
                                                            className={`py-1 px-2 rounded-md border text-[10px] font-bold transition-all ${seg.textPosition === pos ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-blue-300'}`}
                                                        >
                                                            {pos === 'top' ? '상단' : pos === 'middle' ? '중간' : '하단'}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 mt-3">
                                            <button
                                                onClick={async () => {
                                                    if (!seg.rawImageUrl) return;
                                                    setSegments(prev => {
                                                        const newSegs = [...prev];
                                                        newSegs[idx] = { ...newSegs[idx], isGenerating: true };
                                                        return newSegs;
                                                    });
                                                    const imageUrl = await overlayTextOnImage(seg.rawImageUrl, seg.keyMessage, seg.textPosition || 'bottom');
                                                    setSegments(prev => {
                                                        const newSegs = [...prev];
                                                        newSegs[idx] = { ...newSegs[idx], imageUrl, isGenerating: false };
                                                        return newSegs;
                                                    });
                                                }}
                                                disabled={!seg.rawImageUrl || seg.isGenerating}
                                                className="bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 text-slate-700 text-[10px] font-bold py-2 px-3 rounded-lg flex items-center justify-center transition-colors"
                                            >
                                                문구만 적용
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    // 해당 이미지 AI 재생성
                                                    setSegments(prev => {
                                                        const newSegs = [...prev];
                                                        newSegs[idx] = { ...newSegs[idx], isGenerating: true, error: false };
                                                        return newSegs;
                                                    });

                                                    try {
                                                        const colorInstruction = info.imageInstruction
                                                            ? `ADDITIONAL COLOR REQUEST: ${info.imageInstruction}`
                                                            : 'CRITICAL: Use ONLY the exact colors shown in the reference images. DO NOT change or add any new colors. Maintain the original product colors precisely.';

                                                        const prompt = `High quality e-commerce product banner image. STRICT REQUIREMENTS:
- NO TEXT, NO WORDS, NO LETTERS, NO CAPTIONS anywhere in the generated image
- Preserve the EXACT colors from ALL reference product images - do not alter or add colors unless specifically requested
- CRITICAL: Multiple reference images are provided showing different angles (front, back, side). Each image may have logos, brand marks, or design elements. You MUST preserve ALL logos and brand marks from ALL reference images exactly as they appear in their respective angles.
- If generating a back view and the reference back image has a logo, include that logo exactly
- If generating a front view and the reference front image has a logo, include that logo exactly
- DO NOT add any new logos, watermarks, or brand marks that are not in the reference images
- Focus on visual composition only: ${segments[idx].visualPrompt}
${colorInstruction}
Clean background, professional product photography style, maintain ALL original product details including logos and colors from ALL reference images.`;

                                                        const rawImageUrl = await generateImage(prompt, referenceImages, "9:16");
                                                        const validation = await validateImageQuality(rawImageUrl);

                                                        if (!validation.isValid) {
                                                            throw new Error(`품질 검증 실패: ${validation.reason}`);
                                                        }

                                                        const imageUrl = await overlayTextOnImage(rawImageUrl, segments[idx].keyMessage, segments[idx].textPosition || 'bottom');

                                                        setSegments(prev => {
                                                            const newSegs = [...prev];
                                                            newSegs[idx] = { ...newSegs[idx], imageUrl, rawImageUrl, isGenerating: false, error: false };
                                                            return newSegs;
                                                        });
                                                    } catch (e) {
                                                        console.error(`이미지 ${idx + 1} 재생성 실패:`, e);
                                                        alert(`이미지 재생성에 실패했습니다: ${e}`);
                                                        setSegments(prev => {
                                                            const newSegs = [...prev];
                                                            newSegs[idx] = { ...newSegs[idx], isGenerating: false, error: true };
                                                            return newSegs;
                                                        });
                                                    }
                                                }}
                                                disabled={seg.isGenerating}
                                                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-[10px] font-bold py-2 px-3 rounded-lg flex items-center justify-center transition-colors"
                                            >
                                                AI 전체 재생성
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
