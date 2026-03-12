import { GoogleGenerativeAI } from "@google/generative-ai";

const getApiKey = () => {
  return import.meta.env.VITE_GOOGLE_API_KEY || 
         import.meta.env.VITE_GEMINI_API_KEY || 
         import.meta.env.GEMINI_API_KEY || 
         "";
};

const genAI = new GoogleGenerativeAI(getApiKey());

export const removeBackground = async (image: string) => image;

export const planDetail = async (data: any) => {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash" 
    }, { apiVersion: 'v1' });

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

export const generateImage = async (prompt: string, base64Images: string[] = [], aspectRatio: string = "9:16") => {
  try {
    // [수정] 이미지 생성 전용 모델인 imagen-3.0-generate-001 또는 gemini-1.5-flash 사용
    // 유료 계정이시라면 imagen 모델을 직접 호출하는 것이 가장 좋습니다.
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash" 
    }, { apiVersion: 'v1' });

    const parts: any[] = [];
    if (base64Images.length > 0) {
      for (const base64Image of base64Images) {
        const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/png';
        const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
        parts.push({ inlineData: { data: base64Data, mimeType } });
      }
    }
    parts.push({ text: `Generate a high-quality product image based on: ${prompt}. Aspect ratio should be ${aspectRatio}.` });

    // [중요 수정] 에러를 일으킨 imageConfig 부분을 삭제하고 기본 요청으로 변경합니다.
    const result = await model.generateContent({
      contents: [{ role: "user", parts }]
    });

    const response = result.response;
    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    
    if (part && part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
    
    // 만약 이미지가 바로 안 오고 텍스트 설명만 온다면, 
    // 이는 모델이 이미지를 직접 생성하지 않고 설명만 한 것입니다.
    console.warn("No inlineData found in response parts.");
  } catch (error) {
    console.error("Image generation failed:", error);
  }
  return undefined;
};
