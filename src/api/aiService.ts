import { trackUsage, getToken } from "../lib/auth";

export const removeBackground = async (image: string) => image;

const generateText = async (
  prompt: string,
  feature: string,
  mode: 'text' | 'json' = 'text'
): Promise<string> => {
  await trackUsage();

  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');

  const res = await fetch('/api/generate-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, feature, mode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'GPT 텍스트 생성에 실패했습니다.');
  return String(data.text || '').trim();
};

export const planDetail = async (data: any) => {
  try {
    await trackUsage();
    const targetCount = data.length === 'auto' ? '8장' : `${data.length}장`;
    const lengthGuide = data.length === 'auto'
      ? '빠른 기본 상세페이지 기준 8장으로 구성'
      : `정확히 ${data.length}장으로 구성`;
    const structureGuide = `
 [STEP 3] 이미지 순서 템플릿 (반드시 이 순서를 따르세요, 총 ${targetCount}):
 - 1번 (Hook): 3초 안에 시선을 잡는 메인 이미지. 핵심 USP를 강하게 보여주는 첫인상. sectionType=offer, conversionRole=핵심 오퍼
 - 2번 (문제 공감): 고객이 실제로 겪는 불편/상황에 공감. sectionType=problem, conversionRole=고객 문제/상황
 - 3번 (문제 확대): 그 문제를 방치하면 생기는 손실을 자극(손실회피). sectionType=problem, conversionRole=문제 심화
   (전체 장수가 적으면 2번과 3번을 한 장으로 합쳐도 됩니다)
 - 4번 (해결책 제시): 왜 이 제품이, 왜 지금 필요한가. sectionType=offer, conversionRole=해결책
 - 중간 (핵심 셀링포인트, 여러 장): 제품 강점을 서로 다른 관점으로. 각 장의 표현 방식은 절대 중복 금지하고 매 장 다른 각도를 사용:
   · 기능 중심 / 감성 중심 / 비교 우위 중심 / 수치·근거 중심 / 사용 장면 중심 중에서 매 장 다른 각도
   · sectionType은 detail/proof/lifestyle 중 내용에 맞게, conversionRole은 구매 근거/제품 디테일/활용 장면 등
 - 끝에서 두 번째 (신뢰 강화): 원재료·제조공정·품질관리·브랜드 철학 등으로 신뢰를 높임. sectionType=trust, conversionRole=구매 안심
 - 마지막 (CTA): 지금 구매해야 하는 이유와 행동 유도(타이밍 강조). sectionType=trust, conversionRole=구매 확신
 - 전체 장수에 맞게 위 단계를 자연스럽게 배분하되, 반드시 Hook으로 시작해 CTA로 끝나야 합니다.
`;
    const combinationType = data.combinationType && data.combinationType !== 'single'
      ? String(data.combinationType)
      : '';
    const combinationCount = Number(data.combinationCount) || getCombinationCount(combinationType);
    const combinationLabel = getCombinationLabel(combinationType);
    const combinationGuide = combinationType
      ? `
 조합상품 전용 작성 규칙:
 - 이 상품은 ${combinationLabel} 상품이며 총 ${combinationCount}개 구성입니다.
 - 첫 번째 항목은 반드시 "${combinationLabel} 인트로" 섹션으로 작성하세요.
 - 첫 번째 keyMessage의 첫 줄에는 반드시 "${combinationCount}개 구성"을 포함하세요.
 - 첫 번째 visualPrompt는 정확히 ${combinationCount}개 제품이 한 세로형 페이지에 함께 보이는 구성을 영어로 작성하세요. 업로드된 레퍼런스가 여러 장이면 각 업로드 이미지를 서로 다른 구성품으로 보고 가능한 모든 레퍼런스 제품을 같은 장면에 반드시 포함하세요.
 - 1번 Hook은 모델컷이어도 정확히 ${combinationCount}개 구성품이 모두 명확히 보여야 합니다. 3개 조합이면 3개 제품, 4개 조합이면 4개 제품이 보여야 하며 선택 개수보다 적게 만들지 마세요.
 - 이후 섹션도 단품이 아니라 묶음 구성의 실용성, 여유분, 함께 쓰는 장점, 선물/비축 가치 등을 자연스럽게 반영하세요.
 - 중간 섹션 중 최소 2장은 ${combinationCount}개 구성품이 함께 나오는 visualPrompt로 작성하세요. 특히 상품 특장점/활용 장면/CTA 중 하나 이상은 ${combinationCount}개 제품을 한 컷에 함께 보여주세요.
 - 실제 가격, 할인율, 최저가 같은 검증되지 않은 수치 표현은 만들지 마세요.
`
      : ' 상품 구성: 일반 단품 상세페이지로 작성하세요.';
    const designPreset = data.designPreset && typeof data.designPreset === 'object'
      ? data.designPreset
      : null;
    const designGuide = designPreset
      ? `
 디자인 프리셋:
 - 스타일명: ${designPreset.label}
 - 카피 톤: ${designPreset.copyTone}
 - 이미지 스타일: ${designPreset.imageStyle}
 - 배경 방향: ${designPreset.backgroundGuide}
 - 모든 섹션의 keyMessage와 visualPrompt는 위 스타일을 일관되게 반영하세요.
`
      : '';
    const conversionEnabled = data.conversionEnabled !== false;
    const conversionMode = data.effectiveConversionMode || data.conversionMode || 'auto';
    const conversionLabelMap: Record<string, string> = {
      auto: '자동 추천',
      premiumTrust: '프리미엄 신뢰형',
      bundleValue: '조합상품 혜택형',
      problemSolution: '문제 해결형',
      dealFocus: '세일/혜택형',
    };
    const conversionGuide = conversionEnabled
      ? `
 전환율 강화 모드:
 - 적용 모드: ${conversionLabelMap[conversionMode] || '자동 추천'}
 - 전체 흐름은 반드시 첫인상 → 문제 해결 → 근거/후기 → 제품 디테일 → 구매 안심 정보 순서로 설계하세요.
 - 첫 번째 섹션 conversionRole은 반드시 "핵심 오퍼" 또는 조합상품이면 "조합 핵심 오퍼"로 작성하세요.
 - 두 번째 섹션 conversionRole은 반드시 "고객 문제/상황"으로 작성하세요.
 - 세 번째 섹션 conversionRole은 반드시 "구매 근거"로 작성하세요.
 - 각 항목에 sectionType과 conversionRole을 반드시 포함하세요.
 - sectionType은 offer, problem, proof, detail, lifestyle, trust 중 하나를 사용하세요.
 - 실제 후기 수, 판매량, 할인율, 최저가, 인증 여부처럼 검증되지 않은 수치나 사실은 만들지 마세요.
 - 고객 후기는 사용자가 별도 템플릿으로 입력할 수 있으므로 실제 후기처럼 보이는 허위 리뷰 문장은 생성하지 마세요.
`
      : '';

    const text = await generateText(`
 당신은 대한민국 상위 1% 이커머스 광고 디자이너이자 퍼포먼스 마케터, CRO(전환율 최적화) 전문가, 브랜드 전략가입니다.
 목표는 단순한 상세페이지 제작이 아니라, 방문자를 구매자로 전환시키는 '판매용 상세페이지' 기획안을 만드는 것입니다.
 아래 상품의 상세페이지 기획안을 JSON 배열로 작성해주세요. 정보가 부족하면 카테고리 특성과 시장 관행을 참고하여 합리적으로 보완하세요.

 상품명: ${data.name}
 카테고리: ${data.category || '미입력 (상품명/설명/이미지로 합리적으로 추정)'}
 상품 설명: ${data.description || '없음'}
 타겟 고객: ${data.target || '없음'}
 페이지 길이: ${lengthGuide}
 상품 구성: ${combinationType ? `${combinationLabel} 상품 (${combinationCount}개 구성)` : '일반 상품'}
${combinationGuide}
${designGuide}
${conversionGuide}

 [STEP 1] 내부 분석 (출력에는 직접 쓰지 말고 기획에 반영):
 - 제품 정의: 어떤 제품인가 / 어떤 문제를 해결하는가
 - 고객 분석: 핵심 타겟과 '표면 니즈'와 '실제 숨은 니즈'를 구분 (예: 운동기구 → 운동하고 싶음 → 살 빼고 싶음 → 자기관리 잘하는 사람처럼 보이고 싶음)
 - 경쟁 대비 차별점 최소 3개
 - 구매 저항 요소 최소 5개 (효과 있을까, 오래 쓸까, 사용이 어려울까, 내게 맞을까, 배송 문제 없을까 등)를 도출하고 각 섹션이 이 불안을 해소하도록 설계

 [STEP 2] 전환 심리 흐름 설계:
 - 전체 흐름은 반드시 '인지 → 공감 → 문제 인식 → 해결책 발견 → 신뢰 형성 → 구매 확신 → 결제' 순서를 따르도록 섹션을 배치하세요.
 - 각 섹션은 이 흐름에서 어떤 단계 역할을 하는지 명확히 하여 logicalSections에 반영하세요.
 - 각 섹션마다 반드시 하나 이상의 전환 트리거(손실회피, 사회적 증거, 권위, 희소성, 편의성, 감정적 보상, 비교우위)를 적용하세요.
${structureGuide}
 반드시 아래 형식의 JSON 배열만 반환하세요. 배열 [ ] 로 시작하고 다른 텍스트는 포함하지 마세요.
 각 항목은 반드시 title, logicalSections, keyMessage, visualPrompt, sectionType, conversionRole 필드를 포함해야 합니다.

 중요 규칙 및 절대 금지 사항 (MUST FOLLOW):
 1. 반드시 제품의 시각적 가치(디테일, 소재, 착용샷, 연출샷 등)를 보여주는 '이미지 중심'의 섹션으로만 구성하세요. 각 이미지는 단독으로 보더라도 구매 설득이 가능해야 하며, 한 이미지 = 하나의 설득 역할만 수행하고 카피 역할이 서로 중복되지 않게 하세요.
 2. **다음 섹션들은 시스템에서 별도로 추가하므로 AI는 절대 생성하면 안 됩니다 (생성 시 오류 처리됨):**
    - '사이즈 가이드', '사이즈 조언', '실측 사이즈' 등 모든 사이즈 관련 섹션
    - '세탁 방법', '관리 방법', '보관 방법', '주의사항' 등 모든 관리 정보 섹션
    - '제품 상세 정보', '상품 기본 정보', '고객 센터' 관련 섹션
 3. 위 금지 항목 대신 다음 내용을 흐름에 맞게 포함하세요:
    - Hook: 3초 안에 시선을 잡는 첫인상 메인 섹션 (핵심 USP)
    - 문제 공감/확대: 고객의 실제 상황과 방치 시 손실을 자극하는 섹션
    - 해결책 제시: 왜 이 제품이, 왜 지금 필요한가
    - 핵심 셀링포인트: 기능 중심 / 감성 중심 / 비교 중심 / 사용 장면 중심 등 서로 다른 관점으로 (표현 방식 중복 금지)
    - 소재의 질감과 마감을 강조하는 클로즈업 섹션 (Extreme close-up)
    - 일상 속 자연스러운 사용/착용 연출 섹션 (Lifestyle shot)
    - 신뢰 강화: 브랜드 철학, 원재료, 제조공정, 품질관리 등으로 신뢰를 높이는 섹션
 4. [신뢰성 검증] 사실 확인이 불가능한 문구는 절대 금지합니다.
    - 금지 예시: "국내 판매 1위", "만족도 99%", "누적 판매 100만개", "효과 보장", 검증되지 않은 할인율/판매량/리뷰 수/평점/인증 문구
    - 대체 예시: "많은 고객이 선택한 이유", "재구매 후기가 이어지는 이유", "꾸준히 사랑받는 이유"

 keyMessage 작성 규칙:
 - 광고 문구가 아니라 '고객의 머릿속 생각을 대신 말하는' 방식으로 작성하여 공감과 설득을 동시에 유도
 - 반드시 존댓말(~세요, ~습니다)로 작성 (반말 금지)
 - 1~2줄로 작성하되, 한 줄당 25자 이내로 제한 (줄바꿈 \n 사용)
 - 예시: "매일 아침이 기다려지는\n부드러운 실크의 감촉을 느껴보세요"

 시각적 프롬프트(visualPrompt) 작성 규칙:
 - 영어로 작성하며, AI 이미지 생성기가 이해하기 쉬운 구체적인 묘사 포함
 - "A high-quality professional Korean e-commerce model cut of..."로 시작
 - 반드시 가상의 모델이 제품을 착용하거나 자연스럽게 사용하는 장면으로 작성
 - 제품 단독컷, 행거컷, 마네킹컷, 플랫레이를 지시하지 말 것
 - 다음 상업 사진 키워드를 자연스럽게 녹여서 묘사: photorealistic, commercial product photography, premium e-commerce, natural lighting, ultra realistic texture, high-end advertising, realistic shadows, Korean smartstore style, high conversion design
 - 조명, 배경, 각도, 질감, 모델 포즈를 사실적으로 기술
 - 모델 얼굴은 새롭게 생성된 가상의 인물로 표현하고 레퍼런스 인물의 얼굴을 복제하지 말 것
 - 클로즈업 섹션은 제품을 착용/사용한 상태의 자연스러운 부분 확대 컷으로 작성하고, 큰 제품 배경 위에 작은 전신 모델을 붙이는 합성 구도는 절대 지시하지 말 것
 - 미니어처 모델, 스티커처럼 붙인 모델, picture-in-picture, 손에 들린 작은 사람, 거대한 제품 무늬 배경 뒤의 작은 모델 같은 부자연스러운 합성 표현은 visualPrompt에 포함하지 말 것
 - 제품 로고/패턴/프린트는 실제 제품 위에서 현실적인 크기로 보이게 작성하고, 별도 배경 그래픽처럼 확대하지 말 것

 배열 예시: [ {"title": "오감으로 느끼는 편안함", "logicalSections": ["인지", "공감"], "sectionType": "offer", "conversionRole": "핵심 오퍼", "keyMessage": "몸에 닿는 순간 느껴지는\n천연 소재의 부드러움", "visualPrompt": "A high-quality professional Korean e-commerce model cut of a fictional model wearing the product in a minimalist studio background with soft natural lighting, photorealistic commercial product photography, ultra realistic texture and realistic shadows, clearly showing the product fit and premium details."} ]
      `.trim(), 'detail-plan', 'json');
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    let arr: any[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object") {
      const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
      arr = firstArray ? (firstArray as any[]) : [parsed];
    }

    const fallbackRoles = combinationType
      ? ['조합 핵심 오퍼', '고객 문제/상황', '구매 근거', '제품 디테일', '활용 장면', '구매 안심']
      : ['핵심 오퍼', '고객 문제/상황', '구매 근거', '제품 디테일', '활용 장면', '구매 안심'];
    const fallbackTypes = ['offer', 'problem', 'proof', 'detail', 'lifestyle', 'trust'];
    const fallbackMessages = combinationType
      ? [
          `${combinationType} 구성\n한 번에 준비하세요`,
          '더 이상 고민하지 마세요\n편하게 선택하세요',
          '구성의 차이를\n눈으로 확인하세요',
          '디테일까지 꼼꼼하게\n살펴보세요',
          '일상 속에서 더 자연스럽게\n활용해보세요',
          '구매 전 마지막까지\n안심하고 확인하세요',
        ]
      : [
          `${data.name || '상품'}\n선택해야 하는 이유`,
          '더 이상 고민하지 마세요\n편하게 선택하세요',
          '눈으로 확인하는\n믿을 수 있는 차이',
          '디테일까지 꼼꼼하게\n살펴보세요',
          '일상 속에서 더 자연스럽게\n활용해보세요',
          '구매 전 마지막까지\n안심하고 확인하세요',
        ];
    const normalizeKeyMessage = (value: any, index: number) => {
      const fallback = fallbackMessages[Math.min(index, fallbackMessages.length - 1)];
      const message = String(value || '').trim() || fallback;
      return message.split('\n').map(line => line.slice(0, 25)).join('\n').slice(0, 100);
    };

    return arr.map((item: any, index: number) => ({
      ...item,
      id: Math.random().toString(36).substring(7),
      title: item.title ?? "섹션",
      logicalSections: Array.isArray(item.logicalSections) ? item.logicalSections : ["기본"],
      sectionType: item.sectionType || fallbackTypes[Math.min(index, fallbackTypes.length - 1)],
      conversionRole: item.conversionRole || fallbackRoles[Math.min(index, fallbackRoles.length - 1)],
      // keyMessage 검증 - 각 줄이 25자를 초과하지 않도록 체크
      keyMessage: normalizeKeyMessage(item.keyMessage ?? item.copy ?? item.message, index),
      visualPrompt: item.visualPrompt ?? "",
    }));
  } catch (error) {
    console.error("Plan Error:", error);
    return [];
  }
};

// ─────────────────────────────────────────────────────────────
// V2.1 마스터 프롬프트 기반 "상세페이지 기획서" 생성
// 입력값 중 하나만 있어도 동작하며, 기획안(JSON)을 먼저 만든 뒤 이미지를 생성한다.
// ─────────────────────────────────────────────────────────────
export interface DetailPlanImage {
  number: number;
  role: string;          // Hook / 문제 공감 / 핵심 셀링포인트 ...
  stage: string;         // 심리 단계: 인지/공감/문제 인식/해결책/신뢰/확신
  sectionType: string;   // offer/problem/proof/detail/lifestyle/trust/cta
  shotType?: 'model' | 'product' | 'detail' | 'texture' | 'lifestyle' | 'package' | 'cta';
  mainCopy: string;      // 메인 카피 (한글, \n 줄바꿈)
  subCopy: string;       // 서브 카피
  points: string[];      // 보조 포인트 3~5개
  trustElement: string;  // 신뢰 요소
  trigger: string;       // 전환 트리거
  textPosition: 'top' | 'middle' | 'bottom';
  visualPrompt: string;  // 이미지 생성 프롬프트 (영어, 텍스트 없는 비주얼)
}

export interface ProductBrief {
  coreFeatures: string[];
  productIdentity: string;
  visualMustKeep: string[];
  targetMood: string;
  heroDirection: string;
  inferredGender?: 'male' | 'female' | 'unisex' | 'none';
  inferredGenderReason?: string;
}

export interface DetailPlan {
  isFallback?: boolean;
  fallbackReason?: string;
  productDefinition: string;
  customer: { target: string; surfaceNeed: string; realNeed: string };
  differentiators: string[];
  purchaseResistances: string[];
  designSystem: {
    tone: string;
    colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  };
  images: DetailPlanImage[];
}

const getDetailPlanCount = (value: any): number => {
  if (value === 'auto') return 8;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 8;
};

const getCombinationCount = (value: any): number => {
  const raw = String(value || 'single');
  if (!raw || raw === 'single') return 1;
  const bundleMatch = /^bundle-(\d+)$/.exec(raw);
  if (bundleMatch) return Math.min(4, Math.max(2, Number(bundleMatch[1]) || 2));
  if (raw.includes('+')) return Math.min(4, Math.max(2, raw.split('+').filter(Boolean).length));
  return 1;
};

const getCombinationLabel = (value: any): string => {
  const count = getCombinationCount(value);
  return count >= 2 ? `${count}개 조합` : '단품';
};

const inferDetailTone = (value: any): string => {
  const tone = String(value || '').trim();
  return tone && tone !== 'auto' ? tone : '프리미엄';
};

const normalizeProductBrief = (value: any, data: any): ProductBrief => {
  const productName = String(data.name || '상품').trim() || '상품';
  const fallback: ProductBrief = {
    coreFeatures: ['제품 본연의 매력', '실사용 중심 설계', '디테일 완성도'],
    productIdentity: `${productName}의 색상, 형태, 프린팅/로고/소재감을 보존해야 하는 제품`,
    visualMustKeep: ['레퍼런스 제품 색상 유지', '프린팅/로고/패턴 보존', '제품 형태와 핏 유지'],
    targetMood: data.target ? `${data.target}에게 어울리는 프리미엄 커머스 무드` : '구매 확신을 주는 프리미엄 커머스 무드',
    heroDirection: '첫 장은 제품을 착용/사용한 강한 모델컷으로 구성하고 제품이 크게 보이게 연출',
    inferredGender: 'none',
    inferredGenderReason: '상품 정보만으로 성별을 확정하지 않음',
  };
  const source = value && typeof value === 'object' ? value : {};
  const inferredGender = ['male', 'female', 'unisex', 'none'].includes(source.inferredGender)
    ? source.inferredGender
    : fallback.inferredGender;
  return {
    coreFeatures: Array.isArray(source.coreFeatures) && source.coreFeatures.length > 0
      ? source.coreFeatures.slice(0, 5).map(String)
      : fallback.coreFeatures,
    productIdentity: String(source.productIdentity || fallback.productIdentity),
    visualMustKeep: Array.isArray(source.visualMustKeep) && source.visualMustKeep.length > 0
      ? source.visualMustKeep.slice(0, 6).map(String)
      : fallback.visualMustKeep,
    targetMood: String(source.targetMood || fallback.targetMood),
    heroDirection: String(source.heroDirection || fallback.heroDirection),
    inferredGender,
    inferredGenderReason: String(source.inferredGenderReason || fallback.inferredGenderReason),
  };
};

export const generateProductBrief = async (data: any): Promise<ProductBrief> => {
  try {
    const text = await generateText(`
당신은 한국 이커머스 상세페이지 기획자입니다.
아래 상품 정보만 보고 상세페이지 기획 전에 사용할 핵심특징 브리프를 JSON 객체로 정리하세요.
상품 사진은 별도 레퍼런스로 들어가므로, 상품명/카테고리/설명/타겟에 있는 단서를 최대한 활용하되 확실하지 않은 사실은 단정하지 마세요.

[입력]
상품명: ${data.name || '미입력'}
카테고리: ${data.category || '미입력'}
상품 설명: ${data.description || '없음'}
타겟 고객: ${data.target || '없음'}
상품 구성: ${data.combinationType || 'single'}

[출력 JSON]
{
  "coreFeatures": ["핵심특징1", "핵심특징2", "핵심특징3"],
  "productIdentity": "제품 정체성/종류/보존해야 할 외형 요약",
  "visualMustKeep": ["색상/프린팅/로고/핏 등 보존 요소"],
  "targetMood": "타겟에게 맞는 무드",
  "heroDirection": "첫 Hook 모델컷 방향",
  "inferredGender": "male | female | unisex | none",
  "inferredGenderReason": "상품명/제품 형태/타겟 기준 성별 추론 이유"
}

[성별 추론 규칙]
- 상품명/카테고리/설명/타겟에 남성, 남자, 남성복, 남자옷, 맨즈, men, mens, male 단서가 명확하면 inferredGender="male".
- 여성, 여자, 여성복, 여자옷, 우먼, women, womens, female 단서가 명확하면 inferredGender="female".
- 남녀공용, 유니섹스, 커플, 공용, unisex 단서가 있으면 inferredGender="unisex".
- 단서가 충돌하거나 불명확하면 inferredGender="none"으로 두고 단정하지 마세요.
      `.trim(), 'detail-brief', 'json');
    const cleanJson = text.replace(/```json|```/g, '').trim();
    const parsed = cleanJson ? JSON.parse(cleanJson) : null;
    return normalizeProductBrief(parsed, data);
  } catch (error) {
    console.warn('Product brief fallback:', error);
    return normalizeProductBrief(null, data);
  }
};

const buildFallbackVisualPrompt = (
  productName: string,
  role: string,
  shotType: DetailPlanImage['shotType'],
  textPosition: DetailPlanImage['textPosition'],
  index: number
): string => {
  const angleGuide: Record<NonNullable<DetailPlanImage['shotType']>, string> = {
    model: 'one fictional Korean model naturally wearing or using the exact reference product, full advertising hero composition, editorial set design, layered background, premium lighting',
    product: 'product-only hero scene with no person, designer-made premium set, dimensional colored or textured background, subtle pedestal/platform, layered shadows, category-relevant props, not a plain white catalog cutout',
    detail: 'extreme close-up product detail scene with no person, textured surface, angled light, shallow depth of field, showing seams, cut, finish, logo, print, hardware, and construction',
    texture: 'macro texture and print/graphic story with no person, fabric folds, tactile material grain, directional side light, premium shadow, close crop, and designed negative space',
    lifestyle: 'natural lifestyle usage scene with the product in context, styled props, realistic environment depth; a hand or partial body may appear only if needed, no full fashion model pose',
    package: 'product package, components, material, finishing, or trust-building detail scene with no person, arranged composition, pedestal, soft reflections, background depth',
    cta: 'product-only closing scene with no person, premium pedestal, atmospheric depth, confident product scale, refined props, decisive purchase-confidence lighting',
  };

  return [
    `A high-quality professional Korean e-commerce detail-page image of ${productName || 'the product'}, ${angleGuide[shotType || 'product']}.`,
    'Photorealistic commercial product photography, premium ecommerce detail page, natural lighting, ultra realistic texture, realistic shadows, Korean smartstore style.',
    'This must look like a real Korean detail-page designer created the section: layered composition, background texture/color, product scale hierarchy, premium lighting, tasteful props, and designed negative space. Avoid plain white background, isolated catalog product cutout, and centered marketplace listing photo.',
    'Use the uploaded reference product as the source of truth. Preserve exact product color, silhouette, print, graphic, logo, pattern, texture, trim, and visible details. Do not redesign, recolor, remove prints, or make a blank/plain substitute.',
    `Reserve clean negative space in the ${textPosition} area for Korean typography overlay. Keep product details and model face away from that copy-safe zone.`,
  ].join(' ');
};

const createFallbackDetailPlan = (data: any, reason = 'GPT 기획안 생성 실패'): DetailPlan => {
  const count = getDetailPlanCount(data.length);
  const productName = String(data.name || '상품').trim() || '상품';
  const combinationType = data.combinationType && data.combinationType !== 'single'
    ? String(data.combinationType)
    : '';
  const combinationCount = getCombinationCount(combinationType);
  const combinationLabel = getCombinationLabel(combinationType);
  const bundleVisualGuide = combinationCount >= 2
    ? ` This is a ${combinationCount}-item bundle. Show exactly ${combinationCount} product items together in the same scene, preserving each uploaded reference product's exact color, print, logo, pattern, silhouette, and details. If this is a 3-item bundle, show 3 product items. If 4-item, show 4 product items. The composition must clearly communicate a ${combinationCount}-item set, not a single product. For apparel Hook images, use exactly ${combinationCount} parallel models, each model wearing one different reference product. Do not show one worn product while the other products are only held, folded, draped, hidden, or cropped.`
    : '';
  const tone = inferDetailTone(data.designTone);
  const productBrief = data.productBrief ? normalizeProductBrief(data.productBrief, data) : null;
  const featurePoints = productBrief?.coreFeatures?.length
    ? productBrief.coreFeatures.slice(0, 3)
    : ['핵심 장점', '편한 사용', '꼼꼼한 마감'];
  const featureVisualPrompt = [
    buildFallbackVisualPrompt(productName, '상품 특장점', 'product', 'top', 3),
    bundleVisualGuide,
    `Create a clear benefit-focused product feature section showing the product's main advantages: ${featurePoints.join(', ')}.`,
    'Use visual callout-style composition with product detail, texture, function, and premium props, but do not include text in the image.',
  ].join(' ');
  const flow = [
    { role: 'Hook', stage: '인지', sectionType: 'offer', shotType: 'model' as const, mainCopy: combinationType ? `${combinationLabel}\n한번에 준비` : `${productName}\n선택할 이유`, subCopy: combinationType ? `${combinationCount}개 구성을 한눈에 확인하세요` : '첫눈에 느껴지는 차이를 확인하세요', trigger: '감정적 보상', textPosition: 'bottom' as const },
    { role: '문제 공감', stage: '공감', sectionType: 'problem', shotType: 'lifestyle' as const, mainCopy: '매번 고민되던\n그 순간', subCopy: '불편함을 먼저 이해한 제품입니다', trigger: '손실회피', textPosition: 'top' as const },
    { role: '해결책', stage: '해결책', sectionType: 'solution', shotType: 'product' as const, mainCopy: '이제 더 쉽게\n바꿔보세요', subCopy: '일상 속 사용성을 중심으로 설계했습니다', trigger: '편의성', textPosition: 'bottom' as const },
    { role: '상품 특장점', stage: '근거', sectionType: 'proof', shotType: 'product' as const, mainCopy: '한눈에보이는\n핵심특장점', subCopy: '이 상품의 장점을 명확하게 보여드립니다', trigger: '비교우위', textPosition: 'top' as const, visualPrompt: featureVisualPrompt },
    { role: '소재/프린팅', stage: '상세 정보', sectionType: 'detail', shotType: 'texture' as const, mainCopy: '작은 차이가\n만족을 만듭니다', subCopy: '매일 쓰는 제품일수록 디테일이 중요합니다', trigger: '권위', textPosition: 'bottom' as const },
    { role: '활용 장면', stage: '신뢰', sectionType: 'lifestyle', shotType: 'model' as const, mainCopy: '일상에 자연스럽게\n스며듭니다', subCopy: '사용하는 순간을 더 편하게 만듭니다', trigger: '감정적 보상', textPosition: 'middle' as const },
    { role: '신뢰 강화', stage: '확신', sectionType: 'trust', shotType: 'package' as const, mainCopy: '구매 전 마지막\n확인까지', subCopy: '품질과 활용성을 차분히 보여드립니다', trigger: '사회적 증거', textPosition: 'top' as const },
    { role: 'CTA', stage: '구매 확신', sectionType: 'cta', shotType: 'cta' as const, mainCopy: '오늘부터 바로\n경험해보세요', subCopy: '망설임 없이 선택할 수 있도록 준비했습니다', trigger: '희소성', textPosition: 'bottom' as const },
  ];

  const images = Array.from({ length: count }, (_, index) => {
    const base = flow[Math.min(index, flow.length - 1)];
    const role = index === count - 1 ? 'CTA' : base.role;
    const sectionType = index === count - 1 ? 'cta' : base.sectionType;
    const stage = index === count - 1 ? '구매 확신' : base.stage;
    const textPosition = index === count - 1 ? 'bottom' : base.textPosition;
    return {
      number: index + 1,
      role,
      stage,
      sectionType,
      shotType: index === count - 1 ? 'cta' : base.shotType,
      mainCopy: base.mainCopy,
      subCopy: base.subCopy,
      points: base.role === '상품 특장점' ? featurePoints : ['핵심 장점', '편한 사용', '꼼꼼한 마감'],
      trustElement: index >= count - 2 ? '품질과 사용성 중심의 신뢰 요소' : '제품 장점 기반 설득 요소',
      trigger: base.trigger,
      textPosition,
      visualPrompt: [
        (base as any).visualPrompt || buildFallbackVisualPrompt(productName, role, index === count - 1 ? 'cta' : base.shotType, textPosition, index),
        combinationType && (index === 0 || base.role === '상품 특장점' || base.role === '활용 장면' || index === count - 1)
          ? bundleVisualGuide
          : '',
      ].filter(Boolean).join(' '),
    };
  });

  return {
    isFallback: true,
    fallbackReason: reason,
    productDefinition: `${productName}의 핵심 장점과 사용 장면을 중심으로 구성한 fallback 상세페이지 기획안입니다.`,
    customer: {
      target: String(data.target || '상품에 관심 있는 잠재 고객'),
      surfaceNeed: '제품의 장점과 사용성을 빠르게 확인하고 싶음',
      realNeed: '실패 없는 선택이라는 확신을 얻고 싶음',
    },
    differentiators: ['제품 중심 비주얼 구성', '구매 흐름에 맞춘 카피', '디테일과 활용 장면 분리'],
    purchaseResistances: ['내게 맞을까', '품질이 괜찮을까', '오래 쓸 수 있을까', '사진과 다르지 않을까', '구매 후 후회하지 않을까'],
    designSystem: {
      tone,
      colors: { primary: '#111827', secondary: '#f8fafc', accent: '#2563eb', background: '#ffffff', text: '#111827' },
    },
    images,
  };
};

const pickDetailPlanObject = (parsed: any): any => {
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.images)) return parsed;
  const directPlan = Object.values(parsed).find((value: any) => value && typeof value === 'object' && Array.isArray(value.images));
  if (directPlan) return directPlan;
  const firstArray = Object.values(parsed).find((value) => Array.isArray(value));
  if (firstArray) return { ...parsed, images: firstArray };
  return null;
};

const normalizeDetailPlan = (parsed: any, data: any): DetailPlan | null => {
  const plan = pickDetailPlanObject(parsed);
  if (!plan || !Array.isArray(plan.images) || plan.images.length === 0) return null;

  const targetCount = getDetailPlanCount(data.length);
  const fallback = createFallbackDetailPlan(data, 'GPT 응답 일부 보완');
  const validPositions = ['top', 'middle', 'bottom'];
  const sourceImages = plan.images.slice(0, targetCount);
  while (sourceImages.length < targetCount) {
    sourceImages.push(fallback.images[sourceImages.length]);
  }

  const images = sourceImages.map((img: any, idx: number) => {
    const fallbackImage = fallback.images[idx];
    const normalizeMainCopy = (value: any) => {
      const lines: string[] = [];
      String(value || fallbackImage.mainCopy)
        .normalize('NFC')
        .replace(/\r/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .trim()
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .forEach(line => {
          const chars = Array.from(line);
          for (let i = 0; i < chars.length; i += 14) {
            const chunk = chars.slice(i, i + 14).join('').trim();
            if (chunk) lines.push(chunk);
          }
        });
      return lines.join('\n');
    };
    return {
      number: Number(img?.number) || idx + 1,
      role: String(img?.role || (idx === 0 ? 'Hook' : idx === targetCount - 1 ? 'CTA' : fallbackImage.role)),
      stage: String(img?.stage || fallbackImage.stage),
      sectionType: String(img?.sectionType || fallbackImage.sectionType),
      shotType: ['model', 'product', 'detail', 'texture', 'lifestyle', 'package', 'cta'].includes(img?.shotType) ? img.shotType : fallbackImage.shotType,
      mainCopy: normalizeMainCopy(img?.mainCopy || img?.copy || fallbackImage.mainCopy),
      subCopy: String(img?.subCopy || fallbackImage.subCopy).slice(0, 26),
      points: Array.isArray(img?.points) && img.points.length > 0 ? img.points.slice(0, 3).map((p: any) => String(p).slice(0, 16)) : fallbackImage.points,
      trustElement: String(img?.trustElement || fallbackImage.trustElement),
      trigger: String(img?.trigger || fallbackImage.trigger),
      textPosition: validPositions.includes(img?.textPosition) ? img.textPosition : fallbackImage.textPosition,
      visualPrompt: String(img?.visualPrompt || fallbackImage.visualPrompt),
    };
  });

  images[0] = { ...images[0], role: images[0].role || 'Hook', sectionType: images[0].sectionType || 'offer' };
  images[images.length - 1] = { ...images[images.length - 1], role: 'CTA', sectionType: 'cta', textPosition: images[images.length - 1].textPosition || 'bottom' };
  const hasFeatureSection = images.some((img) => {
    const source = `${img.role} ${img.stage} ${img.sectionType} ${img.mainCopy} ${img.subCopy}`.toLowerCase();
    return /특장점|핵심\s*장점|셀링|benefit|feature|advantage|usp|차별점/.test(source);
  });
  if (!hasFeatureSection && images.length >= 4) {
    const productBrief = data.productBrief ? normalizeProductBrief(data.productBrief, data) : null;
    const featurePoints = productBrief?.coreFeatures?.length
      ? productBrief.coreFeatures.slice(0, 3)
      : fallback.images[3].points;
    images[3] = {
      ...images[3],
      role: '상품 특장점',
      stage: '근거',
      sectionType: 'proof',
      shotType: 'product',
      mainCopy: '한눈에보이는\n핵심특장점',
      subCopy: '이 상품의 장점을 명확하게 보여드립니다',
      points: featurePoints,
      trigger: '비교우위',
      textPosition: 'top',
      visualPrompt: [
        images[3].visualPrompt || fallback.images[3].visualPrompt,
        `This section must clearly visualize the product's key selling features and benefits: ${featurePoints.join(', ')}.`,
        'Use product-focused composition with detail callouts, texture, function, premium props, and clear negative space for overlay copy. No text inside the generated image.',
      ].join(' '),
    };
  }

  return {
    productDefinition: String(plan.productDefinition || fallback.productDefinition),
    customer: {
      target: String(plan.customer?.target || fallback.customer.target),
      surfaceNeed: String(plan.customer?.surfaceNeed || fallback.customer.surfaceNeed),
      realNeed: String(plan.customer?.realNeed || fallback.customer.realNeed),
    },
    differentiators: Array.isArray(plan.differentiators) && plan.differentiators.length > 0 ? plan.differentiators.map(String) : fallback.differentiators,
    purchaseResistances: Array.isArray(plan.purchaseResistances) && plan.purchaseResistances.length > 0 ? plan.purchaseResistances.map(String) : fallback.purchaseResistances,
    designSystem: {
      tone: String(plan.designSystem?.tone || fallback.designSystem.tone),
      colors: {
        primary: String(plan.designSystem?.colors?.primary || fallback.designSystem.colors.primary),
        secondary: String(plan.designSystem?.colors?.secondary || fallback.designSystem.colors.secondary),
        accent: String(plan.designSystem?.colors?.accent || fallback.designSystem.colors.accent),
        background: String(plan.designSystem?.colors?.background || fallback.designSystem.colors.background),
        text: String(plan.designSystem?.colors?.text || fallback.designSystem.colors.text),
      },
    },
    images,
  };
};

export const generateDetailPlan = async (data: any): Promise<DetailPlan | null> => {
  try {
    await trackUsage();
    const count = String(getDetailPlanCount(data.length));
    const combinationType = data.combinationType && data.combinationType !== 'single'
      ? String(data.combinationType)
      : '';
    const combinationCount = getCombinationCount(combinationType);
    const combinationLabel = getCombinationLabel(combinationType);
    const combinationGuide = combinationType
      ? `이 상품은 ${combinationLabel} 상품(총 ${combinationCount}개 구성)입니다. 1번 Hook 이미지에서 정확히 ${combinationCount}개 구성을 반드시 함께 보여주세요. 3개 조합이면 3개 제품, 4개 조합이면 4개 제품처럼 선택 개수와 이미지 속 제품 개수가 일치해야 합니다. 업로드 레퍼런스가 여러 장이면 각 이미지를 서로 다른 구성품으로 보고, Hook에서는 업로드된 구성품과 필요한 추가 구성 수량이 모두 한 장면에 명확히 보여야 합니다. Hook에서는 구성품의 모습이 서로 유사한 라인업처럼 보여야 합니다. 같은 카메라 각도, 같은 크기감, 같은 조명, 같은 배경, 비슷한 모델 포즈/착용 방식으로 맞추고, 색상/프린팅/로고 차이만 레퍼런스대로 보존하세요. 의류 Hook에서는 제품 수와 같은 수의 모델을 배치하고 각 모델이 서로 다른 제품을 하나씩 착용하게 기획하세요. 3종이면 모델 3명, 4종이면 모델 4명이 기본입니다. 한 모델이 한 벌만 입고 나머지를 손에 들거나 걸치는 구도는 피하세요. 중간 섹션 중 최소 2장은 ${combinationCount}개 구성품이 함께 나오는 컷으로 기획하고, 상품 특장점/활용 장면/CTA 중 하나 이상도 ${combinationCount}개 제품 세트 구성을 보여주세요. 묶음 구성의 실용성/여유분/함께 쓰는 가치/선물 가치를 자연스럽게 반영하되 검증되지 않은 가격·할인율은 만들지 마세요.`
      : '일반 단품 상세페이지로 작성하세요.';
    const bundleRules = combinationType
      ? `- 2개 이상 조합상품일 때 1번 Hook visualPrompt는 정확히 ${combinationCount}개 구성품이 함께 보이는 모델컷이어야 합니다. 3개 조합이면 3개 제품이 보여야 하고, 4개 조합이면 4개 제품이 보여야 합니다.
- 2개 이상 조합상품에서 레퍼런스 제품들의 색상/프린팅/로고가 다르면 모든 차이를 보존해 함께 보여주세요.
- 2개 이상 조합상품 Hook에서는 제품들이 같은 라인업/세트처럼 유사하게 보여야 합니다. 제품들의 포즈, 카메라 각도, 크기, 배경, 조명, 스타일링을 최대한 맞추고, 레퍼런스의 색상/프린팅/로고 차이만 정확히 유지하세요.
- 의류 Hook에서는 제품 수와 같은 수의 parallel Korean models를 visualPrompt에 명시하세요. 2종이면 모델 2명, 3종이면 모델 3명, 4종이면 모델 4명이 각각 다른 레퍼런스 제품을 하나씩 착용해야 합니다.
- 한 모델이 한 제품만 착용하고 나머지를 손에 걸치거나 접힌 상태로 들고 있는 구도는 금지합니다. 각 의류의 정면 형태, 색상, 프린팅/로고/패턴이 선명하게 보여야 합니다.
- 2개 이상 조합상품일 때 상품 특장점/활용 장면/CTA 중 최소 2개 섹션은 ${combinationCount}개 구성품이 같이 나오는 세트 구성 컷으로 작성하세요.`
      : '';
    const toneGuide = data.designTone && data.designTone !== 'auto'
      ? `브랜드 톤은 "${data.designTone}"으로 고정하고 모든 카피·비주얼·컬러를 이 톤에 일관되게 맞추세요.`
      : '브랜드 톤은 상품에 가장 적합한 것을 1개 자동 선택하세요.';
    const productBrief = data.productBrief ? normalizeProductBrief(data.productBrief, data) : null;
    const productBriefGuide = productBrief
      ? `
[핵심특징 브리프 - 반드시 기획에 반영]
- 핵심 특징: ${productBrief.coreFeatures.join(' / ')}
- 제품 정체성: ${productBrief.productIdentity}
- 시각 보존 요소: ${productBrief.visualMustKeep.join(' / ')}
- 타겟 무드: ${productBrief.targetMood}
- Hook 방향: ${productBrief.heroDirection}
`
      : '';
    const text = await generateText(`
당신은 대한민국 상위 1% 이커머스 상세페이지 전략가입니다.
목표는 방문자를 구매자로 전환시키는 판매용 상세페이지 기획 JSON을 빠르고 정확하게 만드는 것입니다.
정보가 부족하면 상품명, 카테고리, 상품 설명, 시장 관행으로 핵심 USP를 빠르게 추론하고, 절대 되묻지 마세요.

[입력값]
상품명: ${data.name || '미입력'}
카테고리: ${data.category || '미입력 (추정)'}
상품 설명: ${data.description || '없음'}
타겟 고객: ${data.target || '없음'}
상품 구성: ${combinationType ? `${combinationLabel} 상품` : '일반 상품'}
${combinationGuide}
${toneGuide}
${productBriefGuide}

[작성 규칙]
- 상품 분석: 제품 정의, 고객의 표면 니즈/숨은 니즈, 차별점 3개 이상, 구매 저항 5개 이상.
- 전환 흐름: Hook → 문제 공감/확대 → 해결책 → 셀링포인트 → 신뢰 → 상세 정보 → CTA.
- 이미지 기획은 정확히 ${count}장. 1번은 Hook, 마지막은 CTA.
- 1번 Hook은 반드시 shotType=model 입니다. 제품을 착용/사용한 강한 모델컷으로, 제품이 크게 보이고 첫인상이 강해야 합니다.
- 1번 Hook의 visualPrompt에는 productBrief.heroDirection과 핵심특징 중 가장 강한 USP를 반영하세요.
${bundleRules}
- 문제 공감/문제 확대 섹션은 현재 판매 제품을 보여주지 말고, 고객이 기존에 겪던 불편한 상황이나 일반적인 기존/타사/낡은 대안 제품을 보여주세요. 이 섹션은 "기존에는 이랬지만, 이제 이 제품이 더 좋다"는 대비를 만들기 위한 before 컷입니다.
- 전체 이미지 중 최소 1장은 반드시 role="상품 특장점" 또는 "핵심 특장점"으로 작성하세요. 이 장은 productBrief.coreFeatures 또는 추론한 핵심 장점을 한눈에 보여주는 benefit/feature 섹션이어야 합니다.
- 상품 특장점 장은 제품의 장점, 기능, 소재, 사용성, 차별점을 시각적으로 비교/강조하는 구성으로 만들고, points에는 핵심 특장점 3개를 넣으세요.
- 중간 이미지는 기능/감성/비교/사용 장면/디테일 등 서로 다른 각도로 구성하고 표현 중복을 피하세요.
- shotType은 model, product, detail, texture, lifestyle, package, cta 중 하나를 반드시 지정하세요.
- 기본 8장 기준 모델컷은 최대 2~3장만 사용하고, 나머지는 제품 단독컷/디테일 클로즈업/소재·프린팅 클로즈업/패키지·구성품/CTA 제품컷으로 섞으세요.
- 사실 확인 불가 문구 금지: "판매 1위", "만족도 99%", "누적 100만개", "효과 보장" 등. 안전한 표현으로 대체하세요.

[카피 규칙]
- 광고 문구가 아니라 '고객의 머릿속 생각을 대신 말하는' 방식, 존댓말
- mainCopy는 1~2줄, 한 줄 14자 이내(\n 줄바꿈). subCopy는 1줄 24자 이내. 불필요한 미사여구·어려운 한자어 지양
- points는 3개, 각 항목 12자 이내의 짧은 명사구
- 각 이미지마다 전환 트리거(손실회피/사회적 증거/권위/희소성/편의성/감정적 보상/비교우위) 중 하나 이상 적용

[visualPrompt 규칙(영어)]
- 제품이 돋보이는 사실적 촬영 장면을 shotType에 맞게 구체적으로 묘사하세요.
- 모든 visualPrompt를 모델컷으로 시작하지 마세요. 모델컷은 shotType=model 또는 일부 lifestyle에만 허용합니다.
- shotType=product/detail/texture/package/cta인 경우 반드시 "no model, no person, product only"를 포함하세요.
- shotType=detail은 제품 디테일 클로즈업, shotType=texture는 소재/프린팅/로고/패턴 클로즈업, shotType=package는 패키지/구성품/마감 신뢰 컷, shotType=cta는 제품 중심 마무리 컷입니다.
- shotType=model인 경우에만 fictional Korean model wearing/using the product를 사용하세요.
- product only는 흰 배경 카탈로그컷이 아닙니다. 사람은 없되, 상세페이지 디자이너가 만든 것처럼 배경 질감/컬러, 플랫폼/받침, 조명 그림자, 카테고리 관련 소품, 깊이감, 프리미엄 연출을 포함하세요.
- 모든 섹션은 “제품 사진 한 장”이 아니라 “상세페이지용 한 섹션 비주얼”처럼 보여야 합니다. 단순 흰 배경, 누끼컷, 마켓 상품 등록용 중앙 정렬 컷, 텅 빈 스튜디오 배경을 피하세요.
- 의류 product/detail/texture/cta 컷은 제품을 행거/마네킹처럼 보이게 하지 말고, 접힘, 소재 질감, 프린팅 클로즈업, 프리미엄 받침대, 배경 패브릭/종이/스튜디오 세트 등으로 디자인된 장면을 만드세요.
- photorealistic, commercial product photography, premium ecommerce detail page, natural lighting, ultra realistic texture, realistic shadows, Korean smartstore style를 녹일 것
- 텍스트가 올라갈 영역(상/중/하)에는 깨끗한 여백이 생기도록 구도를 설계
- 행거컷/마네킹/저품질 플랫레이는 피하되, product/detail/texture/package/cta 섹션에서는 사람 없이 제품만 고급스럽게 연출하세요.
- 레퍼런스 인물이 있는 경우 모델컷에서만 새 가상 인물로 교체하고, 제품 단독 섹션에는 사람을 넣지 마세요.
- 업로드된 레퍼런스 제품을 원본으로 유지하세요. 제품 종류, 실루엣, 핏, 소재, 색상, 프린팅, 그래픽, 로고, 패턴, 자수, 절개선, 부자재를 바꾸지 마세요.
- 프린팅/그래픽/로고/패턴 제품은 visualPrompt에 반드시 "preserve exact print/graphic/logo/pattern placement, scale, and colors from the reference product; do not remove, simplify, recolor, or replace it"를 포함하세요.
- 무지/솔리드 제품은 visualPrompt에 반드시 "keep the product plain and solid-color; do not add new graphics, lettering, logos, or patterns"를 포함하세요.
- 입력 상품명/설명에 블랙, 검정, black, charcoal 등 색상 단서가 있으면 visualPrompt에 반드시 "black product, preserve exact black color, do not recolor to white or bright colors"를 포함하세요.
- 입력 상품명/설명에 화이트, 흰색, white 등 색상 단서가 있으면 visualPrompt에 반드시 "white product, preserve exact white color, do not recolor to black, beige, gray, ivory, pastel, or silver"를 포함하세요.
- 상품명/카테고리/설명/타겟에 남성, 남자, 남성복, 남자옷, men, mens, male 단서가 있으면 visualPrompt에는 "fictional Korean male model only, no female model"을 넣고 여성 모델을 절대 지시하지 마세요.
- 상품명/카테고리/설명/타겟에 여성, 여자, 여성복, 여자옷, women, womens, female 단서가 있으면 visualPrompt에는 "fictional Korean female model only, no male model"을 넣고 남성 모델을 절대 지시하지 마세요.
- 어떤 경우에도 레퍼런스 제품 색상을 임의로 다른 색으로 변경하라는 지시를 만들지 마세요.

[출력 형식] 반드시 아래처럼 최상위가 JSON 객체이고, images 키가 있는 객체 하나만 반환하세요. 배열만 반환하지 마세요. 다른 텍스트 금지:
{
  "productDefinition": "제품 정의 요약",
  "customer": { "target": "핵심 타겟 묘사", "surfaceNeed": "표면 니즈", "realNeed": "실제 숨은 니즈" },
  "differentiators": ["차별점1", "차별점2", "차별점3"],
  "purchaseResistances": ["저항1", "저항2", "저항3", "저항4", "저항5"],
  "designSystem": { "tone": "프리미엄/미니멀/감성 등 1개", "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex", "text": "#hex" } },
  "images": [
    { "number": 1, "role": "Hook", "stage": "인지", "sectionType": "offer", "shotType": "model", "mainCopy": "메인카피\\n둘째줄", "subCopy": "서브카피", "points": ["보조1","보조2","보조3"], "trustElement": "신뢰 요소", "trigger": "감정적 보상", "textPosition": "bottom", "visualPrompt": "A premium Hook model cut with one fictional Korean model wearing or using the exact reference product, strong first impression, product large and clearly visible, designer-made detail-page hero scene ..." }
  ]
}
images 배열은 정확히 ${count}개여야 하며 1번은 Hook, 마지막은 CTA여야 합니다.
      `.trim(), 'detail-plan', 'json');
    const cleanJson = text.replace(/```json|```/g, "").trim();
    console.info('[detail-plan] raw GPT response preview:', cleanJson.slice(0, 800));
    if (!cleanJson) return createFallbackDetailPlan(data, 'GPT 응답이 비어 있어 기본 기획안으로 대체했습니다.');
    const parsed = JSON.parse(cleanJson);
    const normalized = normalizeDetailPlan(parsed, data) || createFallbackDetailPlan(data, 'GPT 응답 형식이 맞지 않아 기본 기획안으로 대체했습니다.');
    normalized.images[0] = { ...normalized.images[0], role: 'Hook', sectionType: 'offer', shotType: 'model' };
    return normalized;
  } catch (error) {
    console.error("Detail plan error:", error);
    return createFallbackDetailPlan(data, error instanceof Error ? error.message : '기획안 생성 중 오류가 발생해 기본 기획안으로 대체했습니다.');
  }
};

// 이미지 생성은 서버리스 엔드포인트(/api/generate-image)를 통해 호출합니다.
let imageErrorAlerted = false;

// ── 이미지 생성 자동 페이싱 ──
// 고정 12.5초 대기 대신 빠르게 시작하고, 429가 발생하면 자동으로 늦춘다.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ImagePacingMode = 'auto';

export interface GeneratedImageResult {
  image: string;
  provider?: 'openai' | 'gemini';
  model?: string;
}

const MIN_AUTO_IMAGE_INTERVAL_MS = 250;
const DEFAULT_AUTO_IMAGE_INTERVAL_MS = 800;
const MAX_AUTO_IMAGE_INTERVAL_MS = 12500;
const GEMINI_IMAGE_INTERVAL_MS = 250;

let nextImageSlotAt = 0;
let adaptiveImageIntervalMs = DEFAULT_AUTO_IMAGE_INTERVAL_MS;

const paceImageRequest = async (priority = 5): Promise<void> => {
  const now = Date.now();
  const priorityDelay = Math.max(0, 10 - priority) * 120;
  const startAt = Math.max(now + priorityDelay, nextImageSlotAt);
  nextImageSlotAt = startAt + adaptiveImageIntervalMs;
  const wait = startAt - now;
  if (wait > 0) await sleep(wait);
};

const recordImageSuccess = (provider?: string): void => {
  if (provider === 'gemini') {
    adaptiveImageIntervalMs = GEMINI_IMAGE_INTERVAL_MS;
    return;
  }
  adaptiveImageIntervalMs = Math.max(
    MIN_AUTO_IMAGE_INTERVAL_MS,
    Math.floor(adaptiveImageIntervalMs * 0.82)
  );
};

const recordImageRateLimit = (retryAfterSec: number): void => {
  const hintedMs = Math.max(3000, Math.min(60000, retryAfterSec * 1000));
  adaptiveImageIntervalMs = Math.min(
    MAX_AUTO_IMAGE_INTERVAL_MS,
    Math.max(adaptiveImageIntervalMs * 1.65, hintedMs / 2)
  );
  nextImageSlotAt = Date.now() + hintedMs;
};

export const generateImage = async (
  prompt: string,
  base64Images: string[] = [],
  aspectRatio: string = "9:16",
  quality?: 'low' | 'medium' | 'high',
  options?: {
    inputFidelity?: 'high' | 'low';
    variantCount?: number;
    referenceRoles?: string[];
    pacingMode?: ImagePacingMode;
    priority?: number;
  }
): Promise<GeneratedImageResult | undefined> => {
  try {
    await trackUsage();

    const token = getToken();
    if (!token) throw new Error('로그인이 필요합니다.');

    const feature = aspectRatio === '1:1' ? 'thumbnail-image' : 'detail-image';
    const body = JSON.stringify({
      prompt: `Generate a high-quality product image. ${prompt}. Aspect ratio: ${aspectRatio}.`,
      images: base64Images,
      aspectRatio,
      quality,
      feature,
      inputFidelity: options?.inputFidelity,
      variantCount: options?.variantCount,
      referenceRoles: options?.referenceRoles,
      pacingMode: options?.pacingMode || 'auto',
      priority: options?.priority,
    });

    // 자동 페이싱: 처음에는 빠르게 시도하고, 429가 오면 아래에서 간격을 늘린다.
    await paceImageRequest(options?.priority);

    const MAX_RETRIES = 8;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
      });
      const data = await res.json();

      if (res.ok) {
        recordImageSuccess(data?.provider);
        // 사용량/비용 로깅은 서버리스에서 처리 → 클라이언트 중복 기록 안 함
        return data.image
          ? { image: data.image, provider: data.provider, model: data.model }
          : undefined;
      }

      // 429(분당 한도): 안내된 시간만큼 대기 후 자동 재시도 (조용히 처리)
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const waitSec = Math.min(60, Math.max(3, Number(data?.retryAfter) || 12));
        recordImageRateLimit(waitSec + 1);
        await sleep((waitSec + 1) * 1000);
        continue;
      }

      // 그 외 오류 또는 재시도 소진 → 1회 노출
      const msg = data?.error || '이미지 생성에 실패했습니다.';
      console.error('Image generation failed:', msg);
      if (typeof window !== 'undefined' && !imageErrorAlerted) {
        imageErrorAlerted = true;
        setTimeout(() => { imageErrorAlerted = false; }, 5000);
        alert(`이미지 생성 오류\n\n${msg}`);
      }
      return undefined;
    }
    return undefined;
  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
};
