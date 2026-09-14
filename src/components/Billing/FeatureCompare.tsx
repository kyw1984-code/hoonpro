import React from 'react';
import { Check, X, Layers } from 'lucide-react';

/**
 * 무료 가입 vs 구독 기능 비교표.
 *
 * 구독 화면에만 둔다. 랜딩에는 이미 요금 섹션이 있고, 같은 내용을 두 곳에
 * 적으면 한쪽만 고쳐진다.
 *
 * '하루 N회'는 화면에 적어 두지 않고 서버가 내려주는 실제 한도를 쓴다.
 * 관리자가 한도를 바꿨는데 안내만 옛날 숫자로 남는 일을 막는다.
 */

interface Row {
  /** 기능 이름 */
  name: string;
  /** 한 줄 설명 — 이름만으로 뭘 하는지 모르는 기능에만 */
  hint?: string;
  /** 무료 가입 계정이 쓸 수 있는가 */
  free: boolean;
  /** 이 기능의 한도를 읽어 올 키 (없으면 체크 표시만) */
  limitKey?: string;
}

const ROWS: Row[] = [
  { name: '훈프로 소싱AI', hint: '팔릴 상품 발굴 + 점수 근거', free: false, limitKey: 'sourcing' },
  { name: '순위 추적', hint: '오가닉 순위 + 광고 순위', free: false, limitKey: 'rank' },
  { name: '키워드 경쟁 분석', hint: '내 위에 누가 있나', free: false },
  { name: '리뷰 분석', hint: '경쟁사 리뷰 요약', free: false, limitKey: 'reviews' },
  { name: '광고 성과 분석', hint: '상품·옵션별 광고비와 전환', free: false, limitKey: 'analyze' },
  { name: '훈프로 정산AI', hint: '매출·수수료·순이익 자동 정산', free: false },
  { name: '로켓그로스 매출 합산', hint: '윙/그로스 분리 표시', free: false },
  { name: '원가 입력 · 마진 계산', free: false },
  { name: '반품 사유 분석', free: false },
  { name: '쿠폰 효과 비교', free: false },
  { name: '아침 브리핑 메일 · 재고 발주 알림', free: false },
  { name: '훈프로 코칭AI', hint: '쿠팡 운영 질문 답변', free: false, limitKey: 'qa' },
];

function Yes() {
  return <Check className="mx-auto h-4 w-4 text-accent" aria-label="사용 가능" />;
}
function No() {
  return <X className="mx-auto h-4 w-4 text-ink-3" aria-label="사용 불가" />;
}

/** 한도를 사람이 읽는 말로. 0(내린 기능)은 애초에 표에 없다 */
function limitLabel(limit: number | undefined): string | null {
  if (limit === undefined || limit === 0) return null;
  if (limit < 0) return '무제한';
  return `하루 ${limit}회`;
}

export function FeatureCompare({ limits }: { limits?: Record<string, number> }) {
  return (
    <div className="rounded-panel border border-line bg-paper p-6">
      <div className="mb-1 flex items-center gap-2">
        <Layers className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold text-ink">무료 가입과 구독의 차이</h3>
      </div>
      <p className="mb-4 text-[12.5px] text-ink-2">
        구독하면 아래 기능을 전부 쓸 수 있습니다. 한도는 매일 자정(KST)에 초기화됩니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-2">
                기능
              </th>
              <th className="w-[88px] border-b border-line px-2 py-3 text-center text-[12.5px] font-semibold text-ink-2">
                무료 가입
              </th>
              <th className="w-[104px] rounded-t-card border-x border-t border-accent-line bg-accent-soft px-2 py-3 text-center text-[12.5px] font-semibold text-accent">
                훈프로 구독
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => {
              const label = limitLabel(row.limitKey ? limits?.[row.limitKey] : undefined);
              const last = i === ROWS.length - 1;
              return (
                <tr key={row.name} className="transition-colors hover:bg-paper-2">
                  <td className="border-b border-line px-3 py-3 align-middle">
                    <span className="text-[13.5px] text-ink">{row.name}</span>
                    {row.hint && <span className="mt-0.5 block text-[11.5px] text-ink-3">{row.hint}</span>}
                  </td>
                  <td className="border-b border-line px-2 py-3 text-center align-middle">
                    {row.free ? <Yes /> : <No />}
                  </td>
                  <td
                    className={`border-x border-b border-accent-line bg-accent-soft/40 px-2 py-3 text-center align-middle ${
                      last ? 'rounded-b-card' : ''
                    }`}
                  >
                    {label ? (
                      <span className="text-[12.5px] font-semibold tabular-nums text-accent">{label}</span>
                    ) : (
                      <Yes />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[12px] text-ink-3">
        쿠팡 계정 연동, 데이터 보관, 업데이트는 모든 구독에 포함됩니다. 해지하면 결제한 기간이 끝날 때까지 그대로 쓰실 수 있습니다.
      </p>
    </div>
  );
}
