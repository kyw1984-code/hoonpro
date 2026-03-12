export interface DetailImageSegment {
  id: string;
  title: string;
  logicalSections: string[];
  keyMessage: string;
  visualPrompt: string;
  imageUrl?: string;
  isGenerating?: boolean;
}

export type PageLength = 5 | 7 | 9 | 'auto';

export interface ProductInfo {
  name: string;
  category: string;
  price: string;
  promotion: string;
  features: string;
  targetGender: string[];
  targetAge: string[];
  referenceImage?: string; // Base64
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
