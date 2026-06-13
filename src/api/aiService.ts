import { GoogleGenAI } from "@google/genai";
import { getToken, trackUsage, logApiCall } from "../lib/auth";

const getApiKey = () => {
  return (
    import.meta.env.VITE_GOOGLE_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    ""
  );
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export const removeBackground = async (image: string) => image;

const DETAIL_CANVAS_WIDTH = 860;
const DETAIL_HEIGHT_PRESETS = [1000, 1200, 1529, 1720] as const;

const normalizeLayoutHeight = (value: any, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return DETAIL_HEIGHT_PRESETS.reduce((best, current) => (
    Math.abs(current - n) < Math.abs(best - n) ? current : best
  ), DETAIL_HEIGHT_PRESETS[0]);
};

const getFallbackLayoutHeight = (item: any, index: number, total: number): number => {
  const text = `${item?.title || ''} ${item?.conversionRole || ''} ${item?.sectionType || ''}`.toLowerCase();
  if (index === 0) return 1529;
  if (index === total - 1) return 1200;
  if (text.includes('lifestyle') || text.includes('활용')) return 1529;
  if (text.includes('detail') || text.includes('디테일') || text.includes('proof') || text.includes('근거')) return 1000;
  if (text.includes('problem') || text.includes('문제')) return 1200;
  return 1200;
};

export const planDetail = async (data: any) => {
  try {
    await trackUsage();
    const lengthGuide = data.length === 'auto'
      ? '상품 특성에 맞게 5~9장 사이로 최적 구성'
      : `정확히 ${data.length}장으로 구성`;
    const combinationType = data.combinationType && data.combinationType !== 'single'
      ? String(data.combinationType)
      : '';
    const combinationCount = Number(data.combinationCount) || (combinationType === '1+1+1' ? 3 : combinationType === '1+1' ? 2 : 1);
    const combinationGuide = combinationType
      ? `
 조합상품 전용 작성 규칙:
 - 이 상품은 ${combinationType} 조합상품이며 총 ${combinationCount}개 구성입니다.
 - 첫 번째 항목은 반드시 "${combinationType} 조합 인트로" 섹션으로 작성하세요.
 - 첫 번째 keyMessage의 첫 줄에는 반드시 "${combinationType} 구성"을 포함하세요.
 - 첫 번째 visualPrompt는 정확히 ${combinationCount}개의 모델컷 또는 모델 착용/사용 장면이 한 세로형 페이지에 함께 보이는 구성을 영어로 작성하세요.
 - 이후 섹션도 단품이 아니라 묶음 구성의 실용성, 여유분, 함께 쓰는 장점, 선물/비축 가치 등을 자연스럽게 반영하세요.
 - 실제 가격, 할인율, 최저가 같은 검증되지 않은 수치 표현은 만들지 마세요.
`
      : ' 상품 구성: 일반 단품 상세페이지로 작성하세요.';
    const designPreset = data.designPreset && typeof data.designPreset === 'object'
      ? data.designPreset
      : null;
    const designGuide = designPreset
      ? `
 디자인 프리셋:
 - 스타일명: ${designPreset.label}
 - 카피 톤: ${designPreset.copyTone}
 - 이미지 스타일: ${designPreset.imageStyle}
 - 배경 방향: ${designPreset.backgroundGuide}
 - 모든 섹션의 keyMessage와 visualPrompt는 위 스타일을 일관되게 반영하세요.
`
      : '';
    const conversionEnabled = data.conversionEnabled !== false;
    const conversionMode = data.effectiveConversionMode || data.conversionMode || 'auto';
    const conversionLabelMap: Record<string, string> = {
      auto: '자동 추천',
      premiumTrust: '프리미엄 신뢰형',
      bundleValue: '조합상품 혜택형',
      problemSolution: '문제 해결형',
      dealFocus: '세일/혜택형',
    };
    const conversionGuide = conversionEnabled
      ? `
 전환율 강화 모드:
 - 적용 모드: ${conversionLabelMap[conversionMode] || '자동 추천'}
 - 전체 흐름은 반드시 첫인상 → 문제 해결 → 근거/후기 → 제품 디테일 → 구매 안심 정보 순서로 설계하세요.
 - 첫 번째 섹션 conversionRole은 반드시 "핵심 오퍼" 또는 조합상품이면 "조합 핵심 오퍼"로 작성하세요.
 - 두 번째 섹션 conversionRole은 반드시 "고객 문제/상황"으로 작성하세요.
 - 세 번째 섹션 conversionRole은 반드시 "구매 근거"로 작성하세요.
 - 각 항목에 sectionType과 conversionRole을 반드시 포함하세요.
 - sectionType은 offer, problem, proof, detail, lifestyle, trust 중 하나를 사용하세요.
 - 실제 후기 수, 판매량, 할인율, 최저가, 인증 여부처럼 검증되지 않은 수치나 사실은 만들지 마세요.
 - 고객 후기는 사용자가 별도 템플릿으로 입력할 수 있으므로 실제 후기처럼 보이는 허위 리뷰 문장은 생성하지 마세요.
`
      : '';

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
      },
      contents: `
 당신은 한국 이커머스 전문 상세페이지 기획자입니다.
 아래 상품의 상세페이지 기획안을 JSON 배열로 작성해주세요.

 상품명: ${data.name}
 카테고리: ${data.category}
 타겟 고객: ${data.target || '없음'}
 페이지 길이: ${lengthGuide}
 상품 구성: ${combinationType ? `${combinationType} 조합상품 (${combinationCount}개 구성)` : '일반 상품'}
${combinationGuide}
${designGuide}
${conversionGuide}

 반드시 아래 형식의 JSON 배열만 반환하세요. 배열 [ ] 로 시작하고 다른 텍스트는 포함하지 마세요.
 각 항목은 반드시 title, logicalSections, keyMessage, visualPrompt, sectionType, conversionRole, layoutHeight 필드를 포함해야 합니다.

 상세페이지 캔버스 규칙:
 - 모든 이미지는 가로 ${DETAIL_CANVAS_WIDTH}px 고정 상세페이지 섹션으로 기획합니다.
 - 각 항목의 layoutHeight는 반드시 ${DETAIL_HEIGHT_PRESETS.join(', ')} 중 하나만 사용하세요.
 - Hook/모델 착용/감성 히어로/라이프스타일 섹션은 1529를 우선 사용하세요.
 - 제품 디테일/근거/짧은 정보 섹션은 1000, 일반 설명 섹션은 1200을 사용하세요.
 - 긴 스토리/비교/사용 장면은 필요할 때만 1720을 사용하세요.
 - 모든 섹션이 같은 높이가 되지 않게, 설득 역할에 맞춰 높이를 다르게 배분하세요.

 중요 규칙 및 절대 금지 사항 (MUST FOLLOW):
 1. 반드시 제품의 시각적 가치(디테일, 소재, 착용샷, 연출샷 등)를 보여주는 '이미지 중심'의 섹션으로만 구성하세요.
 2. **다음 섹션들은 시스템에서 별도로 추가하므로 AI는 절대 생성하면 안 됩니다 (생성 시 오류 처리됨):**
    - '사이즈 가이드', '사이즈 조언', '실측 사이즈' 등 모든 사이즈 관련 섹션
    - '세탁 방법', '관리 방법', '보관 방법', '주의사항' 등 모든 관리 정보 섹션
    - '제품 상세 정보', '상품 기본 정보', '고객 센터' 관련 섹션
 3. 위 금지 항목 대신 다음 내용을 포함하세요:
    - 제품의 핵심 문제를 해결하는 첫인상 메인 섹션
    - 소재의 질감과 마감을 강조하는 클로즈업 섹션 (Extreme close-up)
    - 일상 생활에서의 자연스러운 사용/착용 연출 섹션 (Lifestyle shot)
    - 제품의 신뢰도를 높이는 브랜드 철학이나 품질 강조 섹션
 4. 검증되지 않은 할인율, 판매량, 리뷰 수, 평점, 인증 문구는 절대 만들지 마세요.

 keyMessage 작성 규칙:
 - 고객의 감성을 자극하는 전문 카피라이터 톤앤매너 유지
 - GPT 이미지 생성 결과처럼 짧고 자연스러운 한국어 에디토리얼 카피로 작성
 - 억지 존댓말, 번역투, 과장 광고 문구를 피하고 상황에 맞게 담백한 평서형/서술형을 사용
 - 상품명과 카테고리만 보고 확정할 수 없는 기능, 소재, 수치, 효능은 만들지 말 것
 - "최고의 선택", "지금 바로 경험하세요", "더 이상 고민하지 마세요", "완벽함", "비밀" 같은 상투어는 사용하지 말 것
 - 1~2줄로 작성하되, 한 줄당 18자 이내로 제한 (줄바꿈 \n 사용)
 - 예시: "입는 순간,\n분위기가 달라진다"

 시각적 프롬프트(visualPrompt) 작성 규칙:
 - 영어로 작성하며, AI 이미지 생성기가 이해하기 쉬운 구체적인 묘사 포함
 - "A premium vertical Korean e-commerce editorial image of..."로 시작
 - 섹션 목적에 맞게 모델 착용컷, 자연스러운 사용 장면, 제품 디테일 클로즈업, 정갈한 제품 단독컷을 섞어서 작성
 - 모든 섹션을 같은 반신 모델컷이나 같은 배경으로 만들지 말고 카메라 거리, 포즈, 배경, 연출 소품을 섹션마다 다르게 작성
 - 첫 섹션은 GPT 예시처럼 여백이 있는 세로형 메인 비주얼, 이후 섹션은 클로즈업/라이프스타일/디테일/마무리 컷으로 다양화
 - 이미지 안에 글자, 배지, 카드, 말풍선, UI 패널, 가격표를 만들라고 지시하지 말 것
 - 조명, 배경, 각도, 질감, 모델 포즈를 사실적으로 기술
 - 모델 얼굴은 새롭게 생성된 가상의 인물로 표현하고 레퍼런스 인물의 얼굴을 복제하지 말 것
 - 클로즈업 섹션은 제품을 착용/사용한 상태의 자연스러운 부분 확대 컷으로 작성하고, 큰 제품 배경 위에 작은 전신 모델을 붙이는 합성 구도는 절대 지시하지 말 것
 - 미니어처 모델, 스티커처럼 붙인 모델, picture-in-picture, 손에 들린 작은 사람, 거대한 제품 무늬 배경 뒤의 작은 모델 같은 부자연스러운 합성 표현은 visualPrompt에 포함하지 말 것
 - 제품 로고/패턴/프린트는 실제 제품 위에서 현실적인 크기로 보이게 작성하고, 별도 배경 그래픽처럼 확대하지 말 것

 배열 예시: [ {"title": "분위기를 바꾸는 첫인상", "logicalSections": ["메인", "시각화"], "sectionType": "offer", "conversionRole": "핵심 오퍼", "layoutHeight": 1529, "keyMessage": "입는 순간,\n분위기가 달라진다", "visualPrompt": "A premium vertical Korean e-commerce editorial image of a fictional Korean model wearing the product in a calm studio room, full-body composition with generous clean negative space on the left for Korean headline overlay, soft daylight, realistic fabric texture, refined lifestyle mood, no text."} ]
      `.trim(),
    });
    await logApiCall('detail-plan', 'gemini-2.5-flash', response);

    const text = response.text ?? "";
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    let arr: any[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object") {
      const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
      arr = firstArray ? (firstArray as any[]) : [parsed];
    }

    const fallbackRoles = combinationType
      ? ['조합 핵심 오퍼', '고객 문제/상황', '구매 근거', '제품 디테일', '활용 장면', '구매 안심']
      : ['핵심 오퍼', '고객 문제/상황', '구매 근거', '제품 디테일', '활용 장면', '구매 안심'];
    const fallbackTypes = ['offer', 'problem', 'proof', 'detail', 'lifestyle', 'trust'];
    const fallbackMessages = combinationType
      ? [
          `${combinationType} 구성\n한 번에 준비하세요`,
          '더 이상 고민하지 마세요\n편하게 선택하세요',
          '구성의 차이를\n눈으로 확인하세요',
          '디테일까지 꼼꼼하게\n살펴보세요',
          '일상 속에서 더 자연스럽게\n활용해보세요',
          '구매 전 마지막까지\n안심하고 확인하세요',
        ]
      : [
          `${data.name || '상품'}\n첫인상이 달라진다`,
          '매일 손이 가는\n편안한 분위기',
          '가까이 볼수록\n선명한 디테일',
          '결이 살아나는\n섬세한 마감',
          '일상에 자연스럽게\n스며드는 스타일',
          '마지막까지\n차분하게 확인하세요',
        ];
    const normalizeKeyMessage = (value: any, index: number) => {
      const fallback = fallbackMessages[Math.min(index, fallbackMessages.length - 1)];
      const message = String(value || '').trim() || fallback;
      return message.split('\n').map(line => line.slice(0, 18)).join('\n').slice(0, 80);
    };

    const totalItems = arr.length;
    return arr.map((item: any, index: number) => ({
      ...item,
      id: Math.random().toString(36).substring(7),
      title: item.title ?? "섹션",
      logicalSections: Array.isArray(item.logicalSections) ? item.logicalSections : ["기본"],
      sectionType: item.sectionType || fallbackTypes[Math.min(index, fallbackTypes.length - 1)],
      conversionRole: item.conversionRole || fallbackRoles[Math.min(index, fallbackRoles.length - 1)],
      layoutHeight: normalizeLayoutHeight(item.layoutHeight, getFallbackLayoutHeight(item, index, totalItems)),
      // keyMessage 검증 - 각 줄이 25자를 초과하지 않도록 체크
      keyMessage: normalizeKeyMessage(item.keyMessage ?? item.copy ?? item.message, index),
      visualPrompt: item.visualPrompt ?? "",
    }));
  } catch (error) {
    console.error("Plan Error:", error);
    return [];
  }
};

export const generateImage = async (
  prompt: string,
  base64Images: string[] = [],
  aspectRatio: string = "9:16"
) => {
  try {
    await trackUsage();
    const res = await fetch('/api/usage/log-call?mode=generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ prompt, base64Images, aspectRatio }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '이미지 생성에 실패했습니다.');
    return data.imageUrl as string | undefined;
  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
};
