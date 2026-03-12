import { GoogleGenerativeAI } from "@google/generative-ai";

const getApiKey = () => {
  return import.meta.env.VITE_GOOGLE_API_KEY || 
         import.meta.env.VITE_GEMINI_API_KEY || 
         import.meta.env.GEMINI_API_KEY || 
         "";
};

// [중요] 생성자에서 정식 버전(v1)을 사용하도록 명시합니다.
const genAI = new GoogleGenerativeAI(getApiKey());

export const removeBackground = async (image: string) => image;

export const planDetail = async (data: any) => {
  try {
    // 모델을 가져올 때 v1 버전을 사용하도록 강제 설정합니다.
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash" 
    }, { apiVersion: 'v1' });

    const prompt = `You are an expert Korean e-commerce strategist. Plan a detail page for: ${data.name}. Return JSON array in Korean.`;
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson).map((item: any) => ({
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
    // 이미지 생성도 동일하게 v1 경로를 사용합니다.
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
    parts.push({ text: prompt });

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      // @ts-ignore
      generationConfig: { imageConfig: { aspectRatio } }
    });

    const response = result.response;
    const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (part && part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  } catch (error) {
    console.error("Image generation failed:", error);
  }
  return undefined;
};
