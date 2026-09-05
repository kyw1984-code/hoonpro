/**
 * 쿠팡 윙 API 키 등록
 *
 * 온보딩에서 가장 중요한 두 가지를 화면에서 못 보고 지나치지 않게 만든다.
 *  1) 키는 업체코드당 1개뿐이다. 이미 주문수집 프로그램을 쓰는 판매자가
 *     '재발급'을 누르면 그쪽 연동이 끊긴다. 기존 키를 그대로 붙여넣게 안내한다.
 *  2) 쿠팡은 등록된 IP에서만 호출을 받는다. 우리 중계 서버 IP를 반드시
 *     윙에 등록해야 한다.
 */
import { useState } from 'react';
import { AlertTriangle, Copy, Check, KeyRound, Loader2, ExternalLink } from 'lucide-react';
import { coupangApi, type CoupangStatus } from '../../lib/coupang';

interface Props {
  status: CoupangStatus;
  onSaved: () => void;
}

export function KeySetup({ status, onSaved }: Props) {
  const [vendorId, setVendorId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [keyIssuedAt, setKeyIssuedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const relayIp = status.relayIp;

  const copyIp = async () => {
    if (!relayIp) return;
    try {
      await navigator.clipboard.writeText(relayIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 거부 시 무시 — 사용자가 직접 선택해 복사하면 된다 */
    }
  };

  const save = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await coupangApi.saveKey({
        vendorId: vendorId.trim(),
        accessKey: accessKey.trim(),
        secretKey: secretKey.trim(),
        keyIssuedAt: keyIssuedAt || undefined,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const ready = vendorId.trim() && accessKey.trim() && secretKey.trim();

  return (
    <div className="flex flex-col gap-5">
      {/* 재발급 경고 — 가장 먼저 읽혀야 한다 */}
      <div className="rounded-panel border border-critical/35 bg-critical-soft p-5">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-critical" />
          <h3 className="text-[14px] font-semibold text-ink">키를 새로 발급하지 마세요</h3>
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          쿠팡 Open API 키는 <b>업체코드당 1개</b>만 발급됩니다. 사방넷·이지어드민 같은 주문수집 프로그램을
          쓰고 계시다면 키를 새로 발급하는 순간 <b>그쪽 연동이 끊깁니다</b>.
          이미 발급받은 키가 있다면 그 값을 그대로 아래에 붙여넣어 주세요. 같은 키를 여러 프로그램이 함께 쓰는 것은 문제없습니다.
        </p>
      </div>

      {/* IP 등록 안내 */}
      {relayIp && (
        <div className="rounded-panel border border-line bg-paper p-5">
          <h3 className="mb-2 text-[14px] font-semibold text-ink">윙에 이 IP를 등록해주세요</h3>
          <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
            쿠팡은 <b>등록된 IP에서 온 호출만</b> 허용합니다. 윙의
            [판매자정보 → 추가판매정보 → OPEN API 키 발급] 화면에서 연동방식을 <b>자체개발(직접입력)</b>으로 두고
            아래 IP를 추가하세요. IP는 10개까지 등록되므로 기존 솔루션의 IP를 지우지 말고 <b>함께</b> 두시면 됩니다.
          </p>
          <button
            type="button"
            onClick={copyIp}
            className="inline-flex items-center gap-2 rounded-control border border-line bg-paper-2 px-3 py-2 font-mono text-[13px] text-ink transition-colors hover:border-line-strong"
          >
            {relayIp}
            {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5 text-ink-3" />}
          </button>
          <p className="mt-2 text-[11.5px] text-ink-3">
            연동정보 수정은 주 10회까지만 됩니다. 한 번에 정확히 입력해주세요.
          </p>
        </div>
      )}

      {/* 입력 폼 */}
      <div className="rounded-panel border border-line bg-paper p-6">
        <div className="mb-1 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-ink">쿠팡 윙 API 키 등록</h2>
        </div>
        <p className="mb-5 text-[12px] leading-relaxed text-ink-2">
          윙 → 판매자정보 → 추가판매정보 → OPEN API 키 발급에서 확인한 값을 입력해주세요.
          Secret Key는 암호화해 저장하며 화면에 다시 표시되지 않습니다.
          <a
            href="https://wing.coupang.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline"
          >
            윙 열기 <ExternalLink className="h-3 w-3" />
          </a>
        </p>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">업체코드 (Vendor ID)</span>
            <input
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
              placeholder="A00123456"
              className="rounded-control border border-line bg-paper px-3 py-2.5 font-mono text-[13px] outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">Access Key</span>
            <input
              value={accessKey}
              onChange={e => setAccessKey(e.target.value)}
              placeholder="윙에서 복사한 Access Key"
              className="rounded-control border border-line bg-paper px-3 py-2.5 font-mono text-[13px] outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">Secret Key</span>
            <input
              type="password"
              value={secretKey}
              onChange={e => setSecretKey(e.target.value)}
              placeholder="윙에서 복사한 Secret Key"
              className="rounded-control border border-line bg-paper px-3 py-2.5 font-mono text-[13px] outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-2">
              키 발급일 <span className="text-ink-3">(선택 — 만료 2주 전에 미리 알려드립니다)</span>
            </span>
            <input
              type="date"
              value={keyIssuedAt}
              onChange={e => setKeyIssuedAt(e.target.value)}
              className="rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-accent"
            />
          </label>

          <button
            onClick={save}
            disabled={!ready || saving}
            className="mt-1 flex min-h-[44px] items-center justify-center gap-2 rounded-control bg-accent px-5 text-[14px] font-bold text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                쿠팡에 확인하는 중...
              </>
            ) : (
              '연동하기'
            )}
          </button>

          {error && <p className="text-[12.5px] leading-relaxed text-critical">{error}</p>}

          <p className="text-[11.5px] leading-relaxed text-ink-3">
            키를 방금 발급했다면 쿠팡 내부 절차상 권한이 열리기까지 최대 24시간이 걸릴 수 있습니다.
            지금 실패해도 내일 다시 시도하면 됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}
