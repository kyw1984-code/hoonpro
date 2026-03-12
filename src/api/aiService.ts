/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios";

const getAiInstance = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
    return new GoogleGenAI({ apiKey: apiKey as string });
};

// 배경 제거 기능을 건너뛰어 에러 방지
export const removeBackground = async (base64Image: string): Promise<string> => {
    console.log("Skipping remove.bg...");
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
    const ai = getAiInstance();
    
    let lengthInstruction = "";
    if (data.length === 5) {
        lengthInstruction = "Create exactly 5 sections: Hook -> Solution -> Clarity -> Proof -> Service.";
    } else if (data.length === 7) {
        lengthInstruction = "Create exactly 7 sections: Hook -> Solution -> Clarity -> Proof -> Detail -> Service -> Risk Reversal.";
    } else if (data.length === 9) {
        lengthInstruction = "Create exactly 9 sections: Hook -> Solution -> Clarity -> Proof -> Detail -> Brand Story -> Comparison -> Service -> Risk Reversal.";
    } else {
        lengthInstruction = "Determine the optimal number of sections (5, 7, or 9) based on the product and create them following the logical flow.";
    }

    const prompt = `You are an expert Korean e-commerce strategist... (중략)`;

    const response = await ai.models.generateContent({
        // [변경] 가장 할당량이 넉넉한 1.5 flash 모델로 고정
        model: "gemini-1.5-flash", 
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        logicalSections: { type: Type.ARRAY, items: { type: Type.STRING } },
                        keyMessage: { type: Type.STRING },
                        visualPrompt: { type: Type.STRING }
                    },
                    required: ["title", "logicalSections", "keyMessage", "visualPrompt"]
                }
            }
        }
    });

    const text = response.text;
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        return parsed.map((item: any) => ({
            ...item,
            id: Math.random().toString(36).substring(7)
        }));
    } catch (e) {
        console.error("Failed to parse JSON", e);
        return [];
    }
};

export const generateImage = async (prompt: string, base64Images: string[] = [], aspectRatio: string = "9:16", fastMode: boolean = false): Promise<string | undefined> => {
    const ai = getAiInstance();
    const parts: any[] = [];
    
    if (base64Images && base64Images.length > 0) {
        for (const base64Image of base64Images) {
            const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/png';
            const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
            parts.push({ inlineData: { data: base64Data, mimeType } });
        }
    }
    parts.push({ text: prompt });

    // [중요 변경] 429 에러가 났던 2.5-preview 대신 2.0-flash로 변경
    // 만약 2.0-flash도 같은 에러가 난다면 구글 AI 스튜디오에서 Imagen 모델 사용 권한을 확인해야 합니다.
    const model = "gemini-2.0-flash"; 
    
    try {
        const response = await ai.models.generateContent({
            model,
            contents: { parts },
            config: { imageConfig: { aspectRatio: aspectRatio as any } }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
    } catch (error) {
        console.error("Image generation failed:", error);
        throw error;
    }
    return undefined;
};
