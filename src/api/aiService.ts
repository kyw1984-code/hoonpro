import { GoogleGenerativeAI } from "@google/generative-ai";

const getApiKey = () => {
  return import.meta.env.VITE_GOOGLE_API_KEY || 
         import.meta.env.VITE_GEMINI_API_KEY || 
         import.meta.env.GEMINI_API_KEY || 
         "";
};

const genAI = new GoogleGenerativeAI(getApiKey());

export const removeBackground = async (image: string) => image;

// ✅ 텍스트 생성 - gemini-2.0-flash 사용 (안정적)
export const planDetail = async (data: any) => {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash"
    });

    const prompt = `You are an expert Korean e-commerce strategist. Plan a detail page for: ${data.name}. Return JSON array in Korean.`;
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    return parsed.map((item: any) => ({
      ...item,
      id: Math.random().toString(36).substring(7)
    }));
  } catch (error) {
    console.error("Plan Error:", error);
    return [];
  }
};

// ✅ 이미지 생성 - gemini-2.0-flash-preview-image-generation 사용
export const generateImage = async (
  prompt: string, 
  base64Images: string[] = [], 
  aspectRatio: string = "9:16"
) => {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-preview-image-generation"
    });

    const parts: any[] = [];

    // 참조 이미지가 있으면 포함
    if (base64Images.length > 0) {
      for (const base64Image of base64Images) {
        const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/png';
        const base64Data = base64Image.includes(',') 
          ? base64Image.split(',')[1] 
          : base64Image;
        parts.push({ inlineData: { data: base64Data, mimeType } });
      }
    }

    parts.push({ 
      text: `Generate a high-quality product image. ${prompt}. Aspect ratio: ${aspectRatio}.` 
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"], // ✅ 이미지 응답 요청
      } as any,
    });

    const response = result.response;
    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData
    );

    if (imagePart?.inlineData) {
      return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    }

    console.warn("이미지 데이터가 응답에 없습니다.");
    return undefined;

  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
};
