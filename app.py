import streamlit as st
import google.generativeai as genai
from PIL import Image

# 1. API 키 설정
if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])
else:
    st.error("🔑 Secrets에서 API 키를 설정해주세요.")
    st.stop()

# 2. 모델 설정 (에러 방지를 위한 2단계 체크)
# 1.5-flash-latest는 실질적으로 가장 최신 성능을 내는 모델 ID입니다.
try:
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
except:
    model = genai.GenerativeModel('gemini-1.5-flash')

st.title("⚡ AI 훈프로 썸네일 제작")

# 3. 입력 창 및 로직 (기존과 동일)
product_name = st.sidebar.text_input("상품명", placeholder="예: 무선 가습기")
uploaded_files = st.file_uploader("이미지 업로드", type=['png', 'jpg', 'jpeg'], accept_multiple_files=True)

if st.sidebar.button("분석 시작"):
    if product_name:
        with st.spinner("AI가 분석 중입니다..."):
            content = [f"상품 '{product_name}'에 대한 판매 전략과 카피를 제안해줘."]
            if uploaded_files:
                for f in uploaded_files:
                    content.append(Image.open(f))
            
            try:
                response = model.generate_content(content)
                st.markdown(response.text)
            except Exception as e:
                st.error(f"실행 중 오류: {e}")
    else:
        st.warning("상품명을 입력하세요.")
