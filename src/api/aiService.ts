import { GoogleGenAI, Modality } from "@google/genai";
import { trackUsage } from "../lib/auth";

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

 keyMessage 작성 규칙:
 - 고객의 감성을 자극하는 전문 카피라이터 톤앤매너 유지
 - 반드시 존댓말(~세요, ~습니다)로 작성 (반말 금지)
 - 1~2줄로 작성하되, 한 줄당 25자 이내로 제한 (줄바꿈 \n 사용)
 - 예시: "매일 아침이 기다려지는\n부드러운 실크의 감촉을 느껴보세요"

 시각적 프롬프트(visualPrompt) 작성 규칙:
 - 영어로 작성하며, AI 이미지 생성기가 이해하기 쉬운 구체적인 묘사 포함
 - "A high-quality professional product photography of..."로 시작
 - 조명, 배경, 각도, 질감 등을 사실적으로 기술

 배열 예시: [ {"title": "오감으로 느끼는 편안함", "logicalSections": ["메인", "시각화"], "keyMessage": "몸에 닿는 순간 느껴지는\n천연 소재의 압도적인 부드러움", "visualPrompt": "A high-quality professional product photography of the product in a minimalist studio background with soft natural lighting, showing its elegant design."} ]
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
    await trackUsage();
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
