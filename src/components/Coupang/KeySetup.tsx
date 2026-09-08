/**
 * 쿠팡 윙 API 키 등록 — 3단계 안내
 *
 * 비개발자 판매자가 혼자 끝낼 수 있어야 한다. 한 번에 한 단계만 보여주고,
 * 윙 화면에 실제로 적힌 글자를 그대로 인용해 "이걸 찾아 누르세요"가 되게 한다.
 *
 * 실제로 막혔던 지점 세 곳을 특히 신경 쓴다.
 *  1) IP 등록 — 윙 [연동 정보 → 수정]에서 '자체개발(직접입력)'을 골라야 IP 칸이
 *     나온다. 넣고 [추가]를 눌러야 등록되는데 [확인]만 누르고 끝내기 쉽다.
 *  2) IP를 한 번에 붙여넣을 수 없다 — 윙은 한 개 넣고 [추가], 또 한 개 넣고 [추가]를
 *     반복해야 한다. 그래서 '전체 복사'가 아니라 줄마다 복사 버튼을 두고,
 *     복사한 줄에 체크를 남겨 어디까지 했는지 보이게 한다.
 *  3) 키 뒤바뀜 — Access/Secret을 바꿔 넣으면 쿠팡은 'Invalid signature'만 주고
 *     이유를 말해 주지 않는다. 입력하는 순간 형태를 검사해 알려준다.
 */
import { useState } from 'react';
import { AlertTriangle, Clock, Copy, Check, Loader2, ExternalLink, ChevronLeft } from 'lucide-react';
import { coupangApi, type CoupangStatus } from '../../lib/coupang';

interface Props {
  status: CoupangStatus;
  onSaved: () => void;
}

const WING_URL = 'https://wing.coupang.com';

/**
 * 다른 주문수집 프로그램의 IP는 서버(app_config.coupang_vendors)에서 온다.
 * 자체개발 모드에서는 업체를 하나만 고르는 게 아니라 IP를 여러 개 등록하므로,
 * 그 값을 함께 넣으면 기존 프로그램과 훈프로가 같이 돈다 (윙 등록 한도 10개).
 * 관리자 화면에서 업체를 추가하면 배포 없이 여기 반영된다.
 */

// 윙 화면의 라벨을 그대로 보여주는 태그. 사용자가 화면에서 같은 글자를 찾게 한다.
function WingLabel({ children }: { children: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-[6px] border border-line-strong bg-paper-2 px-2 py-0.5 text-[12.5px] font-semibold text-ink">
      {children}
    </span>
  );
}

// 키 형태 검사 — 실측값 기준 (Access 36자·하이픈 / Secret 40자·하이픈 없음)
function accessKeyShape(v: string): 'empty' | 'ok' | 'looks-secret' | 'bad' {
  const s = v.trim();
  if (!s) return 'empty';
  if (s.includes('-') && s.length === 36) return 'ok';
  if (!s.includes('-') && s.length === 40) return 'looks-secret';
  return 'bad';
}
function secretKeyShape(v: string): 'empty' | 'ok' | 'looks-access' | 'bad' {
  const s = v.trim();
  if (!s) return 'empty';
  if (!s.includes('-') && s.length === 40) return 'ok';
  if (s.includes('-') && s.length === 36) return 'looks-access';
  return 'bad';
}

const STEP_TITLES = ['윙에서 키 확인', 'IP 등록', '훈프로에 입력'] as const;

export function KeySetup({ status, onSaved }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [vendor, setVendor] = useState<string | null>(null);
  const [addedIps, setAddedIps] = useState<Set<string>>(new Set());

  const [vendorId, setVendorId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [keyExpiresAt, setKeyExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const relayIp = status.relayIp;

  // 윙은 IP를 한 개씩만 받는다. 복사한 줄에 체크를 남겨 진행 상황이 보이게 한다.
  const copyIp = async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip);
    } catch {
      /* 클립보드 거부 시에도 체크는 남긴다 — 사용자가 직접 선택해 복사하면 된다 */
    }
    setAddedIps(prev => new Set(prev).add(ip));
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
        keyExpiresAt: keyExpiresAt || undefined,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // 서버가 준 업체 목록 앞뒤로 '안 씁니다'와 '다른 프로그램'을 붙인다
  const vendorOptions = [
    { id: 'none', name: '안 씁니다', ips: [] as string[] },
    ...(status.vendors ?? []),
    { id: 'other', name: '다른 프로그램', ips: [] as string[] },
  ];
  const picked = vendorOptions.find(v => v.id === vendor);
  const ipList = [...(relayIp ? [relayIp] : []), ...(picked?.ips ?? [])];
  const doneCount = ipList.filter(ip => addedIps.has(ip)).length;

  const aShape = accessKeyShape(accessKey);
  const sShape = secretKeyShape(secretKey);
  const vendorCodeOk = /^A\d{6,}$/i.test(vendorId.trim());
  const sameKey = Boolean(accessKey.trim()) && accessKey.trim() === secretKey.trim();
  const ready = vendorCodeOk && aShape === 'ok' && sShape === 'ok' && !sameKey;

  const inputCls = (state: 'empty' | 'ok' | 'bad') =>
    `rounded-control border bg-paper px-3 py-2.5 font-mono text-[13px] outline-none focus:ring-2 focus:ring-accent ${
      state === 'ok' ? 'border-positive' : state === 'bad' ? 'border-critical' : 'border-line'
    }`;

  return (
    <div className="flex flex-col gap-4">
      {/* 단계 표시 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
        {STEP_TITLES.map((title, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          return (
            <div key={n} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold ${
                  step === n ? 'bg-accent text-ground' : step > n ? 'bg-positive-soft text-positive' : 'bg-paper-2 text-ink-3'
                }`}
              >
                {step > n ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
              </span>
              <span className={step === n ? 'font-semibold text-ink' : 'text-ink-3'}>{title}</span>
              {n < 3 && <span className="mx-1 text-ink-3">›</span>}
            </div>
          );
        })}
      </div>

      {/* ───────── 1단계 ───────── */}
      {step === 1 && (
        <div className="rounded-panel border border-line bg-paper p-5 sm:p-6">
          <h2 className="text-[17px] font-bold text-ink">1단계. 쿠팡 윙에서 API 키를 확인하세요</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            쿠팡이 훈프로에 판매 데이터를 넘겨주려면 열쇠(API 키)가 필요합니다. 윙에서 확인합니다.
          </p>

          <ol className="mt-4 flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink">
            <li className="flex gap-3">
              <span className="shrink-0 font-bold text-accent">①</span>
              <span>
                <a href={WING_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                  쿠팡 윙 열기 <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {' '}→ <WingLabel>판매자정보</WingLabel> → <WingLabel>추가판매정보</WingLabel> →{' '}
                <WingLabel>OPEN API 키 발급</WingLabel>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-bold text-accent">②</span>
              <span>
                표에 <WingLabel>업체코드</WingLabel> <WingLabel>Access Key</WingLabel> <WingLabel>Secret Key</WingLabel> 가
                이미 보이면 <b>그 값을 그대로 씁니다.</b> 이 창은 닫지 마세요 — 2·3단계에서 계속 씁니다.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 font-bold text-accent">③</span>
              <span>
                표가 비어 있으면 <WingLabel>발급</WingLabel> 을 누르세요. 앞의 동의 버튼 3개를 먼저 눌러야 활성화됩니다.
                발급 직후에는 쿠팡 쪽 준비에 <b>최대 하루</b>가 걸릴 수 있습니다.
              </span>
            </li>
          </ol>

          <div className="mt-4 flex items-start gap-2 rounded-card border border-critical/35 bg-critical-soft p-3.5 text-[12.5px] leading-relaxed text-ink-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
            <span>
              <b className="text-ink">[재발급] 버튼은 누르지 마세요.</b> 키는 계정당 하나뿐이라, 재발급하면
              지금 쓰고 계신 다른 프로그램의 연동이 끊깁니다. 이미 있는 키를 그대로 쓰면 됩니다.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            className="mt-5 flex min-h-[44px] w-full items-center justify-center rounded-control bg-accent px-5 text-[14px] font-bold text-ground hover:opacity-90"
          >
            키를 확인했어요 — 다음
          </button>
        </div>
      )}

      {/* ───────── 2단계 ───────── */}
      {step === 2 && (
        <div className="rounded-panel border border-line bg-paper p-5 sm:p-6">
          <h2 className="text-[17px] font-bold text-ink">2단계. 윙에 IP 주소를 등록하세요</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            쿠팡은 미리 등록된 컴퓨터에서 온 요청만 받아줍니다. 훈프로 서버 주소를 윙에 알려주면 됩니다.
          </p>

          {/* 먼저 어떤 프로그램을 쓰는지 물어야 넣을 IP 목록이 정해진다 */}
          <div className="mt-4">
            <p className="text-[13.5px] font-semibold text-ink">지금 쓰고 계신 주문수집 프로그램이 있나요?</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {vendorOptions.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVendor(v.id)}
                  className={`min-h-[40px] rounded-control border px-4 text-[13px] font-semibold transition-colors ${
                    vendor === v.id ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:text-ink'
                  }`}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>

          {vendor === 'other' && (
            <div className="mt-3 rounded-card border border-line bg-paper-2 p-3.5 text-[12.5px] leading-relaxed text-ink-2">
              <b className="text-ink">그 프로그램도 계속 쓸 수 있습니다.</b> 그 업체 고객센터에{' '}
              <b className="text-ink">"쿠팡 윙에 등록할 IP 주소를 알려달라"</b>고 하시면 알려줍니다.
              받은 주소도 아래 훈프로 주소와 <b className="text-ink">함께</b> 등록하시면 양쪽 다 돌아갑니다. (윙은 10개까지 등록)
              <br />
              받으신 주소를 훈프로에도 알려주시면, 다음부터는 이 화면에서 바로 뜨게 해두겠습니다.
            </div>
          )}

          {/* IP 목록 — 윙은 한 개씩만 받으므로 줄마다 복사 버튼을 둔다 */}
          {vendor && (
            relayIp ? (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[13.5px] font-semibold text-ink">
                    아래 {ipList.length}개를 <b className="text-accent">하나씩</b> 넣고 [추가]를 누르세요
                  </p>
                  <span className="text-[12px] tabular-nums text-ink-3">{doneCount} / {ipList.length} 복사함</span>
                </div>

                <ul className="flex flex-col gap-1.5">
                  {ipList.map((ip, i) => {
                    const done = addedIps.has(ip);
                    return (
                      <li
                        key={ip}
                        className={`flex items-center gap-3 rounded-control border px-3 py-2.5 ${
                          done ? 'border-positive bg-positive-soft' : 'border-line bg-paper-2'
                        }`}
                      >
                        <span className={`w-5 shrink-0 text-center text-[12px] tabular-nums ${done ? 'text-positive' : 'text-ink-3'}`}>
                          {done ? <Check className="mx-auto h-4 w-4" strokeWidth={3} /> : i + 1}
                        </span>
                        <span className="min-w-0 flex-1 font-mono text-[14px] font-semibold text-ink">{ip}</span>
                        {i === 0 && <span className="shrink-0 text-[11.5px] font-semibold text-accent">훈프로</span>}
                        <button
                          type="button"
                          onClick={() => copyIp(ip)}
                          className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-3 text-[12.5px] font-semibold text-ink hover:border-accent"
                        >
                          <Copy className="h-3.5 w-3.5" /> 복사
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <ol className="mt-4 flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink">
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-accent">①</span>
                    <span>
                      1단계 화면 아래쪽 <WingLabel>연동 정보</WingLabel> 옆 <WingLabel>수정</WingLabel> 을 누르세요.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-accent">②</span>
                    <span>
                      <WingLabel>업체 입력 방식</WingLabel>에서 <b>오른쪽</b> <WingLabel>자체개발(직접입력)</WingLabel> 을 선택하세요.
                      그래야 IP 칸이 나타납니다.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-accent">③</span>
                    <span>
                      <WingLabel>업체명</WingLabel> 에 <b>자체개발</b>, <WingLabel>URL</WingLabel> 에{' '}
                      <b>hoonproai.com</b> 을 넣으세요. (둘 다 표시용이라 아무 값이나 됩니다)
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-accent">④</span>
                    <span>
                      위 목록을 <b>하나 복사 → 윙 IP 칸에 붙여넣기 → [추가] 클릭</b>, 이걸 {ipList.length}번 반복하세요.
                      윙은 한 번에 하나씩만 받습니다.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-accent">⑤</span>
                    <span>
                      IP {ipList.length}개가 모두 목록에 보이면 <WingLabel>확인</WingLabel> 을 누르세요.
                    </span>
                  </li>
                </ol>

                <div className="mt-3 flex items-start gap-2 rounded-card border border-critical/35 bg-critical-soft p-3.5 text-[12.5px] leading-relaxed text-ink-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
                  <span>
                    붙여넣은 뒤 <b className="text-ink">[추가]를 눌러야</b> 목록에 들어갑니다. 넣기만 하고 [확인]을 누르면
                    등록되지 않습니다. 그리고 <b className="text-ink">연동 정보 수정은 일주일에 10번</b>까지만 되니 한 번에 끝내주세요.
                  </span>
                </div>

                {/* 등록 직후 바로 다음 단계로 넘어가면 십중팔구 IP 차단 오류가 난다.
                    그때 IP를 잘못 넣었다고 오해해 지웠다 넣기를 반복하면 주 10회 한도가
                    금방 사라진다. 넘어가기 전에 미리 알려 둔다. */}
                <div className="mt-2.5 flex items-start gap-2 rounded-card border border-line bg-paper-2 p-3.5 text-[12.5px] leading-relaxed text-ink-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <span>
                    등록해도 <b className="text-ink">쿠팡에 반영되기까지 5~30분</b> 걸립니다. 바로 다음 단계로 넘어가면
                    실패할 수 있는데, 그건 IP를 잘못 넣은 게 아닙니다.
                    <b className="text-ink"> IP를 다시 손대지 마시고</b> 잠시 뒤 [연동하기]만 다시 눌러주세요.
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-card border border-critical/35 bg-critical-soft p-4 text-[12.5px] text-ink-2">
                훈프로 서버 주소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.
              </div>
            )
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex min-h-[44px] items-center gap-1 rounded-control border border-line px-4 text-[13px] text-ink-2 hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" /> 이전
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!vendor}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-control bg-accent px-5 text-[14px] font-bold text-ground hover:opacity-90 disabled:opacity-40"
            >
              IP를 등록했어요 — 다음
            </button>
          </div>
        </div>
      )}

      {/* ───────── 3단계 ───────── */}
      {step === 3 && (
        <div className="rounded-panel border border-line bg-paper p-5 sm:p-6">
          <h2 className="text-[17px] font-bold text-ink">3단계. 윙에 보이는 값을 여기에 붙여넣으세요</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            1단계 윙 화면의 표에서 세 값을 복사합니다. 모양이 맞으면 칸이 초록색으로 바뀝니다.
          </p>

          <div className="mt-4 flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-2">
                업체코드 <span className="text-ink-3">— A로 시작하는 숫자</span>
              </span>
              <input
                value={vendorId}
                onChange={e => setVendorId(e.target.value)}
                placeholder="A00123456"
                className={inputCls(vendorId.trim() ? (vendorCodeOk ? 'ok' : 'bad') : 'empty')}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-2">
                Access Key <span className="text-ink-3">— 하이픈(-)이 들어간 36자</span>
              </span>
              <input
                value={accessKey}
                onChange={e => setAccessKey(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx 형태"
                className={inputCls(aShape === 'empty' ? 'empty' : aShape === 'ok' ? 'ok' : 'bad')}
              />
              {aShape === 'looks-secret' && (
                <span className="text-[12px] font-semibold text-critical">이건 Secret Key 모양입니다. 두 칸이 바뀐 것 같아요.</span>
              )}
              {aShape === 'bad' && (
                <span className="text-[12px] text-critical">모양이 다릅니다. 윙 표의 Access Key를 끝까지 복사했는지 확인해주세요.</span>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-2">
                Secret Key <span className="text-ink-3">— 하이픈 없는 40자</span>
              </span>
              <input
                type="password"
                value={secretKey}
                onChange={e => setSecretKey(e.target.value)}
                placeholder="영문·숫자 40자 형태"
                className={inputCls(sShape === 'empty' ? 'empty' : sShape === 'ok' ? 'ok' : 'bad')}
              />
              {sShape === 'looks-access' && (
                <span className="text-[12px] font-semibold text-critical">이건 Access Key 모양입니다. 두 칸이 바뀐 것 같아요.</span>
              )}
              {sShape === 'bad' && (
                <span className="text-[12px] text-critical">모양이 다릅니다. 윙 표의 Secret Key를 끝까지 복사했는지 확인해주세요.</span>
              )}
              {sameKey && (
                <span className="text-[12px] font-semibold text-critical">Access Key와 같은 값입니다. Secret Key를 따로 복사해주세요.</span>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-2">
                키 만료일 <span className="text-ink-3">(선택 사항 — 윙 표의 [유효 기간] 날짜. 넣으면 만료 2주 전에 알려드립니다)</span>
              </span>
              <input
                type="date"
                value={keyExpiresAt}
                onChange={e => setKeyExpiresAt(e.target.value)}
                className="rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-accent"
              />
            </label>

            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex min-h-[44px] items-center gap-1 rounded-control border border-line px-4 text-[13px] text-ink-2 hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" /> 이전
              </button>
              <button
                onClick={save}
                disabled={!ready || saving}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-control bg-accent px-5 text-[14px] font-bold text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
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
            </div>

            {error && (
              <div className="rounded-card border border-critical/35 bg-critical-soft p-3.5 text-[12.5px] leading-relaxed text-ink-2">
                {error}
              </div>
            )}

            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Secret Key는 암호화해 저장하며 화면에 다시 표시되지 않습니다.
              <b className="text-ink-2">윙에 IP를 방금 등록하셨다면 반영에 5~30분 걸립니다</b> — 지금 실패해도
              IP를 다시 손대지 마시고 잠시 뒤 [연동하기]만 다시 눌러주세요.
              키를 방금 발급했다면 쿠팡 쪽 준비에 최대 하루가 걸릴 수 있어, 그때는 내일 다시 시도하면 됩니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
