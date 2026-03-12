/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios";

const getAiInstance = () => {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
    return new GoogleGenAI({ apiKey: apiKey as string });
};

export const removeBackground = async (base64Image: string): Promise<string> => {
    const apiKey = import.meta.env.VITE_REMOVE_BG_API_KEY;
    if (!apiKey) {
        throw new Error("VITE_REMOVE_BG_API_KEY is not set in environment variables.");
    }

    const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    try {
        const response = await axios.post(
            'https://api.remove.bg/v1.0/removebg',
            {
                image_file_b64: base64Data,
                size: 'auto'
            },
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        return `data:image/png;base64,${response.data.data.result_b64}`;
    } catch (error) {
        console.error("Error removing background:", error);
        throw error;
    }
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

    const prompt = `
You are an expert Korean e-commerce detail page strategist.
Plan a detail page for the following product:
Name: ${data.name}
Category: ${data.category}
Features: ${data.features}
Target: ${data.target}
${data.imageInstruction ? `Additional Image Generation Instruction: ${data.imageInstruction}\n(Make sure to incorporate this instruction into the visualPrompt of each section)` : ''}

${lengthInstruction}

For each section, provide:
1. title: e.g., "이미지 1 (문제 제기)"
2. logicalSections: Array of strategy tags applied.
3. keyMessage: The copy to be rendered on the image. MUST BE 100% NATURAL KOREAN. DO NOT USE ENGLISH HEADLINES.
4. visualPrompt: A description of the visual for a 9:16 aspect ratio image.

Return the result as a JSON array.
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
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
            parts.push({
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType
                }
            });
        }
    }
    
    parts.push({ text: prompt });

    const model = fastMode ? "gemini-2.5-flash-image" : "gemini-3.1-flash-image-preview";
    const imageConfig: any = { aspectRatio: aspectRatio as any };
    if (!fastMode) {
        imageConfig.imageSize = "1K";
    }

    const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
            imageConfig
        }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    return undefined;
};
