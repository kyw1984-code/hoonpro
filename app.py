import streamlit as st
import google.generativeai as genai
from PIL import Image
import io

# --- 1. 보안 및 Gemini 3 Flash 모델 설정 ---
if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])
else:
    st.error("🔑 API Key가 설정되지 않았습니다. Streamlit Secrets 설정을 확인해주세요.")
    st.stop()

# 2026년형 최신 모델인 Gemini 3 Flash를 적용합니다.
# 모델명 형식은 구글 API 업데이트에 따라 'gemini-3-flash' 또는 'gemini-3.0-flash'를 사용합니다.
MODEL_NAME = 'gemini-3.0-flash' 

try:
    model = genai.GenerativeModel(MODEL_NAME)
except Exception:
    # 혹시 모를 하위 호환성을 위해 대체 이름을 준비합니다.
    model = genai.GenerativeModel('gemini-1.5-flash')

# --- 2. UI 레이아웃 설정 ---
st.set_page_config(page_title="Gemini 3.0 이커머스 빌더", layout="wide")

# 세련된 디자인을 위한 CSS
st.markdown("""
    <style>
    .stApp { background-color: #ffffff; }
    .main-box { border: 1px solid #e0e0e0; padding: 20px; border-radius: 15px; background-color: #f9f9f9; }
    .stButton>button { background: linear-gradient(to right, #4facfe 0%, #00f2fe 100%); color: white; border: none; font-weight: bold; }
    </style>
    """, unsafe_allow_html=True)

st.title("⚡ Gemini 3 Flash 이커머스 마스터")
st.write("최신 AI 모델을 활용해 상품 상세페이지와 썸네일 전략을 즉시 생성합니다.")

# 화면 분할
left_col, right_col = st.columns([1, 1], gap="medium")

with left_col:
    st.subheader("📋 상품 정보 및 분석 요청")
    
    with st.container():
        product_name = st.text_input("💎 상품명", placeholder="예: 무선 노이즈 캔슬링 헤드셋")
        category = st.selectbox("📂 카테고리", ["디지털/가전", "의류/잡화", "식품", "홈/인테리어", "반려동물"])
        
        # Streamlit 최신 인터페이스 활용
        concept = st.radio("🎨 썸네일 컨셉", ["깔끔한 제품컷", "감성적인 라이프스타일컷", "전문 모델컷"], horizontal=True)
        
        user_prompt = st.text_area(
            "📝 AI에게 지시할 추가 사항", 
            placeholder="예: 30대 직장인 남성을 타겟으로 시크하고 고급스러운 느낌을 강조해줘.",
            height=120
        )

    # 이미지 업로드 (Gemini 3의 강력한 분석 능력 활용)
    uploaded_images = st.file_uploader("📸 참고 이미지 업로드 (멀티모달 분석)", type=['png', 'jpg', 'jpeg'], accept_multiple_files=True)
    
    if uploaded_images:
        st.write("✅ 업로드된 이미지 미리보기")
        img_cols = st.columns(4)
        for idx, img_file in enumerate(uploaded_images):
            with img_cols[idx % 4]:
                st.image(img_file, use_container_width=True)

    submit_btn = st.button("🚀 Gemini 3 분석 시작")

with right_col:
    st.subheader("💡 AI 전략 리포트")
    
    if submit_btn:
        if not product_name:
            st.error("상품명을 입력해야 분석이 가능합니다.")
        else:
            with st.spinner("Gemini 3 Flash가 이미지를 분석하고 전략을 짜고 있습니다..."):
                # 프롬프트 조합
                content = []
                
                instruction = f"""
                당신은 1타 이커머스 컨설턴트입니다. 상품명 '{product_name}'에 대해 분석하세요.
                
                [수행 과제]
                1. 이 상품의 핵심 타겟과 그들이 열광할 소구점 3가지
                2. '{concept}' 컨셉에 가장 적합한 썸네일 구성 전략
                3. 상세페이지 상단에 들어갈 클릭을 부르는 '후킹 카피' 5개
                4. 업로드된 이미지가 있다면, 그 이미지의 장단점 분석 및 개선안
                
                [추가 요청사항]
                {user_prompt}
                
                반드시 신뢰감 있고 전문적인 한국어로 작성하세요.
                """
                content.append(instruction)
                
                # 이미지 추가 (있을 경우)
                if uploaded_images:
                    for img in uploaded_images:
                        image = Image.open(img)
                        content.append(image)
                
                try:
                    # AI 실행
                    response = model.generate_content(content)
                    
                    st.success("분석 결과가 도착했습니다!")
                    st.markdown(response.text)
                    
                except Exception as e:
                    st.error(f"오류 발생: {e}")
                    st.info("Tip: API Key의 권한이나 모델 지원 여부를 확인하세요.")
    else:
        st.info("왼쪽 정보를 입력하면 AI의 분석 결과가 실시간으로 생성됩니다.")
