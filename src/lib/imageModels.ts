export type ImageProvider = 'gemini' | 'openai';

export interface ImageModelOption {
  id: string;
  provider: ImageProvider;
  label: string;
  description: string;
  costNote: string;
}

export interface ImageGenerationSettings {
  provider: ImageProvider;
  model: string;
}

export const DEFAULT_IMAGE_SETTINGS: ImageGenerationSettings = {
  provider: 'gemini',
  model: 'gemini-2.5-flash-image',
};

export const IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  {
    id: 'gemini-2.5-flash-image',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Image',
    description: '기존 이미지 생성 모델입니다. 현재 썸네일/상세페이지 기본값입니다.',
    costNote: '현재 앱 기준: 입력 $0.30/1M tokens, 출력 $30.00/1M tokens로 추정 집계',
  },
  {
    id: 'gpt-image-2',
    provider: 'openai',
    label: 'OpenAI GPT-Image-2',
    description: 'OpenAI GPT Image 계열의 최신 고품질 이미지 생성 모델입니다. 상품 레퍼런스 기반 생성, 한글 카피 렌더링, 상세페이지 완성형 이미지에 우선 추천합니다.',
    costNote: 'OpenAI 공식 가격: 이미지 입력 $8.00/1M tokens, 캐시 입력 $2.00/1M tokens, 이미지 출력 $30.00/1M tokens',
  },
];

export const getImageModelOption = (model: string): ImageModelOption => (
  IMAGE_MODEL_OPTIONS.find(option => option.id === model) ?? IMAGE_MODEL_OPTIONS[0]
);

export const normalizeImageSettings = (value: Partial<ImageGenerationSettings> | null | undefined): ImageGenerationSettings => {
  const model = String(value?.model || DEFAULT_IMAGE_SETTINGS.model);
  const option = getImageModelOption(model);
  return {
    provider: option.provider,
    model: option.id,
  };
};
