/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios";

// API 인스턴스 생성 및 환경 변수 로드
const getAiInstance = () => {
    // VITE_ 접두사가 붙은 환경 변수를 우선적으로 참조합니다.
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || 
                   import.meta.env.VITE_GEMINI_API_KEY || 
                   import.meta.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        console.error("API Key is missing! Check your Vercel Environment Variables.");
    }
    
    return new GoogleGenAI({ apiKey: apiKey as string });
};

// [수정] 배경 제거 기능을 건너뛰어 에러 방지 (remove.bg 키가 없어도 작동)
export const removeBackground = async (base64Image: string): Promise<string> => {
    console.log("Skipping remove.bg process...");
    return base64Image;
};

// 상세 페이지 플랜 생성 함수
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

    const prompt = `
You are an expert Korean e-commerce detail page strategist.
Plan a detail page for the following product:
Name: ${data.name}
Category: ${data.category}
Features: ${data.features}
Target: ${data.target}
${data.imageInstruction ? `Additional Image Generation Instruction: ${data.imageInstruction}` : ''}

${lengthInstruction}

For each section, provide title, logicalSections, keyMessage (NATURAL KOREAN), and visualPrompt.
Return the result as a JSON array.
`;

    try {
        const response = await ai.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
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

        const text = response.response.text();
        if (!text) return [];
        const parsed = JSON.parse(text);
        return parsed.map((item: any) => ({
            ...item,
            id: Math.random().toString(36).substring(7)
        }));
    } catch (e) {
        console.error("Failed to generate plan:", e);
        return [];
    }
};

// [중요 수정] 이미지 생성 함수
export const generateImage = async (prompt: string, base64Images: string[] = [], aspectRatio: string = "9:16", fastMode: boolean = false): Promise<string | undefined> => {
    const ai = getAiInstance();
    const parts: any[] = [];
    
    // 이미지 입력이 있는 경우 처리
    if (base64Images && base64Images.length > 0) {
        for (const base64Image of base64Images) {
            const mimeType = base64Image.split(';')[0].split(':')[1] || 'image/png';
            const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
            parts.push({
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType
                }
            });
        }
    }
    
    parts.push({ text: prompt });

    // [모델명 고정] 404 에러를 방지하기 위해 정식 출시된 1.5-flash 모델 사용
    // 유료 티어에서는 이 모델이 이미지 생성(Imagen)을 가장 안정적으로 지원합니다.
    const modelId = "gemini-1.5-flash"; 
    
    try {
        const model = ai.getGenerativeModel({ model: modelId });
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig: {
                // @ts-ignore: 일부 SDK 버전에서 imageConfig 타입을 인식하지 못할 수 있어 무시 처리
                imageConfig: {
                    aspectRatio: aspectRatio,
                }
            }
        });

        const response = result.response;
        const candidate = response.candidates?.[0];
        
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
        
        console.warn("No image returned from Gemini. Check if your API key has Imagen access.");
    } catch (error) {
        console.error("Image generation failed:", error);
        throw error;
    }
    return undefined;
};
