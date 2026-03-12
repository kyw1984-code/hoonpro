import { GoogleGenerativeAI } from "@google/generative-ai";

// 환경변수에서 API 키를 안전하게 가져오는 함수
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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Plan a detail page for ${data.name}. Return as a JSON array.`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    // 마크다운 제거 후 파싱
    const cleanJson = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error(error);
    return [];
  }
};

export const generateImage = async (prompt: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    // 이미지 데이터 추출 로직 (유료 계정 전용)
    const part = result.response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    return part ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : undefined;
  } catch (error) {
    console.error(error);
    return undefined;
  }
};
