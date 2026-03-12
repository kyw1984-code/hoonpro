import React, { useState } from 'react';
import { Tag, CheckCircle, XCircle, AlertTriangle, Copy, Check } from 'lucide-react';

export const ProductNameGenerator: React.FC = () => {
  const [brand, setBrand] = useState('');
  const [target, setTarget] = useState('');
  const [season, setSeason] = useState<string[]>([]);
  const [mainKeyword, setMainKeyword] = useState('');
  const [appealPoint, setAppealPoint] = useState('');
  const [subKeyword, setSubKeyword] = useState('');
  const [setInfo, setSetInfo] = useState('');
  const [copied, setCopied] = useState(false);

  const seasonOptions = ['봄', '여름', '가을', '겨울', '간절기', '사계절'];
  const targetOptions = ['', '남자', '여성', '남녀공용', '아동', '유아', '키즈', '성인'];

  const toggleSeason = (s: string) => {
    setSeason(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const cleanJoin = (parts: string[]) =>
    parts.filter(p => p.trim()).join(' ');

  const finalTitle = cleanJoin([
    brand, target, season.join(' '),
    mainKeyword, appealPoint, subKeyword, setInfo
  ]);

  const textLen = finalTitle.length;

  const words = finalTitle.split(' ').filter(Boolean);
  const duplicates = [...new Set(words.filter(x => words.filter(w => w === x).length > 1))];

  const handleCopy = () => {
    navigator.clipboard.writeText(finalTitle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
            <Tag className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">쿠팡 상품명 제조기</h2>
        </div>
        <p className="text-slate-500 mb-8">입력값이 수정되면 상품명이 <span className="font-semibold text-slate-700">실시간으로 자동 변경</span>됩니다.</p>

        {/* 입력 섹션 */}
        <h3 className="text-lg font-bold text-slate-700 mb-4">1. 상품 정보 입력</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 왼쪽 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">브랜드 <span className="text-slate-400 font-normal">(없으면 공란)</span></label>
              <input
                type="text"
                value={brand}
                onChange={e => setBrand(e.target.value)}
                placeholder="예: 나이키, 훈프로"
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">타겟 (성별/대상)</label>
              <select
                value={target}
                onChange={e => setTarget(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-400 outline-none bg-white"
              >
                {targetOptions.map(opt => (
                  <option key={opt} value={opt}>{opt || '선택 안함'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">시즌 (여러개 선택 가능)</label>
              <div className="flex flex-wrap gap-2">
                {seasonOptions.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleSeason(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                      season.includes(s)
                        ? 'bg-orange-500 text-white border-orange-500'
                        : 'bg-white text-slate-600 border-slate-300 hover:border-orange-400'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 오른쪽 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">제품명 1 (핵심 키워드) <span className="text-red-500">*필수</span></label>
              <input
                type="text"
                value={mainKeyword}
                onChange={e => setMainKeyword(e.target.value)}
                placeholder="예: 반팔티, 원피스"
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">소구점 (특징/재질/핏)</label>
              <input
                type="text"
                value={appealPoint}
                onChange={e => setAppealPoint(e.target.value)}
                placeholder="예: 오버핏, 린넨, 구김없는"
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">제품명 2 (세부 키워드)</label>
              <input
                type="text"
                value={subKeyword}
                onChange={e => setSubKeyword(e.target.value)}
                placeholder="예: 라운드티, 롱원피스"
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">구성 (몇종/세트)</label>
              <input
                type="text"
                value={setInfo}
                onChange={e => setSetInfo(e.target.value)}
                placeholder="예: 3종 세트, 1+1"
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-400 outline-none"
              />
            </div>
          </div>
        </div>

        {/* 결과 섹션 */}
        <div className="mt-8 border-t border-slate-200 pt-8">
          <h3 className="text-lg font-bold text-slate-700 mb-4">2. 생성된 상품명 확인</h3>

          {mainKeyword ? (
            <div className="space-y-4">
              {/* 상품명 출력 */}
              <div>
                <p className="text-sm font-medium text-slate-600 mb-1">✅ 최종 상품명</p>
                <p className="text-xs text-slate-400 mb-2">공식: 브랜드 + 타겟 + 시즌 + 제품명1 + 소구점 + 제품명2 + 구성</p>
                <div className="relative bg-slate-50 border border-slate-200 rounded-xl p-4 pr-16">
                  <p className="text-slate-800 font-medium text-lg break-all">{finalTitle}</p>
                  <button
                    onClick={handleCopy}
                    className="absolute top-3 right-3 p-2 rounded-lg bg-white border border-slate-200 hover:bg-orange-50 hover:border-orange-400 transition-all"
                  >
                    {copied
                      ? <Check className="w-4 h-4 text-green-500" />
                      : <Copy className="w-4 h-4 text-slate-500" />
                    }
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">📏 글자수: {textLen}자 (공백 포함)</p>
              </div>

              {/* 진단 */}
              <div className="border-t border-slate-100 pt-4">
                <h4 className="text-base font-bold text-slate-700 mb-3">🔍 훈프로의 상품명 진단</h4>
                <div className="space-y-2">
                  {/* 길이 체크 */}
                  {textLen > 50 ? (
                    <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-yellow-800"><span className="font-bold">길이 주의 ({textLen}자):</span> 50자를 넘으면 모바일 목록에서 뒷부분이 잘릴 수 있습니다.</p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl p-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-green-800"><span className="font-bold">길이 적합 ({textLen}자):</span> 모바일 가독성이 좋은 길이입니다.</p>
                    </div>
                  )}

                  {/* 중복 체크 */}
                  {duplicates.length > 0 ? (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
                      <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-800"><span className="font-bold">중복 단어 발견:</span> '{duplicates.join(', ')}' 단어가 중복되었습니다. 쿠팡 어뷰징 방지를 위해 하나를 삭제해주세요.</p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl p-3">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-green-800"><span className="font-bold">중복 없음:</span> 깔끔한 키워드 조합입니다.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-slate-400">
              👆 위 칸에 '제품명 1'을 입력하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
