import { GoogleGenAI, Modality } from "@google/genai";

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

    const text = response.text ?? "";
    return text.trim();
  } catch (error) {
    console.error("Feature generation error:", error);
    return ""; // 실패시 빈 문자열 반환
  }
};

export const planDetail = async (data: any) => {
  try {
    const lengthGuide = data.length === 'auto'
      ? '상품 특성에 맞게 5~9장 사이로 최적 구성'
      : `정확히 ${data.length}장으로 구성`;

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
핵심 특징: ${data.features || '없음'}
타겟 고객: ${data.target || '없음'}
페이지 길이: ${lengthGuide}

반드시 아래 형식의 JSON 배열만 반환하세요. 배열 [ ] 로 시작하고 다른 텍스트는 포함하지 마세요.
각 항목은 반드시 title, logicalSections, keyMessage, visualPrompt 필드를 포함해야 합니다.

상세페이지 구성 가이드:
- 반드시 제품의 디테일(질감, 소재, 마감, 봉제선, 버튼, 지퍼 등)을 보여주는 세그먼트를 포함할 것
- 디테일 컷 섹션에서는 클로즈업 샷을 요청하여 제품의 품질을 강조

절대 생성하지 말 것 (별도 템플릿 옵션으로 제공):
- 사이즈 관련 섹션: "사이즈 가이드", "사이즈 선택", "당신에게 맞는 사이즈" 등
- 제품 정보 및 관리 섹션: "세탁 방법", "관리 방법", "보관 방법", "제품 정보" 등
- 위 내용은 별도 추가 옵션으로 제공되므로 AI 이미지 생성 세그먼트에서 제외

keyMessage 작성 규칙:
- 고객의 흥미를 끌고 감성을 자극하는 자연스러운 카피 작성
- 반드시 존댓말(~세요, ~습니다)로 작성할 것
- 1~3줄로 작성 가능하며, 각 줄은 25자 이내로 제한
- 줄바꿈이 필요한 경우 \n 사용
- 예시: "매일 밤 꿀잠을 약속합니다\n당신의 숙면을 위한 최고의 선택", "민감한 피부도 안심하세요\n자연에서 온 순한 케어", "나만의 트렌디함을 뽐내보세요\n스타일을 완성하는 특별함"
- 제품의 핵심 가치와 고객 혜택을 명확히 전달할 것
- 반말(~해, ~봐) 절대 사용 금지

[
  {
    "title": "섹션 제목 (예: 메인 비주얼, 제품 특징, 디테일 컷, 사용 방법, 스타일링, 보관 방법 등)",
    "logicalSections": ["태그1", "태그2"],
    "keyMessage": "흥미를 끄는 자연스러운 카피\n필요시 2-3줄로 작성 (각 줄 25자 이내)",
    "visualPrompt": "This section should show [detailed English description]. For detail shots: extreme close-up of product material, texture, stitching, buttons, zippers, or craftsmanship. Show fine details clearly to emphasize quality."
  }
]

추천 섹션 예시:
1. 메인 비주얼: 제품의 전체적인 모습
2. 핵심 특징: 제품의 주요 장점
3. 디테일 컷: 소재, 질감, 마감 클로즈업
4. 사용 방법 / 활용법
5. 스타일링 제안 / 코디 팁
6. 브랜드 스토리 / 제품 개발 배경
7. 고객 혜택 / 차별화 포인트
      `.trim(),
    });

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

    return arr.map((item: any) => ({
      ...item,
      id: Math.random().toString(36).substring(7),
      title: item.title ?? "섹션",
      logicalSections: Array.isArray(item.logicalSections) ? item.logicalSections : ["기본"],
      // keyMessage 검증 - 각 줄이 25자를 초과하지 않도록 체크
      keyMessage: (item.keyMessage ?? "").split('\n').map(line => line.slice(0, 25)).join('\n').slice(0, 100),
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
    const parts: any[] = [];

    if (base64Images.length > 0) {
      for (const base64Image of base64Images) {
        const mimeType =
          base64Image.split(";")[0].split(":")[1] || "image/png";
        const base64Data = base64Image.includes(",")
          ? base64Image.split(",")[1]
          : base64Image;
        parts.push({ inlineData: { data: base64Data, mimeType } });
      }
    }

    parts.push({
      text: `Generate a high-quality product image. ${prompt}. Aspect ratio: ${aspectRatio}.`,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts }],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }

    console.warn("이미지 데이터가 응답에 없습니다.");
    return undefined;
  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
};
