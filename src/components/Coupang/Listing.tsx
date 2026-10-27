/**
 * 쿠팡 상품 등록 (간단 등록).
 *
 * 윙의 등록 화면은 항목이 수십 개라 처음 파는 사람은 중간에 포기한다. 여기서는
 * 카테고리를 상품명으로 추천받고, 그 카테고리에 꼭 필요한 고시정보·옵션만
 * 묻는다. 출고지·반품지·A/S 같은 것은 기본 설정에 한 번 저장해 두고 재사용한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { coupangApi, type ListingMeta, type ListingPlace, type ListingReturnPlace, type ListingRow, type ListingSettings } from '../../lib/coupang';

const DELIVERY_COMPANIES: Array<{ code: string; name: string }> = [
  { code: 'CJGLS', name: 'CJ대한통운' }, { code: 'HANJIN', name: '한진택배' }, { code: 'LOTTE', name: '롯데택배' },
  { code: 'EPOST', name: '우체국택배' }, { code: 'LOGEN', name: '로젠택배' }, { code: 'KDEXP', name: '경동택배' },
];

interface ItemRow { id: string; attributes: Record<string, string>; salePrice: string; originalPrice: string; stock: string }
const uid = () => Math.random().toString(36).slice(2, 10);
const emptyItem = (): ItemRow => ({ id: uid(), attributes: {}, salePrice: '', originalPrice: '', stock: '100' });

/** 파일 → 긴 변 1500px JPEG data URL. 쿠팡은 10MB·가로 500px 이상을 요구하고, 원본 그대로면 업로드가 느리다 */
const fileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('읽기 실패'));
  reader.onload = () => {
    const img = new window.Image();
    img.onload = () => {
      const max = 1500;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(String(reader.result));
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});

function ImagePicker({ label, hint, urls, onChange, max }: { label: string; hint: string; urls: string[]; onChange: (u: string[]) => void; max: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    try {
      const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, Math.max(0, max - urls.length));
      const out: string[] = [];
      for (const f of picked) {
        const data = await fileToDataUrl(f);
        const { url } = await coupangApi.listingUpload(data);
        out.push(url);
      }
      onChange([...urls, ...out]);
    } catch (e: any) {
      alert(e?.message || '업로드 실패');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div>
      <p className="mb-1 text-[12px] font-semibold text-ink-2">{label} <span className="font-normal text-ink-3">({urls.length}/{max})</span></p>
      <p className="mb-2 text-[11px] text-ink-3">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative h-20 w-20 overflow-hidden rounded-control border border-line">
            <img src={u} alt="" className="h-full w-full object-cover" />
            {i === 0 && label.includes('대표') && <span className="absolute left-0 top-0 rounded-br bg-accent px-1 text-[10px] font-semibold text-black">대표</span>}
            <button type="button" onClick={() => onChange(urls.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"><X className="h-3 w-3" /></button>
          </div>
        ))}
        {urls.length < max && (
          <button type="button" onClick={() => ref.current?.click()} disabled={busy}
            className="flex h-20 w-20 flex-col items-center justify-center rounded-control border border-dashed border-line-strong text-[11px] text-ink-3 hover:border-accent disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mb-1 h-4 w-4" />추가</>}
          </button>
        )}
        <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={e => void add(e.target.files)} />
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none';
const labelCls = 'mb-1 block text-[12px] font-semibold text-ink-2';

export function Listing() {
  // ── 기본 설정 ──
  const [settings, setSettings] = useState<ListingSettings>({ wingUserId: '', outboundCode: '', returnCenterCode: '', deliveryCompany: 'CJGLS', afterServicePhone: '', afterServiceInfo: '' });
  const [outbound, setOutbound] = useState<ListingPlace[]>([]);
  const [returns, setReturns] = useState<ListingReturnPlace[]>([]);
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ── 등록 폼 ──
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<{ code: string; name: string } | null>(null);
  const [categoryCodeInput, setCategoryCodeInput] = useState('');
  const [meta, setMeta] = useState<ListingMeta | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [useOptions, setUseOptions] = useState(false);
  const [optionAttrs, setOptionAttrs] = useState<string[]>([]);
  const [items, setItems] = useState<ItemRow[]>([emptyItem()]);
  const [images, setImages] = useState<string[]>([]);
  const [detailImages, setDetailImages] = useState<string[]>([]);
  const [deliveryCharge, setDeliveryCharge] = useState('0');
  const [returnCharge, setReturnCharge] = useState('3000');
  const [outboundDays, setOutboundDays] = useState('1');
  const [searchTags, setSearchTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── 등록 내역 ──
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const r = await coupangApi.listingSettings();
      setSettings(r.settings);
      setOutbound(r.outbound);
      setReturns(r.returns);
      setSettingsErr(r.errors.length ? r.errors.join(' / ') : null);
      const incomplete = !r.settings.wingUserId || !r.settings.outboundCode || !r.settings.returnCenterCode || !r.settings.afterServicePhone;
      setShowSettings(incomplete);
    } catch (e: any) {
      setSettingsErr(e?.message || '설정을 불러오지 못했습니다.');
      setShowSettings(true);
    } finally {
      setSettingsLoading(false);
    }
  };
  const loadRows = async () => {
    setRowsLoading(true);
    try { setRows((await coupangApi.listings()).items); } catch { /* 표만 비어 있다 */ } finally { setRowsLoading(false); }
  };
  useEffect(() => { void loadSettings(); void loadRows(); }, []);

  const saveSettings = async () => {
    setSettingsSaving(true);
    try { await coupangApi.listingSettingsSave(settings); setShowSettings(false); } catch (e: any) { alert(e?.message || '저장 실패'); } finally { setSettingsSaving(false); }
  };

  const applyMeta = (m: ListingMeta) => {
    setMeta(m);
    setNotices({});
    const required = m.attributes.filter(a => a.required).map(a => a.name);
    setOptionAttrs(required);
    setUseOptions(required.length > 0 || !m.allowSingleItem);
    setItems([emptyItem()]);
  };
  const findCategory = async () => {
    if (!productName.trim()) { alert('상품명을 먼저 적어주세요.'); return; }
    setCategoryBusy(true);
    try {
      const r = await coupangApi.listingCategory({ productName: productName.trim(), brand: brand.trim() || undefined });
      setCategory({ code: r.code, name: r.name || `카테고리 ${r.code}` });
      setCategoryCodeInput(r.code);
      applyMeta(r.meta);
    } catch (e: any) { alert(e?.message || '카테고리를 찾지 못했습니다.'); } finally { setCategoryBusy(false); }
  };
  const loadMetaByCode = async () => {
    const code = categoryCodeInput.replace(/\D/g, '');
    if (!code) return;
    setCategoryBusy(true);
    try {
      const r = await coupangApi.listingMeta(code);
      setCategory({ code, name: `카테고리 ${code}` });
      applyMeta(r.meta);
    } catch (e: any) { alert(e?.message || '카테고리 정보를 불러오지 못했습니다.'); } finally { setCategoryBusy(false); }
  };

  const returnPlace = useMemo(() => returns.find(r => r.code === settings.returnCenterCode) ?? null, [returns, settings.returnCenterCode]);
  const noticeList = useMemo(() => (meta?.notices ?? []).flatMap(n => n.details.map(d => ({ category: n.name, name: d.name, required: d.required }))), [meta]);
  const patchItem = (id: string, p: Partial<ItemRow>) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...p } : it)));

  const submit = async () => {
    if (submitting) return;
    if (!category) { alert('[카테고리 찾기]를 먼저 눌러주세요.'); return; }
    const missingNotice = noticeList.filter(n => n.required && !String(notices[`${n.category}|${n.name}`] ?? '').trim());
    if (missingNotice.length) { alert(`고시정보가 비었습니다: ${missingNotice.map(n => n.name).join(', ')}\n모르면 "상세페이지 참조"라고 적어도 됩니다.`); return; }
    if (!returnPlace) { alert('기본 설정에서 반품지를 고르세요.'); return; }
    setSubmitting(true);
    try {
      const body = {
        productName: productName.trim(),
        brand: brand.trim(),
        categoryCode: category.code,
        wingUserId: settings.wingUserId,
        outboundCode: settings.outboundCode,
        returnCenter: { code: returnPlace.code, name: returnPlace.name, zip: returnPlace.zip, address: returnPlace.address, addressDetail: returnPlace.addressDetail, phone: returnPlace.phone || settings.afterServicePhone },
        deliveryCompany: settings.deliveryCompany,
        afterServicePhone: settings.afterServicePhone,
        afterServiceInfo: settings.afterServiceInfo,
        images,
        detailImages,
        items: items.map(it => ({
          attributes: useOptions ? Object.fromEntries(optionAttrs.map(a => [a, it.attributes[a] ?? ''])) : {},
          salePrice: Number(it.salePrice), originalPrice: Number(it.originalPrice) || undefined, stock: Number(it.stock),
        })),
        notices: noticeList.map(n => ({ category: n.category, name: n.name, content: notices[`${n.category}|${n.name}`] ?? '' })).filter(n => n.content.trim()),
        searchTags: searchTags.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
        deliveryCharge: Number(deliveryCharge) || 0,
        returnCharge: Number(returnCharge) || 0,
        outboundDays: Number(outboundDays) || 1,
        requestApproval: true,
      };
      const r = await coupangApi.listingCreate(body);
      alert(`쿠팡에 등록 요청했습니다.\n등록상품ID ${r.sellerProductId}\n승인에는 보통 몇 시간~하루가 걸립니다. [등록 내역]에서 상태를 확인하세요.`);
      setProductName(''); setBrand(''); setCategory(null); setCategoryCodeInput(''); setMeta(null); setNotices({}); setItems([emptyItem()]); setImages([]); setDetailImages([]); setSearchTags('');
      void loadRows();
    } catch (e: any) {
      alert(e?.message || '등록 실패');
      void loadRows();
    } finally {
      setSubmitting(false);
    }
  };

  const settingsIncomplete = !settings.wingUserId || !settings.outboundCode || !settings.returnCenterCode || !settings.afterServicePhone;

  return (
    <div className="space-y-5">
      {/* ── 기본 설정 ── */}
      <div className="rounded-card border border-line bg-paper p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-ink">기본 설정 <span className="text-[12px] font-normal text-ink-3">한 번만 저장하면 매번 씁니다</span></p>
            {!showSettings && !settingsLoading && (
              <p className="mt-0.5 text-[12px] text-ink-2">
                {settingsIncomplete ? <span className="text-caution">아직 비어 있습니다 — 등록 전에 채워주세요.</span>
                  : <>윙 ID {settings.wingUserId} · 출고지 {outbound.find(o => o.code === settings.outboundCode)?.name ?? settings.outboundCode} · 반품지 {returnPlace?.name ?? settings.returnCenterCode} · {DELIVERY_COMPANIES.find(d => d.code === settings.deliveryCompany)?.name ?? settings.deliveryCompany}</>}
              </p>
            )}
          </div>
          <button type="button" onClick={() => setShowSettings(v => !v)} className="rounded-control border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong">{showSettings ? '접기' : '수정'}</button>
        </div>
        {settingsErr && <p className="mt-2 text-[12px] text-critical">{settingsErr}</p>}
        {settingsLoading ? <p className="mt-3 inline-flex items-center gap-1 text-[12px] text-ink-3"><Loader2 className="h-3 w-3 animate-spin" /> 윙에서 출고지·반품지를 불러오는 중…</p> : showSettings && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div><label className={labelCls}>윙 로그인 ID *</label><input value={settings.wingUserId} onChange={e => setSettings(s => ({ ...s, wingUserId: e.target.value }))} placeholder="쿠팡 윙에 로그인할 때 쓰는 아이디" className={inputCls} /></div>
            <div><label className={labelCls}>택배사</label>
              <select value={settings.deliveryCompany} onChange={e => setSettings(s => ({ ...s, deliveryCompany: e.target.value }))} className={inputCls}>
                {DELIVERY_COMPANIES.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
              </select></div>
            <div><label className={labelCls}>출고지 *</label>
              <select value={settings.outboundCode} onChange={e => setSettings(s => ({ ...s, outboundCode: e.target.value }))} className={inputCls}>
                <option value="">선택</option>{outbound.map(o => <option key={o.code} value={o.code}>{o.name}{o.usable ? '' : ' (사용 안 함)'}</option>)}
              </select>
              {outbound.length === 0 && <p className="mt-1 text-[11px] text-ink-3">윙 → 판매자정보 → 출고지/반품지 관리에서 먼저 등록하세요.</p>}</div>
            <div><label className={labelCls}>반품지 *</label>
              <select value={settings.returnCenterCode} onChange={e => setSettings(s => ({ ...s, returnCenterCode: e.target.value }))} className={inputCls}>
                <option value="">선택</option>{returns.map(r => <option key={r.code} value={r.code}>{r.name} — {r.address}</option>)}
              </select></div>
            <div><label className={labelCls}>A/S 연락처 *</label><input value={settings.afterServicePhone} onChange={e => setSettings(s => ({ ...s, afterServicePhone: e.target.value }))} placeholder="010-0000-0000" className={inputCls} /></div>
            <div><label className={labelCls}>A/S 안내</label><input value={settings.afterServiceInfo} onChange={e => setSettings(s => ({ ...s, afterServiceInfo: e.target.value }))} placeholder="예: 고객센터 운영 평일 10~17시" className={inputCls} /></div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => void loadSettings()} className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-2 hover:border-line-strong"><RefreshCw className="h-3.5 w-3.5" /> 윙에서 다시 불러오기</button>
              <button type="button" onClick={() => void saveSettings()} disabled={settingsSaving} className="inline-flex items-center gap-1 rounded-control bg-accent px-4 py-2 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-60">{settingsSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장</button>
            </div>
          </div>
        )}
      </div>

      {/* ── 등록 폼 ── */}
      <div className="space-y-4 rounded-card border border-line bg-paper p-4">
        <p className="font-semibold text-ink">새 상품 등록</p>
        <div className="grid gap-3 md:grid-cols-[1fr_200px]">
          <div><label className={labelCls}>상품명 *</label><input value={productName} onChange={e => setProductName(e.target.value)} placeholder="예: 하루한잔 스테인리스 진공 보온텀블러 500ml" className={inputCls} /></div>
          <div><label className={labelCls}>브랜드</label><input value={brand} onChange={e => setBrand(e.target.value)} placeholder="없으면 비워도 됩니다" className={inputCls} /></div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" onClick={() => void findCategory()} disabled={categoryBusy} className="inline-flex items-center gap-1 rounded-control bg-accent px-4 py-2 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-60">
            {categoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 카테고리 찾기
          </button>
          {category && <span className="rounded-full border border-line bg-paper-2 px-3 py-1.5 text-[12px] text-ink">{category.name} <span className="text-ink-3">#{category.code}</span></span>}
          <div className="ml-auto flex items-end gap-1">
            <div><label className="mb-1 block text-[11px] text-ink-3">코드로 직접 지정</label><input value={categoryCodeInput} onChange={e => setCategoryCodeInput(e.target.value)} placeholder="노출 카테고리 코드" className={`${inputCls} w-40`} /></div>
            <button type="button" onClick={() => void loadMetaByCode()} disabled={categoryBusy} className="rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60">적용</button>
          </div>
        </div>

        {meta && (
          <>
            {noticeList.length > 0 && (
              <div>
                <p className={labelCls}>상품 고시정보 <span className="font-normal text-ink-3">(이 카테고리 필수 항목만 · 모르면 "상세페이지 참조")</span></p>
                <div className="grid gap-2 md:grid-cols-2">
                  {noticeList.map(n => (
                    <div key={`${n.category}|${n.name}`} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-[12px] text-ink-2" title={`${n.category} › ${n.name}`}>{n.name}{n.required && <span className="text-critical"> *</span>}</span>
                      <input value={notices[`${n.category}|${n.name}`] ?? ''} onChange={e => setNotices(p => ({ ...p, [`${n.category}|${n.name}`]: e.target.value }))} placeholder="상세페이지 참조" className={inputCls} />
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setNotices(Object.fromEntries(noticeList.map(n => [`${n.category}|${n.name}`, notices[`${n.category}|${n.name}`] || '상세페이지 참조'])))} className="mt-2 text-[11px] text-ink-3 underline hover:text-ink">빈 칸을 전부 "상세페이지 참조"로 채우기</button>
              </div>
            )}

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <p className={`${labelCls} mb-0`}>판매가·재고 *</p>
                <label className="inline-flex items-center gap-1 text-[12px] text-ink-2"><input type="checkbox" checked={useOptions} onChange={e => setUseOptions(e.target.checked)} disabled={!meta.allowSingleItem} /> 옵션 있음 (색상·사이즈 등)</label>
                {useOptions && (
                  <select value="" onChange={e => { if (e.target.value && !optionAttrs.includes(e.target.value)) setOptionAttrs(p => [...p, e.target.value]); }} className={`${inputCls} w-auto py-1 text-[12px]`}>
                    <option value="">옵션 항목 추가…</option>
                    {meta.attributes.filter(a => !optionAttrs.includes(a.name)).map(a => <option key={a.name} value={a.name}>{a.name}{a.required ? ' (필수)' : ''}</option>)}
                  </select>
                )}
              </div>
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-paper-2 text-[11px] uppercase text-ink-3"><tr>
                    {useOptions && optionAttrs.map(a => <th key={a} className="px-3 py-2 text-left">{a} <button type="button" onClick={() => setOptionAttrs(p => p.filter(x => x !== a))} className="text-ink-3 hover:text-critical">×</button></th>)}
                    <th className="px-3 py-2 text-right">판매가 *</th><th className="px-3 py-2 text-right">정가(할인 전)</th><th className="px-3 py-2 text-right">재고 *</th><th className="px-2 py-2" />
                  </tr></thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} className="border-t border-line">
                        {useOptions && optionAttrs.map(a => <td key={a} className="px-2 py-1.5"><input value={it.attributes[a] ?? ''} onChange={e => patchItem(it.id, { attributes: { ...it.attributes, [a]: e.target.value } })} placeholder={a} className={`${inputCls} py-1.5`} /></td>)}
                        <td className="px-2 py-1.5"><input inputMode="numeric" value={it.salePrice} onChange={e => patchItem(it.id, { salePrice: e.target.value.replace(/\D/g, '') })} className={`${inputCls} py-1.5 text-right`} /></td>
                        <td className="px-2 py-1.5"><input inputMode="numeric" value={it.originalPrice} onChange={e => patchItem(it.id, { originalPrice: e.target.value.replace(/\D/g, '') })} placeholder="선택" className={`${inputCls} py-1.5 text-right`} /></td>
                        <td className="px-2 py-1.5"><input inputMode="numeric" value={it.stock} onChange={e => patchItem(it.id, { stock: e.target.value.replace(/\D/g, '') })} className={`${inputCls} py-1.5 text-right`} /></td>
                        <td className="px-2 py-1.5 text-right">{items.length > 1 && <button type="button" onClick={() => setItems(p => p.filter(x => x.id !== it.id))} className="text-ink-3 hover:text-critical"><Trash2 className="h-4 w-4" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {useOptions && <button type="button" onClick={() => setItems(p => [...p, { ...emptyItem(), salePrice: p[p.length - 1]?.salePrice ?? '', originalPrice: p[p.length - 1]?.originalPrice ?? '' }])} className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink"><Plus className="h-3.5 w-3.5" /> 옵션 추가</button>}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <ImagePicker label="대표·추가 이미지 *" hint="첫 장이 대표(썸네일). 정사각형 500px 이상, 글자·테두리 없는 것이 승인에 유리합니다." urls={images} onChange={setImages} max={10} />
              <ImagePicker label="상세 이미지 *" hint="위에서 아래 순서대로. 상세페이지 제작에서 받은 파일을 그대로 올리세요." urls={detailImages} onChange={setDetailImages} max={30} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div><label className={labelCls}>배송비 (0이면 무료)</label><input inputMode="numeric" value={deliveryCharge} onChange={e => setDeliveryCharge(e.target.value.replace(/\D/g, ''))} className={inputCls} /></div>
              <div><label className={labelCls}>반품 배송비 (편도)</label><input inputMode="numeric" value={returnCharge} onChange={e => setReturnCharge(e.target.value.replace(/\D/g, ''))} className={inputCls} /></div>
              <div><label className={labelCls}>출고 소요일</label><input inputMode="numeric" value={outboundDays} onChange={e => setOutboundDays(e.target.value.replace(/\D/g, ''))} className={inputCls} /></div>
              <div><label className={labelCls}>검색 태그 (쉼표)</label><input value={searchTags} onChange={e => setSearchTags(e.target.value)} placeholder="텀블러, 보온병, 사무실" className={inputCls} /></div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
              <p className="text-[12px] text-ink-3">등록 요청 후 쿠팡 승인에 보통 몇 시간~하루가 걸립니다. 지금은 판매자 배송(윙) 상품으로 등록됩니다.</p>
              <button type="button" onClick={() => void submit()} disabled={submitting || settingsIncomplete} className="inline-flex shrink-0 items-center gap-2 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} 쿠팡에 등록 요청
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── 등록 내역 ── */}
      <div className="rounded-card border border-line bg-paper p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold text-ink">등록 내역</p>
          <button type="button" onClick={() => void loadRows()} disabled={rowsLoading} className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${rowsLoading ? 'animate-spin' : ''}`} /> 상태 새로고침</button>
        </div>
        {rows.length === 0 ? <p className="text-[12px] text-ink-3">아직 등록한 상품이 없습니다.</p> : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-[11px] uppercase text-ink-3"><tr><th className="px-3 py-2 text-left">상품명</th><th className="px-3 py-2 text-left">등록상품ID</th><th className="px-3 py-2 text-left">상태</th><th className="px-3 py-2 text-left">요청일</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-ink">{r.productName}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{r.sellerProductId ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${/반려|실패|거부/.test(r.status ?? '') ? 'border-critical/35 bg-critical-soft text-critical' : /승인완료|판매중/.test(r.status ?? '') ? 'border-positive/35 bg-positive-soft text-positive' : 'border-line-strong bg-paper-2 text-ink-2'}`}>{r.status ?? '—'}</span>
                      {r.error && <p className="mt-1 max-w-md whitespace-pre-wrap text-[11px] text-critical">{r.error}</p>}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink-3">{String(r.createdAt).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
