import React, { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, DollarSign, Hash, Cpu } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { FEATURE_LABEL, formatUsd, formatKrw } from '../../lib/pricing';

type Period = 'today' | '7d' | '30d' | 'all';

interface Agg {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface StatsResponse {
  period: Period;
  totals: Agg;
  userBreakdown: (Agg & { userId: string; name: string; email: string })[];
  featureBreakdown: (Agg & { feature: string })[];
  modelBreakdown: (Agg & { model: string })[];
  timeline: (Agg & { date: string })[];
}

const PERIOD_LABEL: Record<Period, string> = {
  today: '오늘',
  '7d': '최근 7일',
  '30d': '최근 30일',
  all: '전체',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function UsageStats() {
  const [period, setPeriod] = useState<Period>('30d');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/stats?period=${period}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '통계를 불러오지 못했습니다.');
        return;
      }
      setStats(data);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, [period]);

  const maxDayCost = Math.max(1e-9, ...(stats?.timeline.map(d => d.costUsd) ?? [0]));

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {(['today', '7d', '30d', 'all'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                period === p ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <button onClick={fetchStats} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">{error}</div>
      ) : !stats ? null : (
        <div className="space-y-6">
          {/* 합계 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Hash className="w-4 h-4 text-blue-600" />}
              label="총 호출 수"
              value={stats.totals.calls.toLocaleString()}
            />
            <SummaryCard
              icon={<Cpu className="w-4 h-4 text-purple-600" />}
              label="입력 토큰"
              value={fmtTokens(stats.totals.inputTokens)}
            />
            <SummaryCard
              icon={<Cpu className="w-4 h-4 text-pink-600" />}
              label="출력 토큰"
              value={fmtTokens(stats.totals.outputTokens)}
            />
            <SummaryCard
              icon={<DollarSign className="w-4 h-4 text-green-600" />}
              label="총 비용"
              value={formatUsd(stats.totals.costUsd)}
              sub={formatKrw(stats.totals.costUsd)}
            />
          </div>

          {/* 일자별 차트 */}
          {stats.timeline.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3">일자별 비용 추이</h3>
              <div className="flex items-end gap-1 h-32">
                {stats.timeline.map(d => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}\n호출: ${d.calls}\n비용: ${formatUsd(d.costUsd)}`}>
                    <div
                      className="w-full bg-blue-500 hover:bg-blue-600 rounded-t transition-colors"
                      style={{ height: `${Math.max(2, (d.costUsd / maxDayCost) * 100)}%` }}
                    />
                    <div className="text-[10px] text-slate-400 truncate w-full text-center">{d.date.slice(5)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 회원별 */}
          <BreakdownTable
            title="회원별 사용량"
            columns={['회원', '이메일', '호출', '입력', '출력', '비용 (USD)', '비용 (KRW)']}
            rows={stats.userBreakdown.map(u => [
              u.name,
              u.email,
              u.calls.toLocaleString(),
              fmtTokens(u.inputTokens),
              fmtTokens(u.outputTokens),
              formatUsd(u.costUsd),
              formatKrw(u.costUsd),
            ])}
          />

          {/* 기능별 */}
          <BreakdownTable
            title="기능별 사용량"
            columns={['기능', '호출', '입력', '출력', '비용 (USD)', '비용 (KRW)']}
            rows={stats.featureBreakdown.map(f => [
              FEATURE_LABEL[f.feature] ?? f.feature,
              f.calls.toLocaleString(),
              fmtTokens(f.inputTokens),
              fmtTokens(f.outputTokens),
              formatUsd(f.costUsd),
              formatKrw(f.costUsd),
            ])}
          />

          {/* 모델별 */}
          <BreakdownTable
            title="모델별 사용량"
            columns={['모델', '호출', '입력', '출력', '비용 (USD)', '비용 (KRW)']}
            rows={stats.modelBreakdown.map(m => [
              m.model,
              m.calls.toLocaleString(),
              fmtTokens(m.inputTokens),
              fmtTokens(m.outputTokens),
              formatUsd(m.costUsd),
              formatKrw(m.costUsd),
            ])}
          />
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
        {icon} {label}
      </div>
      <div className="text-xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ title, columns, rows }: { title: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">데이터가 없습니다.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {columns.map(c => (
                <th key={c} className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition-colors">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-slate-700">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
