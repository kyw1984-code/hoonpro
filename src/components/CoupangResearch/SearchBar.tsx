import { KeyboardEvent, useRef } from "react";

interface Props {
  keyword: string;
  onChange: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
}

export default function SearchBar({ keyword, onChange, onSearch, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSearch();
  };

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 mb-7">
      <p className="text-xs font-semibold text-neutral-500 mb-3 tracking-wide uppercase">
        키워드로 시장 분석
      </p>
      <div className="flex gap-3">
        <input
          ref={inputRef}
          value={keyword}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="예: 무선이어폰, 캠핑의자, 프로틴 쉐이커..."
          className="flex-1 bg-white/[0.05] border border-white/[0.12] rounded-xl px-4 py-3
                     text-neutral-100 placeholder-neutral-600 text-sm outline-none
                     focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition"
        />
        <button
          onClick={onSearch}
          disabled={loading || !keyword.trim()}
          className="px-7 py-3 rounded-xl font-bold text-sm text-white transition
                     bg-gradient-to-r from-red-600 to-red-400
                     hover:from-red-500 hover:to-red-300
                     disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? "분석 중…" : "🔍 분석하기"}
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-700">
        ⚡ API 키 미설정 시 데모 데이터로 자동 실행됩니다
      </p>
    </div>
  );
}
