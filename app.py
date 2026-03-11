import streamlit as st
import google.generativeai as genai
import json

# --- 1. 보안 설정 (Streamlit Secrets 연동) ---
# 배포 후 Streamlit 설정(Secrets)에서 GEMINI_API_KEY를 입력해야 작동합니다.
if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])
else:
    st.error("🔑 API Key가 설정되지 않았습니다. Streamlit Cloud 설정에서 Secrets를 확인해주세요.")
    st.stop()

# 모델 설정
# 기획(텍스트)은 똑똑한 Pro 모델을, 빠른 처리는 Flash 모델을 사용합니다.
text_model = genai.GenerativeModel('gemini-1.5-pro')

# --- 2. 웹 페이지 레이아웃 및 UI ---
st.set_page_config(page_title="AI 커머스 상세페이지 기획기", layout="centered")

st.title("🚀 AI 상세페이지 & 썸네일 전략가")
st.info("수강생 여러분, 상품 정보를 입력하면 AI가 판매 전략과 카피를 자동으로 생성합니다.")

# 사이드바: 상품 정보 입력창
with st.sidebar:
    st.header("📌 상품 정보 입력")
    product_name = st.text_input("상품명", placeholder="예: 무선 저소음 키보드")
    category = st.text_input("카테고리", placeholder="예: 사무용품 / IT")
    price = st.text_input("가격", placeholder="예: 35,000원")
    
    st.divider()
    page_length = st.select_slider("기획안 단계(길이)", options=[5, 7, 9], value=5)
    target_audience = st.multiselect("주요 타겟", ["20대", "30대", "40대", "50대", "남성", "여성"], default=["30대", "여성"])

# --- 3. 로직 함수 ---
def generate_ai_plan(name, cat, prc, length, target):
    """AI에게 상세페이지 기획안을 요청하는 함수"""
    prompt = f"""
    당신은 한국의 이커머스(스마트스토어, 쿠팡) 상세페이지 기획 전문가입니다.
    다음 상품에 대한 상세페이지 기획안을 작성해주세요.
    
    상품명: {name}
    카테고리: {cat}
    가격: {prc}
    타겟: {target}
    기획 길이: {length}단계 (Hook -> Solution -> Proof -> Detail -> Closing 순서 포함)

    결과는 반드시 다음 키를 가진 JSON 배열 형태로 응답하세요:
    [
      {{
        "title": "섹션 제목(예: 01. 도입부)",
        "keyMessage": "이미지에 들어갈 강렬한 한글 카피",
        "visualPrompt": "이미지 생성을 위한 구체적인 영어 묘사(9:16 비율)"
      }}
    ]
    카피는 반드시 100% 자연스러운 한국어로 작성하세요. JSON 외의 말은 하지 마세요.
    """
    
    response = text_model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"}
    )
    return json.loads(response.text)

# --- 4. 실행 버튼 및 결과 출력 ---
if st.sidebar.button("✨ 기획안 생성하기"):
    if not product_name:
        st.warning("상품명을 입력해주세요!")
    else:
        with st.spinner("AI 전문가가 전략을 구성하고 있습니다..."):
            try:
                # AI 기획안 생성
                plan = generate_ai_plan(product_name, category, price, page_length, target_audience)
                st.session_state['plan_result'] = plan
                st.success("기획안 생성이 완료되었습니다!")
            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")

# 결과 화면 렌더링
if 'plan_result' in st.session_state:
    st.divider()
    st.subheader(f"📦 '{product_name}' 상세페이지 기획서")
    
    for i, section in enumerate(st.session_state['plan_result']):
        with st.expander(f"단계 {i+1}: {section['title']}", expanded=True):
            st.markdown(f"#### **핵심 카피**")
            st.info(section['keyMessage'])
            st.markdown(f"**📸 이미지 가이드(AI 프롬프트):**")
            st.caption(section['visualPrompt'])

    # 수강생들을 위한 안내
    st.success("💡 위 카피와 이미지 가이드를 활용해 상세페이지를 디자인해보세요!")
