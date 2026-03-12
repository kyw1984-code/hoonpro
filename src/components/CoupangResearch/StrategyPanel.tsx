import type { CoupangProduct } from "../../types/coupang";
import { deriveStrategies, buildChecklist } from "../../lib/coupang";

interface Props {
  products: CoupangProduct[];
}

export default function StrategyPanel({ products }: Props) {
  const strategies = deriveStrategies(products);
  const checklist  = buildChecklist(products);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {strategies.map((s) => (
          <div key={s.title} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-5"
            style={{ borderLeftColor: s.color, borderLeftWidth: 3 }}>
            <div className="text-2xl mb-2">{s.icon}</div>
            <p className="text-sm font-bold mb-2" style={{ color: s.color }}>{s.title}</p>
            <p className="text-xs text-neutral-400 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
      <div className="bg-blue-500/[0.08] border border-blue-500/20 rounded-xl p-5">
        <p className="text-sm font-bold text-blue-400 mb-4">📋 권장 진입 체크리스트</p>
        <ul className="flex flex-col gap-2">
          {checklist.map((item, idx) => (
            <li key={idx} className="flex gap-3 text-xs text-neutral-400 leading-relaxed">
              <span className="text-blue-500 font-bold shrink-0">·</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
