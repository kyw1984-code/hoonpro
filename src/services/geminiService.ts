import { GoogleGenAI, Type } from "@google/genai";
import { ProductInfo, PageLength, DetailImageSegment } from "../types";
import { trackUsage } from "../lib/auth";

const getAiInstance = () => {
    // The platform injects the selected key into process.env.API_KEY
    // If not selected yet, it might use GEMINI_API_KEY
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    return new GoogleGenAI({ apiKey: apiKey as string });
};

export const recommendFeatures = async (productName: string, category: string): Promise<string> => {
    await trackUsage();
    const ai = getAiInstance();
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Suggest 3-5 compelling selling features (USPs) for a product named "${productName}" in the "${category}" category. Return only the features as a bulleted list in Korean.`,
    });
    return response.text || "";
};

export const planDetailPage = async (info: ProductInfo, length: PageLength): Promise<DetailImageSegment[]> => {
    await trackUsage();
    const ai = getAiInstance();
    
    let lengthInstruction = "";
    if (length === 5) {
        lengthInstruction = "Create exactly 5 sections: Hook -> Solution -> Clarity -> Service -> Risk Reversal.";
    } else if (length === 7) {
        lengthInstruction = "Create exactly 7 sections: Hook -> Solution -> Clarity -> Social Proof -> Detail Deep Dive -> Service -> Risk Reversal.";
    } else if (length === 9) {
        lengthInstruction = "Create exactly 9 sections: Hook -> Solution -> Clarity -> Social Proof -> Detail Deep Dive -> Brand Story -> Competitor Comparison -> Service -> Risk Reversal.";
    } else {
        lengthInstruction = "Determine the optimal number of sections (5, 7, or 9) based on the product and create them following the logical flow.";
    }

    const prompt = `
You are an expert Korean e-commerce detail page strategist for Smart Store and Coupang.
Plan a detail page for the following product:
Name: ${info.name}
Category: ${info.category}
Price: ${info.price}
Promotion: ${info.promotion}
Features: ${info.features}
Target: Gender(${info.targetGender.join(',')}), Age(${info.targetAge.join(',')})

${lengthInstruction}

For each section, provide:
1. title: e.g., "이미지 1 (문제 제기)"
2. logicalSections: Array of strategy tags applied.
3. keyMessage: The copy to be rendered on the image. MUST BE 100% NATURAL KOREAN. DO NOT USE ENGLISH HEADLINES (like Premium, Best).
4. visualPrompt: A description of the visual for a 9:16 aspect ratio image.

Return the result as a JSON array.
`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
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

export const generateSectionImage = async (segment: DetailImageSegment, referenceImage?: string): Promise<string | undefined> => {
    await trackUsage();
    const ai = getAiInstance();
    
    const parts: any[] = [];
    if (referenceImage) {
        // referenceImage is expected to be a data URL: data:image/png;base64,iVBORw0KGgo...
        const mimeType = referenceImage.split(';')[0].split(':')[1];
        const base64Data = referenceImage.split(',')[1];
        parts.push({
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        });
    }
    
    parts.push({
        text: `High quality e-commerce web banner. 
Visual description: ${segment.visualPrompt}. 
If an image is attached, use it as the main product. 
Render the following Korean text clearly and aesthetically on the image: "${segment.keyMessage}".`
    });

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts },
        config: {
            imageConfig: {
                aspectRatio: "9:16",
                imageSize: "1K"
            }
        }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    return undefined;
};

export const generateThumbnailImage = async (productName: string, features: string, style: string, elements: string, textOverlay: string, referenceImage?: string): Promise<string | undefined> => {
    await trackUsage();
    const ai = getAiInstance();
    
    const parts: any[] = [];
    if (referenceImage) {
        const mimeType = referenceImage.split(';')[0].split(':')[1];
        const base64Data = referenceImage.split(',')[1];
        parts.push({
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        });
    }
    
    parts.push({
        text: `High quality e-commerce product thumbnail. 
Product: ${productName}. 
Features: ${features}. 
Style: ${style}. 
Elements to include: ${elements}. 
If an image is attached, use it as the main product. 
Render the following Korean text clearly on the image: "${textOverlay}".`
    });

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: { parts },
        config: {
            imageConfig: {
                aspectRatio: "1:1",
                imageSize: "1K"
            }
        }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    return undefined;
};
