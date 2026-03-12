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

// ✅ 텍스트 생성 - responseMimeType으로 JSON 강제
export const planDetail = async (data: any) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
      },
      contents: `
당신은 한국 이커머스 전문 기획자입니다.
아래 상품의 상세페이지 기획안을 JSON 배열로 작성해주세요.

상품명: ${data.name}
${data.description ? `상품 설명: ${data.description}` : ""}

반드시 아래 형식의 JSON 배열만 반환하세요. 객체로 감싸지 말고 배열 [ ] 로 시작해야 합니다.
[
  {
    "section": "섹션명 (예: 메인 비주얼, 제품 특징, 사용 방법 등)",
    "title": "섹션 제목",
    "description": "섹션 내용 설명",
    "imagePrompt": "이미지 생성을 위한 영문 프롬프트"
  }
]
      `.trim(),
    });

    const text = response.text ?? "";
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    // ✅ 배열이 아닌 경우 방어 처리
    let arr: any[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object") {
      // { sections: [...] } 또는 { data: [...] } 형태로 올 경우 대응
      const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
      if (firstArray) {
        arr = firstArray as any[];
      } else {
        arr = [parsed]; // 단일 객체면 배열로 감싸기
      }
    }

    return arr.map((item: any) => ({
      ...item,
      id: Math.random().toString(36).substring(7),
    }));
  } catch (error) {
    console.error("Plan Error:", error);
    return [];
  }
};

// ✅ 이미지 생성 - gemini-2.5-flash-image
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
