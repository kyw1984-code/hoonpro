import { GoogleGenAI } from "@google/genai";
import { trackUsage, logApiCall, getToken } from "../lib/auth";

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

// 상품명 기반 핵심 특징 자동 생성
export const generateFeatures = async (productName: string, category: string): Promise<string> => {
  try {
    await trackUsage();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
상품명: ${productName}
카테고리: ${category}

위 상품의 핵심 특징 3-5가지를 간결하게 작성해주세요.
각 특징은 한 줄로, 구체적이고 설득력 있게 작성하세요.
반드시 텍스트만 반환하고, 불릿 포인트나 번호 없이 쉼표로 구분하세요.

예시: "프리미엄 메모리폼 소재로 목과 어깨 압력 분산, 통기성 좋은 3D 메쉬 커버, 세탁 가능한 분리형 커버, 인체공학적 디자인"
      `.trim(),
    });
    await logApiCall('features-recommend', 'gemini-2.5-flash', response);

    const text = response.text ?? "";
    return text.trim();
  } catch (error) {
    console.error("Feature generation error:", error);
    return ""; // 실패시 빈 문자열 반환
  }
};

export const planDetail = async (data: any) => {
  try {
    await trackUsage();
    const targetCount = data.length === 'auto' ? '12~15장' : `${data.length}장`;
    const lengthGuide = data.length === 'auto'
      ? 'V2.1 심리 흐름 기준 12~15장으로 최적 구성'
      : `정확히 ${data.length}장으로 구성`;
    const structureGuide = `
 [STEP 3] 이미지 순서 템플릿 (반드시 이 순서를 따르세요, 총 ${targetCount}):
 - 1번 (Hook): 3초 안에 시선을 잡는 메인 이미지. 핵심 USP를 강하게 보여주는 첫인상. sectionType=offer, conversionRole=핵심 오퍼
 - 2번 (문제 공감): 고객이 실제로 겪는 불편/상황에 공감. sectionType=problem, conversionRole=고객 문제/상황
 - 3번 (문제 확대): 그 문제를 방치하면 생기는 손실을 자극(손실회피). sectionType=problem, conversionRole=문제 심화
   (전체 장수가 적으면 2번과 3번을 한 장으로 합쳐도 됩니다)
 - 4번 (해결책 제시): 왜 이 제품이, 왜 지금 필요한가. sectionType=offer, conversionRole=해결책
 - 중간 (핵심 셀링포인트, 여러 장): 제품 강점을 서로 다른 관점으로. 각 장의 표현 방식은 절대 중복 금지하고 매 장 다른 각도를 사용:
   · 기능 중심 / 감성 중심 / 비교 우위 중심 / 수치·근거 중심 / 사용 장면 중심 중에서 매 장 다른 각도
   · sectionType은 detail/proof/lifestyle 중 내용에 맞게, conversionRole은 구매 근거/제품 디테일/활용 장면 등
 - 끝에서 두 번째 (신뢰 강화): 원재료·제조공정·품질관리·브랜드 철학 등으로 신뢰를 높임. sectionType=trust, conversionRole=구매 안심
 - 마지막 (CTA): 지금 구매해야 하는 이유와 행동 유도(타이밍 강조). sectionType=trust, conversionRole=구매 확신
 - 전체 장수에 맞게 위 단계를 자연스럽게 배분하되, 반드시 Hook으로 시작해 CTA로 끝나야 합니다.
`;
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
 당신은 대한민국 상위 1% 이커머스 광고 디자이너이자 퍼포먼스 마케터, CRO(전환율 최적화) 전문가, 브랜드 전략가입니다.
 목표는 단순한 상세페이지 제작이 아니라, 방문자를 구매자로 전환시키는 '판매용 상세페이지' 기획안을 만드는 것입니다.
 아래 상품의 상세페이지 기획안을 JSON 배열로 작성해주세요. 정보가 부족하면 카테고리 특성과 시장 관행을 참고하여 합리적으로 보완하세요.

 상품명: ${data.name}
 카테고리: ${data.category || '미입력 (상품명/설명/이미지로 합리적으로 추정)'}
 상품 설명: ${data.description || '없음'}
 핵심 특징: ${data.features || '없음'}
 타겟 고객: ${data.target || '없음'}
 페이지 길이: ${lengthGuide}
 상품 구성: ${combinationType ? `${combinationType} 조합상품 (${combinationCount}개 구성)` : '일반 상품'}
${combinationGuide}
${designGuide}
${conversionGuide}

 [STEP 1] 내부 분석 (출력에는 직접 쓰지 말고 기획에 반영):
 - 제품 정의: 어떤 제품인가 / 어떤 문제를 해결하는가
 - 고객 분석: 핵심 타겟과 '표면 니즈'와 '실제 숨은 니즈'를 구분 (예: 운동기구 → 운동하고 싶음 → 살 빼고 싶음 → 자기관리 잘하는 사람처럼 보이고 싶음)
 - 경쟁 대비 차별점 최소 3개
 - 구매 저항 요소 최소 5개 (효과 있을까, 오래 쓸까, 사용이 어려울까, 내게 맞을까, 배송 문제 없을까 등)를 도출하고 각 섹션이 이 불안을 해소하도록 설계

 [STEP 2] 전환 심리 흐름 설계:
 - 전체 흐름은 반드시 '인지 → 공감 → 문제 인식 → 해결책 발견 → 신뢰 형성 → 구매 확신 → 결제' 순서를 따르도록 섹션을 배치하세요.
 - 각 섹션은 이 흐름에서 어떤 단계 역할을 하는지 명확히 하여 logicalSections에 반영하세요.
 - 각 섹션마다 반드시 하나 이상의 전환 트리거(손실회피, 사회적 증거, 권위, 희소성, 편의성, 감정적 보상, 비교우위)를 적용하세요.
${structureGuide}
 반드시 아래 형식의 JSON 배열만 반환하세요. 배열 [ ] 로 시작하고 다른 텍스트는 포함하지 마세요.
 각 항목은 반드시 title, logicalSections, keyMessage, visualPrompt, sectionType, conversionRole 필드를 포함해야 합니다.

 중요 규칙 및 절대 금지 사항 (MUST FOLLOW):
 1. 반드시 제품의 시각적 가치(디테일, 소재, 착용샷, 연출샷 등)를 보여주는 '이미지 중심'의 섹션으로만 구성하세요. 각 이미지는 단독으로 보더라도 구매 설득이 가능해야 하며, 한 이미지 = 하나의 설득 역할만 수행하고 카피 역할이 서로 중복되지 않게 하세요.
 2. **다음 섹션들은 시스템에서 별도로 추가하므로 AI는 절대 생성하면 안 됩니다 (생성 시 오류 처리됨):**
    - '사이즈 가이드', '사이즈 조언', '실측 사이즈' 등 모든 사이즈 관련 섹션
    - '세탁 방법', '관리 방법', '보관 방법', '주의사항' 등 모든 관리 정보 섹션
    - '제품 상세 정보', '상품 기본 정보', '고객 센터' 관련 섹션
 3. 위 금지 항목 대신 다음 내용을 흐름에 맞게 포함하세요:
    - Hook: 3초 안에 시선을 잡는 첫인상 메인 섹션 (핵심 USP)
    - 문제 공감/확대: 고객의 실제 상황과 방치 시 손실을 자극하는 섹션
    - 해결책 제시: 왜 이 제품이, 왜 지금 필요한가
    - 핵심 셀링포인트: 기능 중심 / 감성 중심 / 비교 중심 / 사용 장면 중심 등 서로 다른 관점으로 (표현 방식 중복 금지)
    - 소재의 질감과 마감을 강조하는 클로즈업 섹션 (Extreme close-up)
    - 일상 속 자연스러운 사용/착용 연출 섹션 (Lifestyle shot)
    - 신뢰 강화: 브랜드 철학, 원재료, 제조공정, 품질관리 등으로 신뢰를 높이는 섹션
 4. [신뢰성 검증] 사실 확인이 불가능한 문구는 절대 금지합니다.
    - 금지 예시: "국내 판매 1위", "만족도 99%", "누적 판매 100만개", "효과 보장", 검증되지 않은 할인율/판매량/리뷰 수/평점/인증 문구
    - 대체 예시: "많은 고객이 선택한 이유", "재구매 후기가 이어지는 이유", "꾸준히 사랑받는 이유"

 keyMessage 작성 규칙:
 - 광고 문구가 아니라 '고객의 머릿속 생각을 대신 말하는' 방식으로 작성하여 공감과 설득을 동시에 유도
 - 반드시 존댓말(~세요, ~습니다)로 작성 (반말 금지)
 - 1~2줄로 작성하되, 한 줄당 25자 이내로 제한 (줄바꿈 \n 사용)
 - 예시: "매일 아침이 기다려지는\n부드러운 실크의 감촉을 느껴보세요"

 시각적 프롬프트(visualPrompt) 작성 규칙:
 - 영어로 작성하며, AI 이미지 생성기가 이해하기 쉬운 구체적인 묘사 포함
 - "A high-quality professional Korean e-commerce model cut of..."로 시작
 - 반드시 가상의 모델이 제품을 착용하거나 자연스럽게 사용하는 장면으로 작성
 - 제품 단독컷, 행거컷, 마네킹컷, 플랫레이를 지시하지 말 것
 - 다음 상업 사진 키워드를 자연스럽게 녹여서 묘사: photorealistic, commercial product photography, premium e-commerce, natural lighting, ultra realistic texture, high-end advertising, realistic shadows, Korean smartstore style, high conversion design
 - 조명, 배경, 각도, 질감, 모델 포즈를 사실적으로 기술
 - 모델 얼굴은 새롭게 생성된 가상의 인물로 표현하고 레퍼런스 인물의 얼굴을 복제하지 말 것
 - 클로즈업 섹션은 제품을 착용/사용한 상태의 자연스러운 부분 확대 컷으로 작성하고, 큰 제품 배경 위에 작은 전신 모델을 붙이는 합성 구도는 절대 지시하지 말 것
 - 미니어처 모델, 스티커처럼 붙인 모델, picture-in-picture, 손에 들린 작은 사람, 거대한 제품 무늬 배경 뒤의 작은 모델 같은 부자연스러운 합성 표현은 visualPrompt에 포함하지 말 것
 - 제품 로고/패턴/프린트는 실제 제품 위에서 현실적인 크기로 보이게 작성하고, 별도 배경 그래픽처럼 확대하지 말 것

 배열 예시: [ {"title": "오감으로 느끼는 편안함", "logicalSections": ["인지", "공감"], "sectionType": "offer", "conversionRole": "핵심 오퍼", "keyMessage": "몸에 닿는 순간 느껴지는\n천연 소재의 부드러움", "visualPrompt": "A high-quality professional Korean e-commerce model cut of a fictional model wearing the product in a minimalist studio background with soft natural lighting, photorealistic commercial product photography, ultra realistic texture and realistic shadows, clearly showing the product fit and premium details."} ]
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
          `${data.name || '상품'}\n선택해야 하는 이유`,
          '더 이상 고민하지 마세요\n편하게 선택하세요',
          '눈으로 확인하는\n믿을 수 있는 차이',
          '디테일까지 꼼꼼하게\n살펴보세요',
          '일상 속에서 더 자연스럽게\n활용해보세요',
          '구매 전 마지막까지\n안심하고 확인하세요',
        ];
    const normalizeKeyMessage = (value: any, index: number) => {
      const fallback = fallbackMessages[Math.min(index, fallbackMessages.length - 1)];
      const message = String(value || '').trim() || fallback;
      return message.split('\n').map(line => line.slice(0, 25)).join('\n').slice(0, 100);
    };

    return arr.map((item: any, index: number) => ({
      ...item,
      id: Math.random().toString(36).substring(7),
      title: item.title ?? "섹션",
      logicalSections: Array.isArray(item.logicalSections) ? item.logicalSections : ["기본"],
      sectionType: item.sectionType || fallbackTypes[Math.min(index, fallbackTypes.length - 1)],
      conversionRole: item.conversionRole || fallbackRoles[Math.min(index, fallbackRoles.length - 1)],
      // keyMessage 검증 - 각 줄이 25자를 초과하지 않도록 체크
      keyMessage: normalizeKeyMessage(item.keyMessage ?? item.copy ?? item.message, index),
      visualPrompt: item.visualPrompt ?? "",
    }));
  } catch (error) {
    console.error("Plan Error:", error);
    return [];
  }
};

// 이미지 생성은 OpenAI GPT Image 1.5 Medium 으로 처리합니다.
// 키 노출을 막기 위해 서버리스 엔드포인트(/api/generate-image)를 통해 호출합니다.
let imageErrorAlerted = false;
export const generateImage = async (
  prompt: string,
  base64Images: string[] = [],
  aspectRatio: string = "9:16"
): Promise<string | undefined> => {
  try {
    await trackUsage();

    const token = getToken();
    if (!token) throw new Error('로그인이 필요합니다.');

    const feature = aspectRatio === '1:1' ? 'thumbnail-image' : 'detail-image';

    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        prompt: `Generate a high-quality product image. ${prompt}. Aspect ratio: ${aspectRatio}.`,
        images: base64Images,
        aspectRatio,
        feature,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error || '이미지 생성에 실패했습니다.';
      console.error('Image generation failed:', msg);
      // 실제 OpenAI 오류를 화면에 1회 노출 (원인 진단용, 5초 디바운스)
      if (typeof window !== 'undefined' && !imageErrorAlerted) {
        imageErrorAlerted = true;
        setTimeout(() => { imageErrorAlerted = false; }, 5000);
        alert(`이미지 생성 오류\n\n${msg}`);
      }
      return undefined;
    }

    // 사용량/비용 로깅은 서버리스에서 처리하므로 클라이언트에서는 중복 기록하지 않습니다.
    return data.image || undefined;
  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
};
