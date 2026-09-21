/**
 * 쿠팡 판매분석 파일로 로켓그로스 취소를 반영한다.
 *
 * 로켓그로스 주문 API는 취소를 안 준다. 윙 > 비즈니스 인사이트 > 판매분석에서
 * 날짜를 고르고 내려받은 옵션별 파일(SELLER_INSIGHTS_VENDOR_ITEM_METRICS)에는
 * '총 취소된 상품수·총 취소 금액'이 있어, 그 값을 그 날짜의 그로스 매출에서 뺀다.
 * 파일에 날짜가 없으므로 어느 날짜 파일인지는 여기서 고른다.
 */
import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { coupangApi } from '../../lib/coupang';

const loadXLSX = () => import('xlsx');

// 파일의 열 이름 — 쿠팡이 내려주는 그대로
const COL = {
  vendorItemId: '옵션 ID',
  channel: '판매방식',
  grossAmount: '총 매출(원)',
  grossQty: '총 판매수',
  cancelAmount: '총 취소 금액(원)',
  cancelQty: '총 취소된 상품수',
} as const;

const kstYesterday = () => new Date(Date.now() + 9 * 3600_000 - 86400_000).toISOString().slice(0, 10);

async function parse(file: File) {
  const buf = await file.arrayBuffer();
  const XLSX = await loadXLSX();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headers = new Set(Object.keys(rows[0] ?? {}));
  for (const h of [COL.vendorItemId, COL.channel, COL.cancelQty, COL.cancelAmount]) {
    if (!headers.has(h)) throw new Error(`판매분석 옵션별 파일이 아닙니다. '${h}' 열이 없습니다.`);
  }
  const num = (v: unknown) => Math.abs(Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0);
  return rows
    .filter(r => String(r[COL.channel] ?? '').includes('로켓그로스'))
    .map(r => ({
      vendorItemId: String(r[COL.vendorItemId] ?? '').trim(),
      cancelQty: Math.round(num(r[COL.cancelQty])),
      cancelAmount: Math.round(num(r[COL.cancelAmount])),
      grossQty: Math.round(num(r[COL.grossQty])),
      grossAmount: Math.round(num(r[COL.grossAmount])),
    }))
    .filter(r => r.vendorItemId);
}

export function GrowthCancelUpload({ onDone }: { onDone: () => void | Promise<void> }) {
  const [date, setDate] = useState(kstYesterday());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | null) => {
    if (!file || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const rows = await parse(file);
      if (rows.length === 0) throw new Error('파일에 로켓그로스 줄이 없습니다.');
      const r = await coupangApi.growthCancelUpload({ date, rows });
      const mismatch = r.fileGross !== r.ourGross;
      setMsg(
        `${r.date} 그로스 ${r.matched}개 옵션에 취소 ${r.cancelQty.toLocaleString('ko-KR')}개 · ${r.cancelAmount.toLocaleString('ko-KR')}원을 뺐습니다.` +
          (mismatch
            ? ` 파일의 총 판매수 ${r.fileGross}개, 우리 결제 수량 ${r.ourGross}개 — 다르면 날짜를 잘못 골랐거나 아직 수집 전입니다.`
            : ` 총 판매수 ${r.fileGross}개가 우리 결제 수량과 일치합니다.`),
      );
      await onDone();
    } catch (e: any) {
      setMsg(e?.message ?? '올리지 못했습니다.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="mt-3 rounded-card border border-line bg-paper-2/40 px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <p className="text-[12px] font-semibold text-ink">판매분석 파일로 취소 정확히 반영</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
            윙 › 비즈니스 인사이트 › 판매분석에서 날짜를 고르고 옵션별 파일을 내려받아 올리세요.
            그 날짜의 그로스 취소가 추정치 대신 파일 값으로 바뀝니다.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">
          파일의 날짜
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded-control border border-line bg-paper px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          파일 올리기
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => upload(e.target.files?.[0] ?? null)} />
      </div>
      {msg && <p className="mt-2 text-[11.5px] text-ink-2">{msg}</p>}
    </div>
  );
}
