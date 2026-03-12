/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios";

const getAiInstance = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || 
                   import.meta.env.VITE_GEMINI_API_KEY || 
                   import.meta.env.GEMINI_API_KEY;
    return new GoogleGenAI({ apiKey: apiKey as string });
};

// 배경 제거 건너뛰기
export const removeBackground = async (base64Image: string): Promise<string> => {
    return base64Image;
};

export const planDetail = async (data: {
    name: string;
    category: string;
    features: string;
    target: string;
    imageInstruction?: string;
    length: string | number;
}) => {
    const genAI = getAiInstance();
    // models/ 접두사를 생략하고 모델명만 전달
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    let lengthInstruction = "";
    if (data.length === 5) lengthInstruction = "Create exactly 5 sections: Hook -> Solution -> Clarity -> Proof -> Service.";
    else if (data.length === 7) lengthInstruction = "Create exactly 7 sections: Hook -> Solution -> Clarity -> Proof -> Detail -> Service -> Risk Reversal.";
    else if (data.length === 9) lengthInstruction = "Create exactly 9 sections: Hook -> Solution -> Clarity -> Proof -> Detail -> Brand Story -> Comparison -> Service -> Risk Reversal.";
    else lengthInstruction = "Determine the optimal number of sections.";

    const prompt = `You are an expert Korean e-commerce strategist. Plan a detail page for: ${data.name}. Return JSON array.`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
            }
        });
        const text = result.response.text();
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

export const generateImage = async (prompt: string, base64Images: string[] = [], aspectRatio: string = "9:16"): Promise<string | undefined> => {
    const genAI = getAiInstance();
    
    // [핵심 수정] 유료 티어에서 가장 안정적인 모델 호출 방식
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            // 이미지 생성 시 필요한 설정 (SDK 버전에 따라 조절)
            generationConfig: {
                // @ts-ignore
                imageConfig: { aspectRatio }
            }
        });

        const response = result.response;
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
        
        // 만약 여기서도 404가 난다면 모델명을 "gemini-1.5-pro"로 시도해 보세요.
    } catch (error) {
        console.error("Image generation failed:", error);
        throw error;
    }
    return undefined;
};
