import React, { useState } from 'react';
import { Copy, Check, HelpCircle, FileText, X, Sparkles, Gift } from 'lucide-react';

const MASTER_PROMPT = `상세페이지 생성 마스터 프롬프트 V2.1
당신은 대한민국 상위 1% 이커머스 광고 디자이너, 퍼포먼스 마케터, CRO(전환율 최적화) 전문가, 브랜드 전략가입니다.
목표는 단순한 상세페이지 제작이 아니라 방문자를 구매자로 전환시키는 판매용 상세페이지를 만드는 것입니다.

입력값
사용자는 아래 중 하나만 제공해도 된다.
상품 URL
상품 이미지
상품명
상품 설명
정보가 부족한 경우 시장 관행과 카테고리 특성을 참고하여 합리적으로 보완한다.

STEP 1. 상품 자동 분석
아래 항목을 자동 생성한다.
1. 제품 정의
어떤 제품인가
왜 존재하는가
어떤 문제를 해결하는가
2. 고객 분석
핵심 타겟
연령
성별
직업
라이프스타일
구매 상황
숨겨진 니즈
겉으로 말하는 니즈와 실제 니즈를 구분하여 작성
예시)
운동기구 구매
표면 니즈→ 운동하고 싶음
실제 니즈→ 살 빼고 싶음→ 건강해 보이고 싶음→ 자기관리 잘하는 사람처럼 보이고 싶음
3. 경쟁상품 대비 차별점
최소 3개 이상
경쟁상품 VS 본 제품 비교표 작성
4. 구매 저항 요소
구매 직전 고객이 걱정하는 요소 최소 5개 도출
예)
효과 있을까?
오래 사용할 수 있을까?
사용이 어려울까?
내게 맞을까?
배송 문제는 없을까?

STEP 2. 전환 전략 설계
고객 심리 흐름에 따라 설계한다.
인지↓공감↓문제 인식↓해결책 발견↓신뢰 형성↓구매 확신↓결제
각 이미지가 어느 단계의 역할을 수행하는지 명확히 정의한다.

STEP 3. 상세페이지 이미지 기획
총 12~15장 구성

이미지 1
Hook
목적
3초 안에 시선 확보
스크롤 정지
구성
제품 메인컷
모델컷
핵심 USP

이미지 2
문제 공감
실제 고객 상황
불편함
감정 공감

이미지 3
문제 확대
방치 시 발생하는 문제
손실 회피 심리 자극

이미지 4
해결책 제시
왜 이 제품이 필요한가
왜 지금 필요한가

이미지 5~9
핵심 셀링포인트
각 이미지별 표현 방식 중복 금지
1장기능 중심
2장감성 중심
3장비교 중심
4장수치 중심
5장사용 장면 중심
각 이미지마다
메인카피
서브카피
보조포인트 3~5개
근거 요소
포함

이미지 10
경쟁상품 비교
표 형태
경쟁상품 VS 본 제품

이미지 11
실사용 후기
상황 기반 리뷰
별점
사용 전/후 변화

이미지 12
신뢰 강화
가능 시 포함
인증
특허
시험성적서
수상
언론 소개
자료가 없는 경우
원재료
제조공정
품질관리
생산환경
등으로 대체

이미지 13
상세 정보
카테고리별 자동 생성
식품·건기식
구성
성분
섭취법
보관법
유통기한
주의사항
의류·패션
사이즈표
소재
핏 가이드
세탁법
제조국
뷰티·화장품
용량
전성분
사용법
피부타입
사용 시 주의
가전·전자
스펙
크기
무게
소비전력
구성품
보증
생활·주방
소재
크기
용량
사용법
관리법
가구·인테리어
사이즈
소재
조립 여부
관리법
배송 정보
기타
제품 구성
핵심 사양
사용 방법
보관 방법
주의사항

이미지 14
FAQ
구매 전 자주 묻는 질문 TOP5

이미지 15
CTA
지금 구매해야 하는 이유
구매 혜택
타이밍 강조
행동 유도

STEP 4. 이미지별 출력 형식
각 이미지마다 아래 형식으로 작성
이미지 번호
목적
추천 높이(px)
메인 카피
서브 카피
보조 포인트
신뢰 요소
디자인 레이아웃
텍스트 배치
이미지 생성 프롬프트

AI 이미지 생성 프롬프트 규칙
반드시 포함
photorealistic
commercial product photography
premium ecommerce detail page
natural lighting
ultra realistic texture
high-end advertising
clean layout
professional typography area
Korean ecommerce style
smartstore optimized
860px width composition
white background
high conversion design
premium visual merchandising
realistic shadows
premium UI elements
information-rich layout
luxury branding

STEP 5. 디자인 시스템 생성
브랜드 톤
가장 적합한 1개 자동 선택
프리미엄
미니멀
럭셔리
감성
건강
테크
친환경
컬러 시스템
Primary
Secondary
Accent
Background
Text
자동 정의
폰트
헤드라인S-Core Dream ExtraBold
본문Pretendard Regular
강조Pretendard SemiBold
CTAPretendard Bold

STEP 6. 신뢰성 검증
사실 확인 불가 문구 사용 금지
금지 예시
❌ 국내 판매 1위
❌ 만족도 99%
❌ 누적 판매 100만개
❌ 효과 보장
대체 예시
✅ 많은 고객이 선택한 이유
✅ 재구매 후기가 이어지는 이유
✅ 꾸준히 사랑받는 이유

STEP 7. 최종 출력 규칙
출력은 아래만 제공
상세페이지 기획서
이미지별 카피
이미지별 생성 프롬프트
설명 금지
중복 카피 금지
모든 이미지는 서로 다른 설득 역할 수행
한 이미지 = 하나의 설득 완결

품질 강화 추가 지시문 (필수)
모든 섹션은 쿠팡, 스마트스토어, 자사몰 상위 1% 상세페이지 수준의 정보 밀도와 전환 설득력을 목표로 작성하고, 각 이미지는 단독으로 보더라도 구매 설득이 가능하도록 설계하라.
또한 고객의 구매 심리 단계(관심 → 공감 → 문제 인식 → 해결 → 신뢰 → 확신 → 결제)를 기반으로 구성하고, 각 이미지마다 반드시 하나 이상의 전환 트리거(손실회피, 사회적 증거, 권위, 희소성, 편의성, 감정적 보상, 비교우위)를 적용하라.
모든 카피는 광고 문구가 아닌 실제 고객의 머릿속 생각을 대신 말하는 방식으로 작성하며, 경쟁 상세페이지보다 정보 밀도는 높고 가독성은 더 뛰어나게 설계하라.
상세페이지 전체를 읽은 고객이 추가 검색 없이 결제를 결정할 수 있을 정도의 정보 완결성을 제공하라.`;

const STEPS: { num: number; text: string }[] = [
  { num: 1, text: 'GPT(ChatGPT)에 아래 전체 프롬프트를 복사해서 붙여넣고, 분석할 상품 이미지 한 장을 함께 첨부합니다.' },
  { num: 2, text: 'GPT가 자동으로 상품을 분석하고 기획서가 완성되면, 1번~15번까지의 이미지 생성 프롬프트(영어)가 함께 출력됩니다.' },
  { num: 3, text: '각 이미지 프롬프트(영어)를 1번부터 순서대로 하나씩 복사합니다.' },
  { num: 4, text: '1번과 동일한 방식으로 이미지 생성 AI(GPT 이미지, Midjourney 등)에 프롬프트를 붙여넣어 한 장씩 생성합니다.' },
];

export function DetailPromptViewer() {
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MASTER_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = MASTER_PROMPT;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* 헤더 카드 */}
      <div className="bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center">
              <Gift className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold bg-amber-400 text-amber-900 px-2 py-0.5 rounded-full">FREE</span>
                <h1 className="text-2xl font-bold">상세페이지 무료 프롬프트</h1>
              </div>
              <p className="text-blue-100 text-sm mt-1">
                ChatGPT만 있으면 누구나 상위 1% 상세페이지 기획서를 생성할 수 있어요
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-2 bg-white/15 hover:bg-white/25 backdrop-blur px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            사용방법 안내
          </button>
        </div>

        <div className="mt-6 bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20">
          <p className="text-sm leading-relaxed">
            <Sparkles className="inline w-4 h-4 mr-1 text-amber-300" />
            아래 <span className="font-bold text-amber-300">전체 프롬프트를 복사</span>한 뒤
            ChatGPT(GPT-4 또는 GPT-5 권장)에 붙여넣고, <span className="font-bold text-amber-300">상품 이미지 1장과 함께</span> 입력하세요.
            상세페이지 기획서와 이미지 생성 프롬프트가 자동으로 완성됩니다.
          </p>
        </div>
      </div>

      {/* 복사 액션 바 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-slate-700">
          <FileText className="w-4 h-4" />
          <span className="text-sm font-semibold">마스터 프롬프트 전문</span>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg transition-all ${
            copied
              ? 'bg-green-600 text-white shadow-green-200'
              : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 hover:scale-[1.02]'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              복사 완료!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              전체 프롬프트 복사하기
            </>
          )}
        </button>
      </div>

      {/* 프롬프트 본문 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <pre className="whitespace-pre-wrap break-words p-6 text-sm text-slate-800 leading-relaxed font-mono max-h-[70vh] overflow-y-auto">
          {MASTER_PROMPT}
        </pre>
      </div>

      <p className="text-xs text-slate-500 text-center mt-4">
        💡 복사한 프롬프트는 ChatGPT 외에 Claude, Gemini 등 다른 AI에도 사용 가능합니다.
      </p>

      {/* 사용방법 안내 팝업 */}
      {showGuide && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5" />
                <h2 className="text-lg font-bold">사용방법 안내</h2>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="text-white/80 hover:text-white transition-colors"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {STEPS.map(({ num, text }) => (
                <div key={num} className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">
                    {num}
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed pt-1">{text}</p>
                </div>
              ))}

              <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs text-amber-900 leading-relaxed">
                  <strong>TIP.</strong> 결과물의 품질을 높이려면 상품 이미지 외에도 상품명, URL, 간단한 설명을 함께 넣어주세요.
                  ChatGPT Plus(GPT-4o 이상)에서 더 풍부한 결과가 나옵니다.
                </p>
              </div>
            </div>

            <div className="px-6 pb-6">
              <button
                onClick={() => setShowGuide(false)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-xl text-sm font-semibold transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
