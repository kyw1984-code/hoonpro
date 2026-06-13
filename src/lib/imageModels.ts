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
    description: '최신 GPT Image 모델입니다. 가장 넓은 해상도 옵션과 고품질 상품 레퍼런스 기반 생성에 우선 추천합니다.',
    costNote: '공식 예시 비용 High: 1024x1024 $0.211, 1024x1536 $0.165 / 입력 이미지 토큰 별도',
  },
  {
    id: 'gpt-image-1.5',
    provider: 'openai',
    label: 'OpenAI GPT-Image-1.5',
    description: 'GPT Image 1 대비 품질/속도/편집 안정성을 개선한 모델입니다. 비용과 품질 균형형으로 사용합니다.',
    costNote: '공식 예시 비용 High: 1024x1024 $0.133, 1024x1536 $0.200 / 입력 이미지 토큰 별도',
  },
  {
    id: 'gpt-image-1',
    provider: 'openai',
    label: 'OpenAI GPT-Image-1',
    description: '초기 GPT Image API 모델입니다. GPT 이미지 계열의 기본 호환 모델로 유지합니다.',
    costNote: '공식 예시 비용 High: 1024x1024 $0.167, 1024x1536 $0.250 / 입력 이미지 토큰 별도',
  },
  {
    id: 'gpt-image-1-mini',
    provider: 'openai',
    label: 'OpenAI GPT-Image-1 Mini',
    description: '가장 저렴한 GPT Image 모델입니다. 빠른 시안, 썸네일 초안, 반복 테스트에 적합합니다.',
    costNote: '공식 예시 비용 High: 1024x1024 $0.036, 1024x1536 $0.052 / 입력 이미지 토큰 별도',
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
