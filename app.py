import streamlit as st
import google.generativeai as genai
from PIL import Image
import io
import base64

# --- 1. 환경 설정 및 보안 ---
if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])
else:
    st.error("🔑 API Key가 설정되지 않았습니다. Streamlit Secrets를 확인해주세요.")
    st.stop()

# 모델 설정 (이미지 생성 및 분석용)
model = genai.GenerativeModel('gemini-1.5-flash')

# --- 2. 화면 구성 ---
st.set_page_config(page_title="AI 썸네일 생성기", layout="wide")

st.title("🎨 AI 썸네일 생성기 (Thumbnail Generator)")
st.write("이미지를 업로드하고 원하는 스타일을 선택하면 AI가 새로운 썸네일을 디자인합니다.")

col1, col2 = st.columns([1, 1])

with col1:
    st.subheader("⚙️ 썸네일 설정")
    
    # 상품명 및 요청사항
    product_name = st.text_input("상품명 (선택 사항)", placeholder="예: 무선 저소음 키보드")
    shot_type = st.radio("컷 타입 선택", ["제품컷 (Product)", "모델컷 (Model)"], horizontal=True)
    custom_prompt = st.text_area("추가 요청사항", placeholder="예: 배경은 바다로 해줘, 따뜻한 햇살 느낌으로 해줘 등")

    # 이미지 업로드 (다중 선택 가능)
    uploaded_files = st.file_uploader("레퍼런스 이미지 업로드", type=['png', 'jpg', 'jpeg'], accept_multiple_files=True)
    
    if uploaded_files:
        st.write(f"업로드된 이미지: {len(uploaded_files)}장")
        # 미리보기
        cols = st.columns(3)
        for idx, file in enumerate(uploaded_files):
            with cols[idx % 3]:
                st.image(file, use_container_width=True)

    # 생성 버튼
    generate_btn = st.button("🪄 썸네일 생성하기", use_container_width=True, type="primary")

with col2:
    st.subheader("🖼️ 결과물")
    
    if generate_btn:
        with st.spinner("AI가 썸네일을 디자인하고 있습니다..."):
            # 프롬프트 구성 (React 코드의 로직 반영)
            prompt = "High quality e-commerce product thumbnail. Clean and professional style. "
            
            if "모델" in shot_type:
                prompt += "A professional model posing with the product on a pure white background. "
            else:
                prompt += "A full shot of the product clearly visible on a pure white background, with absolutely no people or hands. "
            
            if product_name:
                prompt += f"Product: {product_name}. Do not include any text or typography in the image. "
            
            if custom_prompt:
                prompt += f"User specific instructions: {custom_prompt}. "
            
            # 이미지 데이터 준비
            parts = [prompt]
            if uploaded_files:
                for uploaded_file in uploaded_files:
                    img_data = uploaded_file.getvalue()
                    parts.append({
                        "mime_type": uploaded_file.type,
                        "data": img_data
                    })
            
            try:
                # Gemini 이미지 생성 호출 (참고: 실제 이미지 생성은 API 권한에 따라 결과가 달라질 수 있습니다)
                response = model.generate_content(parts)
                
                # 결과물 표시
                if response.text:
                    st.success("기획 제안이 생성되었습니다!")
                    st.write(response.text)
                
                # 만약 실제 이미지 파일이 반환되는 구조라면 (Imagen 연동 시)
                # st.image(response_image) 
                
            except Exception as e:
                st.error(f"생성 중 오류가 발생했습니다: {e}")
    else:
        st.info("왼쪽에서 설정을 마친 후 [생성하기] 버튼을 눌러주세요.")

# --- 3. 스타일링 (CSS) ---
st.markdown("""
    <style>
    .stButton>button {
        border-radius: 12px;
        height: 3em;
    }
    </style>
    """, unsafe_allow_html=True)
