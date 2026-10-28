/**
 * 쿠팡 상품 등록 (간단 등록).
 *
 * 윙의 등록 화면은 항목이 수십 개라 처음 파는 사람은 중간에 포기한다. 여기서는
 * 카테고리를 상품명으로 추천받고, 그 카테고리에 꼭 필요한 고시정보·옵션만
 * 묻는다. 출고지·반품지·A/S 같은 것은 기본 설정에 한 번 저장해 두고 재사용한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { coupangApi, type DetailPlanLite, type ListingMeta, type ListingPlace, type ListingReturnPlace, type ListingRow, type ListingSettings } from '../../lib/coupang';
import { renderClothingDetail } from '../../lib/detailTemplate';
import { generateClothingShots } from '../../lib/detailShots';
import { getUser } from '../../lib/auth';

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
  // 관리자 진단 — 어느 엔드포인트 변형이 통과하는지
  const isAdmin = Boolean(getUser()?.isAdmin);
  const [probe, setProbe] = useState<Array<{ label: string; method: string; path: string; query: string; ok: boolean; status: number; error: string }> | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const runProbe = async () => {
    if (probeBusy) return;
    setProbeBusy(true);
    try { setProbe((await coupangApi.listingProbe()).results); } catch (e: any) { alert(e?.message || '진단 실패'); } finally { setProbeBusy(false); }
  };

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
  // 상품 주요 정보 (윙의 같은 이름 구간) — 기본값은 윙 기본값과 같다
  const [manufacturer, setManufacturer] = useState('');
  const [certMode, setCertMode] = useState<'required' | 'detail' | 'none'>('none');
  const [certType, setCertType] = useState('');
  const [certCode, setCertCode] = useState('');
  const [parallelImport, setParallelImport] = useState(false);
  const [adultOnly, setAdultOnly] = useState(false);
  const [maxPerPerson, setMaxPerPerson] = useState('');
  const [saleEnd, setSaleEnd] = useState('');
  const [taxFree, setTaxFree] = useState(false);
  // 사진으로 만든 상품명. 첫 대표 이미지가 올라오면 자동으로 한 번 만들고, 버튼으로 다시 만들 수 있다.
  const [nameBusy, setNameBusy] = useState(false);
  const [nameSuggest, setNameSuggest] = useState<{ candidates: string[]; keywords: string[]; productType: string } | null>(null);
  const nameAutoDone = useRef(false);
  // 상품명 맨 앞에 넣어 둔 브랜드. 브랜드를 나중에 적거나 고쳐도 상품명 앞자리가 따라 바뀐다.
  const appliedBrand = useRef('');
  const changeBrand = (next: string) => {
    setBrand(next);
    const prev = appliedBrand.current.trim();
    const nextTrim = next.trim();
    setProductName(cur => {
      let base = cur;
      if (prev && base.startsWith(prev + ' ')) base = base.slice(prev.length + 1);
      else if (prev && base === prev) base = '';
      if (!base.trim()) return nextTrim && !cur.trim() ? '' : (nextTrim ? nextTrim : '');
      return nextTrim ? `${nextTrim} ${base}` : base;
    });
    appliedBrand.current = nextTrim;
  };
  const [tagBusy, setTagBusy] = useState(false);
  // 자동 연쇄(상품명 → 카테고리 → 검색필터·고시·태그)는 비동기로 이어지므로 최신 값을 ref로 본다
  const latest = useRef({ images: [] as string[], detailImages: [] as string[], meta: null as ListingMeta | null, productName: '', brand: '', optionAttrs: [] as string[], searchTags: '', items: [] as typeof items });
  latest.current = { images, detailImages, meta, productName, brand, optionAttrs, searchTags, items };
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticeNote, setNoticeNote] = useState<string | null>(null);
  const [autoStep, setAutoStep] = useState<string | null>(null);
  // 상세페이지 자동 제작 (의류 템플릿)
  const [dpBusy, setDpBusy] = useState<string | null>(null);
  const [dpPlan, setDpPlan] = useState<DetailPlanLite | null>(null);
  const [dpSections, setDpSections] = useState<string[]>([]);
  const [dpNote, setDpNote] = useState<string | null>(null);
  const dpShots = useRef<string[]>([]); // 생성한 모델컷 — 다시 그리기에서 재사용 (재생성 안 함)
  const [tagNote, setTagNote] = useState<string | null>(null);
  // 검색필터(카테고리 속성) 값. 옵션으로 쓰는 속성은 제외하고 나머지를 채운다.
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterBusy, setFilterBusy] = useState(false);
  const [filterNote, setFilterNote] = useState<string | null>(null);

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

  /** 고시정보 기본값 — 의류 기준. 항목 이름에 맞춰 채우고, 모르는 것은 "상세페이지 참조"(윙의 체크박스와 같은 뜻) */
  const defaultNotices = (m: ListingMeta, f: Record<string, string> = filters): Record<string, string> => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const out: Record<string, string> = {};
    for (const n of m.notices) for (const d of n.details) {
      const name = d.name;
      let v = '상세페이지 참조';
      if (/소재/.test(name)) v = f['소재'] || f['상하의류 소재'] || '상세페이지 참조';
      else if (/^색상/.test(name)) v = '상세페이지 참조';
      else if (/치수|사이즈/.test(name)) v = '상세페이지 참조';
      else if (/제조자|수입자/.test(name)) v = manufacturer.trim() || brand.trim() || '상세페이지 참조';
      else if (/제조국/.test(name)) v = '상세페이지 참조';
      else if (/세탁|취급/.test(name)) v = '세탁기 울코스 또는 손세탁, 표백제 사용 금지, 그늘에서 건조';
      else if (/제조연월|제조년월|제조일/.test(name)) v = ym;
      else if (/품질보증/.test(name)) v = '제품 이상 시 공정거래위원회 고시 소비자분쟁해결기준에 의거 보상합니다.';
      else if (/A\/S|AS|책임자/.test(name)) v = settings.afterServicePhone ? `판매자 ${settings.afterServicePhone}` : '상세페이지 참조';
      out[`${n.name}|${name}`] = v;
    }
    return out;
  };
  const applyMeta = (m: ListingMeta) => {
    setMeta(m);
    setNotices(defaultNotices(m, {}));
    const required = m.attributes.filter(a => a.required).map(a => a.name);
    setOptionAttrs(required);
    setUseOptions(required.length > 0 || !m.allowSingleItem);
    setItems([emptyItem()]);
    setFilters({});
    setFilterNote(null);
    // 사진이 있으면 검색필터를 바로 채운다 — 카테고리마다 항목이 달라 메타가 온 다음에만 가능하다
    if (latest.current.images.length > 0) void fillFilters(m, required);
    if (latest.current.detailImages.length > 0) void fillNotices(m, latest.current.detailImages, required);
  };
  /** 상세페이지 이미지 → 제공고시 + 옵션(색상·사이즈). 읽힌 항목만 덮어쓰고, 옵션은 표가 비어 있을 때만 채운다 */
  const fillNotices = async (m: ListingMeta | null = latest.current.meta, urls: string[] = latest.current.detailImages, attrsForOptions: string[] = latest.current.optionAttrs) => {
    if (!m || urls.length === 0 || noticeBusy) return;
    const names = m.notices.flatMap(n => n.details.map(d => d.name));
    setNoticeBusy(true);
    setNoticeNote(null);
    try {
      const r = await coupangApi.listingNotices({ images: [...urls.slice(0, 8), ...latest.current.images.slice(0, 2)], notices: names, productName: latest.current.productName.trim() || undefined });
      // 고시: 읽힌 값만 덮어쓴다 (항목명 → 키)
      setNotices(prev => {
        const next = { ...prev };
        for (const n of m.notices) for (const d of n.details) {
          const v = r.notices[d.name];
          if (v) next[`${n.name}|${d.name}`] = v;
        }
        return next;
      });
      // 옵션: 색상·사이즈 속성이 옵션 항목이고 표가 비어 있으면 조합으로 채운다
      const colorAttr = attrsForOptions.find(a => /색상|컬러/.test(a));
      const sizeAttr = attrsForOptions.find(a => /사이즈|크기/.test(a));
      const colors = colorAttr ? r.options.colors : [];
      const sizes = sizeAttr ? r.options.sizes : [];
      let optionNote = '';
      if ((colors.length || sizes.length)) {
        setItems(prev => {
          const blank = prev.every(it => !it.salePrice && Object.values(it.attributes).every(v => !v));
          if (!blank) return prev;
          const rows: ItemRow[] = [];
          const cs = colors.length ? colors : [''];
          const ss = sizes.length ? sizes : [''];
          for (const c of cs) for (const sz of ss) {
            const attributes: Record<string, string> = {};
            if (colorAttr && c) attributes[colorAttr] = c;
            if (sizeAttr && sz) attributes[sizeAttr] = sz;
            rows.push({ ...emptyItem(), attributes });
          }
          return rows.slice(0, 60);
        });
        optionNote = ` 옵션 ${colors.length ? `색상 ${colors.length}` : ''}${colors.length && sizes.length ? ' × ' : ''}${sizes.length ? `사이즈 ${sizes.length}` : ''}도 채웠습니다 — 판매가·재고만 적으세요.`;
      }
      setNoticeNote(`상세페이지에서 ${r.filled}/${r.total}개 항목을 읽어 채웠습니다.${optionNote} 나머지는 의류 기본값입니다.`);
    } catch (e: any) {
      setNoticeNote(e?.message || '상세페이지 분석에 실패했습니다.');
    } finally {
      setNoticeBusy(false);
    }
  };
  const fillFilters = async (m: ListingMeta | null = meta, exclude: string[] = optionAttrs) => {
    if (!m || images.length === 0 || filterBusy) return;
    const targets = m.attributes.filter(a => !exclude.includes(a.name)).map(a => ({ name: a.name, dataType: a.dataType, basicUnit: a.basicUnit }));
    if (targets.length === 0) { setFilterNote('이 카테고리는 검색필터 항목이 없습니다.'); return; }
    setFilterBusy(true);
    setFilterNote(null);
    try {
      const r = await coupangApi.listingAttrs({ images: images.slice(0, 3), attributes: targets, productName: productName.trim() || undefined });
      const merged = { ...r.values, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim())) };
      setFilters(merged);
      // 소재가 사진으로 확인됐으면 고시정보의 제품 소재도 같이 채운다 ("상세페이지 참조"로 남아 있을 때만)
      setNotices(prev => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(defaultNotices(m, merged))) if (/소재/.test(k) && (!next[k] || next[k] === '상세페이지 참조')) next[k] = v;
        return next;
      });
      setFilterNote(`사진으로 확인된 ${r.filled}/${r.total}개를 채웠습니다. 나머지는 필수 항목이니 직접 입력해주세요.`);
    } catch (e: any) {
      setFilterNote(e?.message || '검색필터를 채우지 못했습니다.');
    } finally {
      setFilterBusy(false);
    }
  };
  const findCategory = async (name = productName, auto = false): Promise<ListingMeta | null> => {
    if (!name.trim()) { if (!auto) alert('상품명을 먼저 적어주세요.'); return null; }
    setCategoryBusy(true);
    try {
      const r = await coupangApi.listingCategory({ productName: name.trim(), brand: latest.current.brand.trim() || undefined });
      setCategory({ code: r.code, name: r.name || `카테고리 ${r.code}` });
      setCategoryCodeInput(r.code);
      applyMeta(r.meta);
      return r.meta;
    } catch (e: any) {
      if (!auto) alert(e?.message || '카테고리를 찾지 못했습니다.');
      else setAutoStep(`카테고리 자동 추천 실패: ${e?.message || ''} — [카테고리 찾기]를 눌러 주세요`);
      return null;
    } finally { setCategoryBusy(false); }
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
  const suggestName = async (urls = images, auto = false) => {
    if (urls.length === 0 || nameBusy) return;
    if (auto && (nameAutoDone.current || productName.trim())) return;
    setNameBusy(true);
    try {
      const r = await coupangApi.listingProductName({ images: urls.slice(0, 3), brand: brand.trim() || undefined, bundleCount: useOptions ? 0 : items.length });
      nameAutoDone.current = true;
      setProductName(r.name);
      appliedBrand.current = brand.trim() && r.name.startsWith(brand.trim() + ' ') ? brand.trim() : '';
      setNameSuggest({ candidates: r.candidates, keywords: r.keywords, productType: r.productType });
      if (!latest.current.searchTags.trim() && r.keywords.length) setSearchTags(r.keywords.slice(0, 20).join(', '));
      setNameBusy(false);
      if (auto) {
        // 한 번에 끝까지: 카테고리 → (검색필터·고시는 applyMeta가) → 검색 태그 20개
        setAutoStep('카테고리를 찾는 중…');
        const m = await findCategory(r.name, true);
        if (m) {
          setAutoStep('검색 태그를 채우는 중…');
          await fillTags(r.name, r.productType, true);
          setAutoStep(null);
          if (latest.current.detailImages.length === 0) void makeDetailPage(undefined, true);
        }
      }
    } catch (e: any) {
      if (!auto) alert(e?.message || '상품명을 만들지 못했습니다.');
    } finally {
      setNameBusy(false);
    }
  };
  /** 태그 20개 채우기: 상품명·제품 유형에서 시드를 뽑아 쿠팡 자동완성 + 네이버 연관 키워드로 채운다 */
  /** 상세페이지 자동 제작: 기획(AI 1회) → 모델컷 4장 생성(히어로 high + medium 3) → 캔버스 7구간 → 업로드 → 상세페이지 이미지에 첨부 */
  const makeDetailPage = async (planOverride?: DetailPlanLite, auto = false) => {
    const cur = latest.current;
    if (dpBusy) return;
    if (cur.images.length === 0 || !cur.productName.trim()) { if (!auto) alert('대표 이미지와 상품명이 먼저 필요합니다.'); return; }
    try {
      let plan = planOverride ?? null;
      if (!plan) {
        if (!auto) dpShots.current = []; // 문안부터 다시: 모델컷도 새로 만든다

        setDpBusy('문안을 짜는 중…');
        const colorAttr = cur.optionAttrs.find(a => /색상|컬러/.test(a));
        const sizeAttr = cur.optionAttrs.find(a => /사이즈|크기/.test(a));
        const colorsNow = [...new Set(cur.items.map(it => (colorAttr ? it.attributes[colorAttr] : '') || '').filter(Boolean))];
        const sizesNow = [...new Set(cur.items.map(it => (sizeAttr ? it.attributes[sizeAttr] : '') || '').filter(Boolean))];
        const materialNow = Object.entries(notices).find(([k, v]) => /소재/.test(k) && v && v !== '상세페이지 참조')?.[1] || filters['소재'] || '';
        plan = await coupangApi.listingDetailPlan({
          images: cur.images.slice(0, 2), imageCount: cur.images.length, productName: cur.productName.trim(), brand: cur.brand.trim() || undefined,
          filters, colors: colorsNow, sizes: sizesNow, material: materialNow,
        });
        setDpPlan(plan);
      }
      // 모델컷 4장 (히어로 high 1 + medium 3). 이미 만든 게 있으면 다시 쓰고 캔버스만 다시 그린다.
      let shotNote = '';
      if (dpShots.current.length === 0) {
        try {
          const r = await generateClothingShots(plan, cur.productName.trim(), cur.images, setDpBusy);
          dpShots.current = r.shots;
          if (r.failed) shotNote = ` 모델컷 ${r.failed}장은 만들지 못해 올린 사진으로 대신했습니다.`;
        } catch (e: any) {
          shotNote = ` 모델컷 생성에 실패해 올린 사진만으로 만들었습니다 (${e?.message || '오류'}).`;
        }
      }
      setDpBusy('구간을 그리는 중…');
      const colorAttr = cur.optionAttrs.find(a => /색상|컬러/.test(a));
      const colorsNow = [...new Set(cur.items.map(it => (colorAttr ? it.attributes[colorAttr] : '') || '').filter(Boolean))];
      const sections = await renderClothingDetail({
        plan, images: cur.images, shots: dpShots.current, brand: cur.brand.trim(), colors: colorsNow,
        deliveryCharge: Number(deliveryCharge) || 0, returnCharge: Number(returnCharge) || 0, afterServicePhone: settings.afterServicePhone,
      });
      setDpSections(sections);
      setDpBusy(`업로드 중… (0/${sections.length})`);
      const urls: string[] = [];
      for (let i = 0; i < sections.length; i++) {
        const { url } = await coupangApi.listingUpload(sections[i]);
        urls.push(url);
        setDpBusy(`업로드 중… (${i + 1}/${sections.length})`);
      }
      setDetailImages(urls);
      setDpNote(`상세페이지 ${urls.length}구간을 만들어 첨부했습니다.${shotNote} 사이즈표의 치수는 표준값이니 실측값으로 고친 뒤 [다시 그리기]를 누르세요.`);
      // 만든 상세페이지를 읽어 고시·옵션도 채운다 (사이즈표·소재가 이미 그 안에 있다)
      if (latest.current.meta) setTimeout(() => void fillNotices(latest.current.meta, urls), 0);
    } catch (e: any) {
      setDpNote(e?.message || '상세페이지 제작에 실패했습니다.');
      if (!auto) alert(e?.message || '상세페이지 제작에 실패했습니다.');
    } finally {
      setDpBusy(null);
    }
  };
  const patchSizeCell = (ri: number, ci: number, v: string) => setDpPlan(p => {
    if (!p) return p;
    const rows = p.sizeTable.rows.map((r, i) => (i === ri ? { ...r, values: r.values.map((x, j) => (j === ci ? v : x)) } : r));
    return { ...p, sizeTable: { ...p.sizeTable, rows } };
  });
  const fillTags = async (name = latest.current.productName, productType = nameSuggest?.productType ?? '', auto = false) => {
    if (tagBusy) return;
    const current = latest.current.searchTags.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
    if (auto && current.length >= 20) return;
    const seeds: string[] = [];
    if (productType) seeds.push(productType);
    const nameWords = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2);
    if (nameWords.length >= 2) { seeds.push(nameWords.slice(0, 2).join(' ')); seeds.push(nameWords.slice(1, 3).join(' ')); }
    if (nameWords.length >= 1) seeds.push(nameWords[nameWords.length - 1]);
    current.slice(0, 2).forEach(t => seeds.push(t));
    const uniq = [...new Set(seeds.map(s => s.trim()).filter(Boolean))].slice(0, 5);
    if (uniq.length === 0) { if (!auto) alert('상품명을 먼저 적어주세요.'); return; }
    setTagBusy(true);
    setTagNote(null);
    try {
      const r = await coupangApi.listingTagSuggest({ seeds: uniq, exclude: current, limit: Math.max(0, 20 - current.length) });
      const merged = [...current, ...r.tags].slice(0, 20);
      setSearchTags(merged.join(', '));
      setTagNote(`${merged.length}/20개 · 쿠팡 연관 검색어 ${r.sources.coupang}개 + 네이버 검색량 상위 ${r.sources.naver}개 (시드: ${r.seeds.join(', ')})`);
    } catch (e: any) {
      setTagNote(e?.message || '연관 검색어를 가져오지 못했습니다.');
    } finally {
      setTagBusy(false);
    }
  };
  const onImagesChange = (urls: string[]) => {
    setImages(urls);
    if (urls.length > 0 && images.length === 0) void suggestName(urls, true);
  };
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
        filters: Object.fromEntries(Object.entries(filters).filter(([k, v]) => v.trim() && !(useOptions && optionAttrs.includes(k)))),
        searchTags: searchTags.split(/[,\n]/).map(t => t.trim()).filter(Boolean),
        deliveryCharge: Number(deliveryCharge) || 0,
        returnCharge: Number(returnCharge) || 0,
        outboundDays: Number(outboundDays) || 1,
        manufacturer: manufacturer.trim(),
        certification: certMode === 'required' && certType ? { type: certType, code: certCode.trim() } : null,
        certificationNote: certMode === 'detail' ? '상세페이지 별도표기' : '',
        parallelImported: parallelImport,
        adultOnly,
        maximumBuyForPerson: Number(maxPerPerson) || 0,
        saleEndedAt: saleEnd || null,
        taxFree,
        requestApproval: true,
      };
      const r = await coupangApi.listingCreate(body);
      alert(`쿠팡에 등록 요청했습니다.\n등록상품ID ${r.sellerProductId}\n승인에는 보통 몇 시간~하루가 걸립니다. [등록 내역]에서 상태를 확인하세요.`);
      setProductName(''); setBrand(''); setCategory(null); setCategoryCodeInput(''); setMeta(null); setNotices({}); setItems([emptyItem()]); setImages([]); setDetailImages([]); setSearchTags(''); setNameSuggest(null); nameAutoDone.current = false; setFilters({}); setFilterNote(null); appliedBrand.current = ''; setNoticeNote(null); setAutoStep(null); setDpPlan(null); setDpSections([]); setDpNote(null); setManufacturer(''); setCertMode('none'); setCertType(''); setCertCode(''); setParallelImport(false); setAdultOnly(false); setMaxPerPerson(''); setSaleEnd(''); setTaxFree(false);
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
        {isAdmin && (
          <div className="mt-2">
            <button type="button" onClick={() => void runProbe()} disabled={probeBusy} className="inline-flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60">
              {probeBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 관리자 진단: 엔드포인트 변형별 응답
            </button>
            {probe && (
              <div className="mt-2 overflow-x-auto rounded-card border border-line">
                <table className="w-full text-[11px]">
                  <thead className="bg-paper-2 text-ink-3"><tr><th className="px-2 py-1 text-left">호출</th><th className="px-2 py-1 text-left">경로</th><th className="px-2 py-1 text-right">상태</th><th className="px-2 py-1 text-left">응답</th></tr></thead>
                  <tbody>
                    {probe.map(r => (
                      <tr key={r.label} className="border-t border-line">
                        <td className="px-2 py-1 text-ink">{r.label}</td>
                        <td className="px-2 py-1 font-mono text-ink-3">{r.method} {r.path}{r.query ? `?${r.query}` : ''}</td>
                        <td className={`px-2 py-1 text-right font-semibold ${r.ok ? 'text-positive' : 'text-critical'}`}>{r.status}</td>
                        <td className="px-2 py-1 text-ink-2">{r.ok ? 'OK' : r.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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
        <ImagePicker label="대표·추가 이미지 *" hint="첫 장이 대표(썸네일). 올리면 사진을 분석해 훈프로 코칭 기준(강의 자료)의 상품명과 검색어 20개를 자동으로 만듭니다. 정사각형 500px 이상, 글자·테두리 없는 것이 승인에 유리합니다." urls={images} onChange={onImagesChange} max={10} />
        {/* 브랜드를 상품명보다 먼저 — 상품명 맨 앞에 브랜드가 들어가므로 먼저 적어야 자동 생성에 반영된다 */}
        <div className="md:w-72"><label className={labelCls}>브랜드</label><input value={brand} onChange={e => changeBrand(e.target.value)} placeholder="없으면 비워도 됩니다 (상품명 맨 앞에 자동으로 들어갑니다)" className={inputCls} /></div>
        <div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={`${labelCls} mb-0`}>상품명 *</label>
              <button type="button" onClick={() => void suggestName()} disabled={nameBusy || images.length === 0} title={images.length === 0 ? '대표 이미지를 먼저 올리세요' : ''}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
                {nameBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} 사진으로 상품명 {nameSuggest ? '다시 ' : ''}만들기
              </button>
            </div>
            <input value={productName} onChange={e => setProductName(e.target.value)} placeholder={images.length ? (nameBusy ? '사진을 분석하는 중…' : '예: 하루한잔 스테인리스 진공 보온텀블러 500ml') : '대표 이미지를 올리면 자동으로 만들어집니다'} className={inputCls} />
            
            {autoStep && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent"><Loader2 className="h-3 w-3 animate-spin" /> {autoStep}</p>}
            {nameSuggest && (
              <div className="mt-2 space-y-1.5">
                {nameSuggest.candidates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {nameSuggest.candidates.map(c => (
                      <button key={c} type="button" onClick={() => { const b = brand.trim(); const name = b && !c.startsWith(b + ' ') ? `${b} ${c}` : c; setProductName(name); appliedBrand.current = b && name.startsWith(b + ' ') ? b : ''; }} className="rounded-full border border-line bg-paper-2 px-2.5 py-1 text-left text-[11px] text-ink-2 hover:border-line-strong hover:text-ink">{c}</button>
                    ))}
                  </div>
                )}
                {nameSuggest.keywords.length > 0 && <p className="text-[11px] text-ink-3">검색어(태그) {nameSuggest.keywords.length}개를 검색 태그에 넣어 두었습니다 — 성별·계절·제품명을 앞뒤로 붙인 조합형입니다.</p>}
              </div>
            )}
          </div>
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

        {/* 순서는 윙 등록 화면과 같다: 이미지 → 상품명 → 옵션 → 가격 → 상세페이지 → 검색필터 → 주요 정보 → 고시 → 검색 태그 */}
        {meta && (
          <>
            {/* 옵션 · 가격 */}
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <p className={`${labelCls} mb-0`}>옵션 · 판매가 · 재고 *</p>
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

            {/* 상세페이지 자동 제작 */}
            <div className="rounded-card border border-line bg-paper-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold text-ink">상세페이지 자동 제작 <span className="font-normal text-ink-3">(의류 템플릿 · 모델컷 4장 생성 + 올린 사진 · 7구간)</span></p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{dpBusy ? dpBusy : dpNote ?? '대표 이미지로 상품명이 만들어지면 자동으로 제작돼 아래 상세페이지 이미지에 첨부됩니다. 직접 만든 상세페이지가 있으면 아래에서 바꿔 올리세요.'}</p>
                </div>
                <div className="flex gap-2">
                  {dpPlan && <button type="button" onClick={() => void makeDetailPage(dpPlan)} disabled={!!dpBusy} className="rounded-control border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong disabled:opacity-60">다시 그리기</button>}
                  <button type="button" onClick={() => void makeDetailPage()} disabled={!!dpBusy || images.length === 0 || !productName.trim()} className="inline-flex items-center gap-1 rounded-control bg-accent px-3 py-1.5 text-[12px] font-semibold text-black hover:opacity-90 disabled:opacity-60">
                    {dpBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {dpPlan ? '문안부터 다시 만들기' : '상세페이지 만들기'}
                  </button>
                </div>
              </div>
              {dpSections.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {dpSections.map((src, i) => <img key={i} src={src} alt={`구간 ${i + 1}`} className="h-36 w-auto shrink-0 rounded-control border border-line bg-white" />)}
                </div>
              )}
              {dpPlan && (
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold text-ink-2">사이즈표 (cm) — 표준값입니다. 실측값으로 고치고 [다시 그리기]</p>
                  <div className="overflow-x-auto rounded-card border border-line bg-paper">
                    <table className="w-full text-[12px]">
                      <thead className="bg-paper-2 text-ink-3"><tr><th className="px-2 py-1.5 text-left">사이즈</th>{dpPlan.sizeTable.columns.map(c => <th key={c} className="px-2 py-1.5 text-center">{c}</th>)}</tr></thead>
                      <tbody>
                        {dpPlan.sizeTable.rows.map((r, ri) => (
                          <tr key={ri} className="border-t border-line">
                            <td className="px-2 py-1 font-semibold text-ink">{r.size}</td>
                            {dpPlan.sizeTable.columns.map((_, ci) => <td key={ci} className="px-1 py-1"><input value={r.values[ci] ?? ''} onChange={e => patchSizeCell(ri, ci, e.target.value)} className={`${inputCls} py-1 text-center`} /></td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 상세페이지 */}
            <div>
              <ImagePicker label="상세페이지 이미지 *" hint="위에서 아래 순서대로. 상세페이지 제작에서 받은 파일을 그대로 올리세요. 올리면 상세페이지를 읽어 제공고시(소재·치수·제조국·세탁법)와 옵션(색상·사이즈)을 자동으로 채웁니다." urls={detailImages} onChange={(urls) => { setDetailImages(urls); if (urls.length > detailImages.length && latest.current.meta) setTimeout(() => void fillNotices(latest.current.meta, urls), 0); }} max={30} />
              {(noticeBusy || noticeNote) && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-3">{noticeBusy ? <><Loader2 className="h-3 w-3 animate-spin" /> 상세페이지를 읽는 중…</> : noticeNote}</p>}
            </div>

            {/* 검색필터 */}
            {meta.attributes.some(a => !optionAttrs.includes(a.name)) && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className={`${labelCls} mb-0`}>검색필터 <span className="font-normal text-ink-3">(이 카테고리 항목 · 채울수록 필터 검색에 더 잡힙니다)</span></p>
                  <button type="button" onClick={() => void fillFilters()} disabled={filterBusy || images.length === 0} title={images.length === 0 ? '대표 이미지를 먼저 올리세요' : ''}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
                    {filterBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} 사진으로 채우기
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  {meta.attributes.filter(a => !optionAttrs.includes(a.name)).map(a => (
                    <div key={a.name} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-[12px] text-ink-2" title={a.name}>{a.name}{a.basicUnit ? <span className="text-ink-3"> ({a.basicUnit})</span> : null}</span>
                      <input value={filters[a.name] ?? ''} onChange={e => setFilters(p => ({ ...p, [a.name]: e.target.value }))} placeholder="필수라 입력해주세요" className={`${inputCls} py-1.5`} />
                    </div>
                  ))}
                </div>
                {filterNote && <p className="mt-1 text-[11px] text-ink-3">{filterNote}</p>}
              </div>
            )}

            {/* 상품 주요 정보 */}
            <div>
              <p className={labelCls}>상품 주요 정보</p>
              <div className="divide-y divide-line rounded-card border border-line">
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">제조사</span>
                  <input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="제조사를 알 수 없는 경우 브랜드명을 입력해주세요." className={`${inputCls} py-1.5`} />
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">상품 구성</span>
                  <span className="text-[12px] text-ink-3">동일한 상품으로 구성됨 (혼합 구성은 윙에서 등록)</span>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">인증정보</span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-4 text-[12px] text-ink">
                      {([['required', '인증·신고 대상'], ['detail', '상세페이지 별도표기'], ['none', '인증·신고 대상 아님']] as const).map(([v, l]) => (
                        <label key={v} className="inline-flex items-center gap-1"><input type="radio" name="cert" checked={certMode === v} onChange={() => setCertMode(v)} /> {l}</label>
                      ))}
                    </div>
                    {certMode === 'required' && (
                      <div className="flex flex-wrap gap-2">
                        <select value={certType} onChange={e => setCertType(e.target.value)} className={`${inputCls} w-auto min-w-56 py-1.5`}>
                          <option value="">인증 종류 선택</option>
                          {meta.certifications.map(c => <option key={c.type} value={c.type}>{c.name || c.type}{c.required ? ' (필수)' : ''}</option>)}
                          {meta.certifications.length === 0 && <option value="KC">KC 인증</option>}
                        </select>
                        <input value={certCode} onChange={e => setCertCode(e.target.value)} placeholder="인증번호" className={`${inputCls} w-56 py-1.5`} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">병행수입</span>
                  <div className="flex gap-4 text-[12px] text-ink">
                    <label className="inline-flex items-center gap-1"><input type="radio" name="parallel" checked={parallelImport} onChange={() => setParallelImport(true)} /> 병행수입</label>
                    <label className="inline-flex items-center gap-1"><input type="radio" name="parallel" checked={!parallelImport} onChange={() => setParallelImport(false)} /> 병행수입 아님</label>
                  </div>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">구매 연령</span>
                  <div className="flex gap-4 text-[12px] text-ink">
                    <label className="inline-flex items-center gap-1"><input type="radio" name="adult" checked={!adultOnly} onChange={() => setAdultOnly(false)} /> 전체 연령</label>
                    <label className="inline-flex items-center gap-1"><input type="radio" name="adult" checked={adultOnly} onChange={() => setAdultOnly(true)} /> 성인 전용 (19세 이상)</label>
                  </div>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">인당 최대구매수량</span>
                  <div className="flex flex-wrap items-center gap-4 text-[12px] text-ink">
                    <label className="inline-flex items-center gap-1"><input type="radio" name="maxp" checked={!!maxPerPerson} onChange={() => setMaxPerPerson(maxPerPerson || '1')} /> 설정함</label>
                    <label className="inline-flex items-center gap-1"><input type="radio" name="maxp" checked={!maxPerPerson} onChange={() => setMaxPerPerson('')} /> 설정안함</label>
                    {maxPerPerson && <input inputMode="numeric" value={maxPerPerson} onChange={e => setMaxPerPerson(e.target.value.replace(/\D/g, ''))} className={`${inputCls} w-24 py-1.5`} />}
                  </div>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">판매기간</span>
                  <div className="flex flex-wrap items-center gap-4 text-[12px] text-ink">
                    <label className="inline-flex items-center gap-1"><input type="radio" name="period" checked={!!saleEnd} onChange={() => setSaleEnd(saleEnd || new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10))} /> 설정함</label>
                    <label className="inline-flex items-center gap-1"><input type="radio" name="period" checked={!saleEnd} onChange={() => setSaleEnd('')} /> 설정안함</label>
                    {saleEnd && <span className="inline-flex items-center gap-1">종료일 <input type="date" value={saleEnd} onChange={e => setSaleEnd(e.target.value)} className={`${inputCls} w-auto py-1.5`} /></span>}
                  </div>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">부가세</span>
                  <div className="flex gap-4 text-[12px] text-ink">
                    <label className="inline-flex items-center gap-1"><input type="radio" name="tax" checked={!taxFree} onChange={() => setTaxFree(false)} /> 과세</label>
                    <label className="inline-flex items-center gap-1"><input type="radio" name="tax" checked={taxFree} onChange={() => setTaxFree(true)} /> 면세</label>
                  </div>
                </div>
                <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[140px_1fr] md:items-center">
                  <span className="text-[12px] text-ink-2">배송 · 반품</span>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="text-[11px] text-ink-3">배송비 (0이면 무료)<input inputMode="numeric" value={deliveryCharge} onChange={e => setDeliveryCharge(e.target.value.replace(/\D/g, ''))} className={`${inputCls} mt-0.5 py-1.5`} /></label>
                    <label className="text-[11px] text-ink-3">반품 배송비 (편도)<input inputMode="numeric" value={returnCharge} onChange={e => setReturnCharge(e.target.value.replace(/\D/g, ''))} className={`${inputCls} mt-0.5 py-1.5`} /></label>
                    <label className="text-[11px] text-ink-3">출고 소요일<input inputMode="numeric" value={outboundDays} onChange={e => setOutboundDays(e.target.value.replace(/\D/g, ''))} className={`${inputCls} mt-0.5 py-1.5`} /></label>
                  </div>
                </div>
              </div>
            </div>

            {/* 상품정보 제공고시 */}
            {noticeList.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className={`${labelCls} mb-0`}>상품정보 제공고시 <span className="font-normal text-ink-3">(상세페이지에서 읽은 값 + 의류 기준 기본값)</span></p>
                  <button type="button" onClick={() => void fillNotices()} disabled={noticeBusy || detailImages.length === 0} title={detailImages.length === 0 ? '상세페이지 이미지를 먼저 올리세요' : ''}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
                    {noticeBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} 상세페이지로 다시 채우기
                  </button>
                </div>
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

            {/* 검색 태그 */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={`${labelCls} mb-0`}>검색 태그 <span className="font-normal text-ink-3">(쉼표 구분 · {searchTags.split(/[,\n]/).map(t => t.trim()).filter(Boolean).length}/20개)</span></label>
                <button type="button" onClick={() => void fillTags()} disabled={tagBusy}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
                  {tagBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} 쿠팡 연관 검색어로 20개 채우기
                </button>
              </div>
              <textarea value={searchTags} onChange={e => setSearchTags(e.target.value)} rows={3} placeholder="남자 니트, 남자 니트 가을, 남자 가을 니트 라운드 …" className={inputCls} />
              <p className="mt-1 text-[11px] text-ink-3">{tagNote ?? '쿠팡 검색창의 연관 검색어(소비자가 실제로 치는 조합)를 긁어 와 채웁니다. 이미 적은 태그는 그대로 두고 빈 자리만 채웁니다.'}</p>
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
