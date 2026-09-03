import React, { useEffect, useState } from 'react';
import { Building2, Save, Loader2, ExternalLink } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { COMPANY_FIELDS, mergeCompany, type CompanyInfo } from '../../lib/company';

// 관리자 — 사업자 정보 입력 (푸터·이용약관·개인정보처리방침에 자동 반영)

export function CompanyInfoConfig({ showToast }: { showToast: (msg: string) => void }) {
  const [form, setForm] = useState<CompanyInfo>(mergeCompany(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin?action=config', { headers: { Authorization: `Bearer ${getToken()}` } });
        const data = await res.json();
        if (res.ok) {
          // 저장된 값만 폼에 넣고, 미입력 항목은 빈칸으로 두어 자리표시자가 보이게
          const saved = (data.company ?? {}) as Partial<CompanyInfo>;
          const next = { ...mergeCompany(null) };
          for (const f of COMPANY_FIELDS) {
            next[f.key] = typeof saved[f.key] === 'string' ? saved[f.key]! : (isPlaceholder(next[f.key]) ? '' : next[f.key]);
          }
          setForm(next);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin?action=config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ company: form }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || '저장 실패');
      try { localStorage.setItem('hoonpro_company_info', JSON.stringify(form)); } catch { /* 무시 */ }
      setDirty(false);
      showToast('사업자 정보가 저장됐습니다. 푸터·약관·개인정보처리방침에 바로 반영됩니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-16 text-ink-3">불러오는 중...</div>;

  const missing = COMPANY_FIELDS.filter(f => !form[f.key].trim()).map(f => f.label);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="w-5 h-5 text-accent" />
        <h2 className="text-lg font-semibold text-ink">사업자 정보</h2>
      </div>
      <p className="text-sm text-ink-2 mb-5">
        여기 입력한 값이 사이트 하단 푸터와{' '}
        <a href="/terms.html" target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-0.5">이용약관<ExternalLink className="w-3 h-3" /></a>,{' '}
        <a href="/privacy.html" target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-0.5">개인정보처리방침<ExternalLink className="w-3 h-3" /></a>
        의 사업자 표기에 자동으로 들어갑니다. 전자상거래법상 필수 표기 항목이며 토스 빌링 심사에서도 확인합니다.
      </p>

      {missing.length > 0 && (
        <div className="mb-4 rounded-card border border-caution/30 bg-caution-soft px-4 py-3 text-[13px] text-caution">
          아직 비어 있는 항목: {missing.join(', ')} — 비어 있으면 사이트에 <b>[대괄호]</b> 자리표시자가 그대로 노출됩니다.
        </div>
      )}

      <div className="bg-paper rounded-card border border-line p-6 space-y-4">
        {COMPANY_FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-[13px] font-medium text-ink mb-1">{f.label}</label>
            <input
              type="text"
              value={form[f.key]}
              placeholder={f.placeholder}
              onChange={e => { setForm(prev => ({ ...prev, [f.key]: e.target.value })); setDirty(true); }}
              className="w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
            />
            {f.hint && <p className="mt-1 text-[11.5px] text-ink-3">{f.hint}</p>}
          </div>
        ))}

        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="w-full bg-accent hover:bg-accent-hover disabled:bg-line-strong text-paper font-medium py-3 rounded-card flex items-center justify-center gap-2 transition-colors"
        >
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중...</> : <><Save className="w-4 h-4" /> 저장</>}
        </button>
      </div>
    </div>
  );
}

function isPlaceholder(v: string): boolean {
  return v.startsWith('[') && v.endsWith(']');
}
