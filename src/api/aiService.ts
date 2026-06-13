import { GoogleGenAI } from "@google/genai";
import { getToken, trackUsage, logApiCall } from "../lib/auth";

const getApiKey = () => {
  return (
    import.meta.env.VITE_GOOGLE_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    ""
  );
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export const removeBackground = async (image: string) => image;

const DETAIL_CANVAS_WIDTH = 860;
const DETAIL_HEIGHT_PRESETS = [1000, 1200, 1529, 1720] as const;

const normalizeLayoutHeight = (value: any, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return DETAIL_HEIGHT_PRESETS.reduce((best, current) => (
    Math.abs(current - n) < Math.abs(best - n) ? current : best
  ), DETAIL_HEIGHT_PRESETS[0]);
};

const getFallbackLayoutHeight = (item: any, index: number, total: number): number => {
  const text = `${item?.title || ''} ${item?.conversionRole || ''} ${item?.sectionType || ''}`.toLowerCase();
  if (index === 0) return 1529;
  if (index === total - 1) return 1200;
  if (text.includes('lifestyle') || text.includes('활용')) return 1529;
  if (text.includes('detail') || text.includes('디테일') || text.includes('proof') || text.includes('근거')) return 1000;
  if (text.includes('problem') || text.includes('문제')) return 1200;
  return 1200;
};

const MASTER_PROMPT_STRATEGY = `
상세페이지 생성 마스터 기준:
- 당신은 대한민국 상위 1% 이커머스 광고 디자이너, 퍼포먼스 마케터, CRO 전문가, 브랜드 전략가입니다.
- 목표는 예쁜 이미지가 아니라 방문자를 구매자로 전환시키는 판매용 상세페이지입니다.
- 정보가 부족하면 상품명, 카테고리, 이미지 단서, 시장 관행을 바탕으로 합리적으로 보완하되 사실처럼 검증 불가능한 수치나 인증은 만들지 마세요.
- 먼저 제품 정의, 핵심 타겟, 숨겨진 니즈, 경쟁상품 대비 차별점, 구매 저항 요소를 내부적으로 분석한 뒤 이미지별 기획에 반영하세요.
- 고객 심리 흐름은 관심 -> 공감 -> 문제 인식 -> 해결책 발견 -> 신뢰 형성 -> 구매 확신 -> 결제 순서로 설계하세요.
- 각 이미지는 단독으로 보더라도 하나의 설득이 완결되어야 하며, 서로 다른 설득 역할과 전환 트리거를 가져야 합니다.
- 각 이미지마다 최소 하나 이상의 전환 트리거를 적용하세요: 손실회피, 사회적 증거, 권위, 희소성, 편의성, 감정적 보상, 비교우위.
- 광고 문구처럼 외치는 대신 실제 고객의 머릿속 생각을 대신 말하는 카피를 작성하세요.
- 경쟁 상세페이지보다 정보 밀도는 높고 가독성은 더 뛰어나게 설계하세요.
`;

const MASTER_DETAIL_STRUCTURE = `
권장 상세페이지 흐름:
1. Hook / 3초 안에 시선 확보 / 제품 메인컷 또는 모델컷 / 핵심 USP
2. 문제 공감 / 실제 고객 상황 / 불편함과 감정 공감
3. 문제 확대 / 방치 시 손실 / 실패 비용과 후회 방지
4. 해결책 제시 / 왜 이 제품이 필요한지 / 왜 지금 필요한지
5. 핵심 셀링포인트 기능 중심
6. 핵심 셀링포인트 감성 중심
7. 핵심 셀링포인트 비교 중심
8. 핵심 셀링포인트 사용 장면 중심
9. 핵심 셀링포인트 디테일 또는 근거 중심
10. 경쟁상품 비교 / 검증 가능한 범위의 비교우위
11. 사회적 증거 / 실제 후기 데이터가 없으면 허위 리뷰 대신 사용 상황 기반 기대감
12. 신뢰 강화 / 인증 자료가 없으면 원재료, 제조공정, 품질관리, 생산환경, 디테일 근거로 대체
13. 제품 상세 정보는 앱의 별도 템플릿이 처리하므로 AI 이미지 기획에서는 반복하지 않음
14. FAQ는 앱의 별도 정보 섹션과 충돌하지 않게 구매 저항 해소형 메시지로만 반영
15. CTA / 지금 선택해야 하는 이유 / 구매 확신과 행동 유도
`;

const MASTER_IMAGE_PROMPT_KEYWORDS = `
이미지 생성 프롬프트에는 상황에 맞게 다음 품질 키워드를 녹여 쓰세요:
photorealistic, commercial product photography, premium ecommerce detail page, natural lighting, ultra realistic texture, high-end advertising, clean layout, professional typography area, Korean ecommerce style, smartstore optimized, 860px width composition, high conversion design, premium visual merchandising, realistic shadows, premium UI elements, information-rich layout, luxury branding.
`;

const MASTER_TRUST_RULES = `
신뢰성 검증:
- 사실 확인 불가 문구 금지: 국내 판매 1위, 만족도 99%, 누적 판매량, 효과 보장, 인증/특허/시험성적서 허위 표현.
- 대체 표현 사용: 많은 고객이 선택한 이유, 꾸준히 사랑받는 이유, 재구매를 고민하게 만드는 포인트, 구매 전 확인해야 할 차이.
- 실제 가격, 할인율, 리뷰 수, 평점, 배송 보장, 인증 여부처럼 사용자가 제공하지 않은 수치는 만들지 마세요.
`;

export const planDetail = async (data: any) => {
  try {
    await trackUsage();
    const lengthGuide = data.length === 'auto'
      ? '마스터 프롬프트 기준으로 12~15장 사이의 전환형 상세페이지 구성'
      : `정확히 ${data.length}장으로 구성`;
    const combinationType = data.combinationType && data.combinationType !== 'single'
      ? String(data.combinationType)
      : '';
    const combinationCount = Number(data.combinationCount) || (combinationType === '1+1+1' ? 3 : combinationType === '1+1' ? 2 : 1);
    const combinationGuide = combinationType
      ? `
 조합상품 전용 작성 규칙:
 - 이 상품은 ${combinationType} 조합상품이며 총 ${combinationCount}개 구성입니다.
 - 첫 번째 항목은 반드시 "${combinationType} 조합 인트로" 섹션으로 작성하세요.
 - 첫 번째 keyMessage의 첫 줄에는 반드시 "${combinationType} 구성"을 포함하세요.
 - 첫 번째 visualPrompt는 정확히 ${combinationCount}개의 모델컷 또는 모델 착용/사용 장면이 한 세로형 페이지에 함께 보이는 구성을 영어로 작성하세요.
 - 이후 섹션도 단품이 아니라 묶음 구성의 실용성, 여유분, 함께 쓰는 장점, 선물/비축 가치 등을 자연스럽게 반영하세요.
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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
      },
      contents: `
 당신은 한국 이커머스 전문 상세페이지 기획자입니다.
 아래 상품의 상세페이지 기획안을 JSON 배열로 작성해주세요.

 상품명: ${data.name}
 카테고리: ${data.category}
 타겟 고객: ${data.target || '없음'}
 페이지 길이: ${lengthGuide}
 상품 구성: ${combinationType ? `${combinationType} 조합상품 (${combinationCount}개 구성)` : '일반 상품'}
${combinationGuide}
${designGuide}
${conversionGuide}
${MASTER_PROMPT_STRATEGY}
${MASTER_DETAIL_STRUCTURE}
${MASTER_IMAGE_PROMPT_KEYWORDS}
${MASTER_TRUST_RULES}

 반드시 아래 형식의 JSON 배열만 반환하세요. 배열 [ ] 로 시작하고 다른 텍스트는 포함하지 마세요.
 각 항목은 반드시 title, logicalSections, keyMessage, visualPrompt, sectionType, conversionRole, layoutHeight 필드를 포함해야 합니다.
 각 항목의 logicalSections에는 이미지 목적, 전환 트리거, 보조 포인트, 신뢰 요소를 짧게 포함하세요.

 상세페이지 캔버스 규칙:
 - 모든 이미지는 가로 ${DETAIL_CANVAS_WIDTH}px 고정 상세페이지 섹션으로 기획합니다.
 - 각 항목의 layoutHeight는 반드시 ${DETAIL_HEIGHT_PRESETS.join(', ')} 중 하나만 사용하세요.
 - Hook/모델 착용/감성 히어로/라이프스타일 섹션은 1529를 우선 사용하세요.
 - 제품 디테일/근거/짧은 정보 섹션은 1000, 일반 설명 섹션은 1200을 사용하세요.
 - 긴 스토리/비교/사용 장면은 필요할 때만 1720을 사용하세요.
 - 모든 섹션이 같은 높이가 되지 않게, 설득 역할에 맞춰 높이를 다르게 배분하세요.

 중요 규칙 및 절대 금지 사항 (MUST FOLLOW):
 1. 반드시 제품의 시각적 가치(디테일, 소재, 착용샷, 연출샷 등)를 보여주는 '이미지 중심'의 섹션으로만 구성하세요.
 2. **다음 섹션들은 시스템에서 별도로 추가하므로 AI는 절대 생성하면 안 됩니다 (생성 시 오류 처리됨):**
    - '사이즈 가이드', '사이즈 조언', '실측 사이즈' 등 모든 사이즈 관련 섹션
    - '세탁 방법', '관리 방법', '보관 방법', '주의사항' 등 모든 관리 정보 섹션
    - '제품 상세 정보', '상품 기본 정보', '고객 센터' 관련 섹션
 3. 위 금지 항목 대신 다음 내용을 포함하세요:
    - 제품의 핵심 문제를 해결하는 첫인상 메인 섹션
    - 소재의 질감과 마감을 강조하는 클로즈업 섹션 (Extreme close-up)
    - 일상 생활에서의 자연스러운 사용/착용 연출 섹션 (Lifestyle shot)
    - 제품의 신뢰도를 높이는 브랜드 철학이나 품질 강조 섹션
 4. 검증되지 않은 할인율, 판매량, 리뷰 수, 평점, 인증 문구는 절대 만들지 마세요.
 5. 마스터 프롬프트의 이미지 13~14에 해당하는 제품 정보/FAQ는 앱의 별도 템플릿과 충돌하지 않도록, AI가 생성하는 메인 이미지에서는 구매 저항 해소와 신뢰 근거 중심으로만 녹이세요.

 keyMessage 작성 규칙:
 - 고객의 감성을 자극하는 전문 카피라이터 톤앤매너 유지
 - GPT 이미지 생성 결과처럼 짧고 자연스러운 한국어 에디토리얼 카피로 작성
 - 억지 존댓말, 번역투, 과장 광고 문구를 피하고 상황에 맞게 담백한 평서형/서술형을 사용
 - 상품명과 카테고리만 보고 확정할 수 없는 기능, 소재, 수치, 효능은 만들지 말 것
 - "최고의 선택", "지금 바로 경험하세요", "더 이상 고민하지 마세요", "완벽함", "비밀" 같은 상투어는 사용하지 말 것
 - 1~2줄로 작성하되, 한 줄당 18자 이내로 제한 (줄바꿈 \n 사용)
 - 예시: "입는 순간,\n분위기가 달라진다"
 - 각 이미지의 메인 카피는 중복되지 않아야 하며, 한 이미지 안에서 하나의 설득 목적만 선명하게 전달하세요.

 시각적 프롬프트(visualPrompt) 작성 규칙:
 - 영어로 작성하며, AI 이미지 생성기가 이해하기 쉬운 구체적인 묘사 포함
 - "A premium vertical Korean e-commerce editorial image of..."로 시작
 - 섹션 목적에 맞게 모델 착용컷, 자연스러운 사용 장면, 제품 디테일 클로즈업, 정갈한 제품 단독컷을 섞어서 작성
 - 모든 섹션을 같은 반신 모델컷이나 같은 배경으로 만들지 말고 카메라 거리, 포즈, 배경, 연출 소품을 섹션마다 다르게 작성
 - 첫 섹션은 사용자가 제시한 GPT 예시처럼 완성형 세로 상세페이지 메인 비주얼로 작성: 좌측 상단의 굵은 한국어 헤드라인 공간, 그 아래 짧은 설명, 얇은 구분선, 좌측 세로 아이콘 포인트 리스트, 우측 또는 중앙 우측의 큰 모델 착용컷/제품컷, 밝고 고급스러운 실내 또는 스튜디오 배경
 - offer/problem/lifestyle 섹션도 가능하면 매거진형 레이아웃을 활용: 왼쪽에는 카피와 3~4개 짧은 아이콘 라벨, 오른쪽에는 제품을 착용/사용한 실제감 있는 모델 또는 제품 장면
 - 제품 디테일 섹션은 아이콘 리스트보다 소재/프린트/마감/핏이 잘 보이는 클로즈업 위주로 작성
 - 이미지 안에 글자, 배지, 카드, 말풍선, UI 패널, 가격표를 만들라고 지시하지 말 것
 - 단, 헤드라인, 짧은 설명, 얇은 구분선, 작은 원형 라인 아이콘과 짧은 한국어 라벨은 프리미엄 상세페이지 구성요소로 허용
 - 조명, 배경, 각도, 질감, 모델 포즈를 사실적으로 기술
 - 모델 얼굴은 새롭게 생성된 가상의 인물로 표현하고 레퍼런스 인물의 얼굴을 복제하지 말 것
 - 클로즈업 섹션은 제품을 착용/사용한 상태의 자연스러운 부분 확대 컷으로 작성하고, 큰 제품 배경 위에 작은 전신 모델을 붙이는 합성 구도는 절대 지시하지 말 것
 - 미니어처 모델, 스티커처럼 붙인 모델, picture-in-picture, 손에 들린 작은 사람, 거대한 제품 무늬 배경 뒤의 작은 모델 같은 부자연스러운 합성 표현은 visualPrompt에 포함하지 말 것
 - 제품 로고/패턴/프린트는 실제 제품 위에서 현실적인 크기로 보이게 작성하고, 별도 배경 그래픽처럼 확대하지 말 것
 - 이미지마다 메인카피, 서브카피, 보조포인트 3~5개, 신뢰 요소가 디자인에 반영될 수 있도록 전문적인 typography area와 정보 밀도 있는 레이아웃을 지시할 것
 - 첫 섹션 이외에도 기능/감성/비교/사용장면/근거/CTA 섹션이 서로 다른 표현 방식이 되도록 작성할 것

 배열 예시: [ {"title": "분위기를 바꾸는 첫인상", "logicalSections": ["메인", "감성 카피", "아이콘 포인트"], "sectionType": "offer", "conversionRole": "핵심 오퍼", "layoutHeight": 1529, "keyMessage": "입는 순간,\n분위기가 달라진다", "visualPrompt": "A premium vertical Korean e-commerce editorial image of a fictional Korean model wearing the product in a calm bright studio room, full-body or three-quarter composition on the right side, generous clean negative space on the left for a bold Korean headline, smaller supporting Korean copy, a thin divider line, and three minimal circular line-icon feature labels stacked vertically, soft daylight, realistic fabric texture, refined GPT-generated shopping-mall detail page mood, no prices, no badges, no cards."} ]
      `.trim(),
    });
    await logApiCall('detail-plan', 'gemini-2.5-flash', response);

    const text = response.text ?? "";
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
      ? ['조합 핵심 오퍼', '고객 문제/상황', '손실 회피', '해결책 제시', '기능 셀링포인트', '감성 셀링포인트', '비교우위', '사용 장면', '제품 디테일', '구매 근거', '구매 저항 해소', '품질 신뢰', '활용 확신', 'FAQ 해소', 'CTA']
      : ['핵심 오퍼', '고객 문제/상황', '손실 회피', '해결책 제시', '기능 셀링포인트', '감성 셀링포인트', '비교우위', '사용 장면', '제품 디테일', '구매 근거', '구매 저항 해소', '품질 신뢰', '활용 확신', 'FAQ 해소', 'CTA'];
    const fallbackTypes = ['offer', 'problem', 'problem', 'proof', 'proof', 'lifestyle', 'proof', 'lifestyle', 'detail', 'proof', 'trust', 'trust', 'lifestyle', 'trust', 'offer'];
    const fallbackMessages = combinationType
      ? [
          `${combinationType} 구성\n한 번에 준비하세요`,
          '구매 전 고민을\n먼저 줄입니다',
          '놓치기 쉬운 불편함을\n확인하세요',
          '필요한 이유가\n분명해집니다',
          '기능의 차이를\n눈으로 확인하세요',
          '쓸수록 느껴지는\n만족감',
          '비교할수록\n선택은 쉬워집니다',
          '일상 속에서 더 자연스럽게\n활용해보세요',
          '디테일까지 꼼꼼하게\n살펴보세요',
          '구성의 차이를\n눈으로 확인하세요',
          '구매 전 걱정을\n차분히 덜어냅니다',
          '품질 기준을\n확인하세요',
          '함께 쓰면 더 좋은\n구성입니다',
          '구매 전 마지막까지\n안심하고 확인하세요',
          '지금 필요한 구성을\n놓치지 마세요',
        ]
      : [
          `${data.name || '상품'}\n첫인상이 달라진다`,
          '이런 불편함,\n익숙하지 않나요',
          '그냥 넘기면\n계속 반복됩니다',
          '필요한 이유가\n분명해집니다',
          '기능의 차이를\n눈으로 확인하세요',
          '매일 손이 가는\n편안한 만족감',
          '비교할수록\n선택은 쉬워집니다',
          '일상에 자연스럽게\n스며드는 스타일',
          '가까이 볼수록\n선명한 디테일',
          '결이 살아나는\n섬세한 마감',
          '구매 전 걱정을\n차분히 덜어냅니다',
          '품질 기준을\n확인하세요',
          '사용 장면까지\n쉽게 그려집니다',
          '마지막까지\n차분하게 확인하세요',
          '지금 선택해도\n후회 없도록',
        ];
    const normalizeKeyMessage = (value: any, index: number) => {
      const fallback = fallbackMessages[Math.min(index, fallbackMessages.length - 1)];
      const message = String(value || '').trim() || fallback;
      return message.split('\n').map(line => line.slice(0, 18)).join('\n').slice(0, 80);
    };

    const totalItems = arr.length;
    return arr.map((item: any, index: number) => ({
      ...item,
      id: Math.random().toString(36).substring(7),
      title: item.title ?? "섹션",
      logicalSections: Array.isArray(item.logicalSections) ? item.logicalSections : ["기본"],
      sectionType: item.sectionType || fallbackTypes[Math.min(index, fallbackTypes.length - 1)],
      conversionRole: item.conversionRole || fallbackRoles[Math.min(index, fallbackRoles.length - 1)],
      layoutHeight: normalizeLayoutHeight(item.layoutHeight, getFallbackLayoutHeight(item, index, totalItems)),
      // keyMessage 검증 - 각 줄이 25자를 초과하지 않도록 체크
      keyMessage: normalizeKeyMessage(item.keyMessage ?? item.copy ?? item.message, index),
      visualPrompt: item.visualPrompt ?? "",
    }));
  } catch (error) {
    console.error("Plan Error:", error);
    return [];
  }
};

export const generateImage = async (
  prompt: string,
  base64Images: string[] = [],
  aspectRatio: string = "9:16"
) => {
  try {
    await trackUsage();
    const res = await fetch('/api/usage/log-call?mode=generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ prompt, base64Images, aspectRatio }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '이미지 생성에 실패했습니다.');
    return data.imageUrl as string | undefined;
  } catch (error) {
    console.error("Image generation failed:", error);
    return undefined;
  }
};
