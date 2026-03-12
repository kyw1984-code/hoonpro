/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";

const getAiInstance = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || 
                   import.meta.env.VITE_GEMINI_API_KEY || 
                   import.meta.env.GEMINI_API_KEY;
    return new GoogleGenAI({ apiKey: apiKey as string });
};

export const removeBackground = async (base64Image: string): Promise<string> => {
    return base64Image;
};

export const planDetail = async (data: any) => {
    const ai = getAiInstance();
    
    // SDK 버전에 따라 ai.models 가 없을 수 있으므로 안전하게 호출
    const modelName = "gemini-1.5-flash";
    
    const prompt = `You are an expert Korean e-commerce strategist. Plan a detail page for: ${data.name}. Return JSON array.`;

    try {
        // 구형 SDK 방식인 ai.models.generateContent 사용
        const response = await (ai as any).models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
            }
        });

        const text = response.text;
        const parsed = JSON.parse(text);
        return parsed.map((item: any) => ({
            ...item,
            id: Math.random().toString(36).substring(7)
        }));
    } catch (e) {
        console.error("Plan Error:", e);
        return [];
    }
};

export const generateImage = async (prompt: string, base64Images: string[] = [], aspectRatio: string = "9:16") => {
    const ai = getAiInstance();
    const parts: any[] = [];
    
    if (base64Images.length > 0) {
        for (const base64Image of base64Images) {
            const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/png';
            const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
            parts.push({ inlineData: { data: base64Data, mimeType } });
        }
    }
    parts.push({ text: prompt });

    try {
        // [수정] TypeError를 피하기 위해 가장 호환성이 높은 호출 방식 사용
        const response = await (ai as any).models.generateContent({
            model: "gemini-1.5-flash",
            contents: [{ role: "user", parts }],
            config: {
                imageConfig: { aspectRatio }
            }
        });

        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
    } catch (error) {
        console.error("Image generation failed:", error);
        throw error;
    }
    return undefined;
};
