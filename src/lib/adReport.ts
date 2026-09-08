/**
 * 광고 보고서 파일(엑셀·CSV) → 행 목록.
 *
 * [광고 성과 분석]의 파일 업로드와 광고센터 북마클릿이 같은 파일을 받는다.
 * 파싱을 한 곳에 두어야 한쪽에서 고친 인코딩 처리가 다른 쪽에서 빠지지 않는다.
 */
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

/** 앞 두 바이트가 'PK'면 zip 계열(xlsx)이다 */
function looksLikeZip(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf.slice(0, 2));
  return b[0] === 0x50 && b[1] === 0x4b;
}

export function parseAdReportBuffer(buf: ArrayBuffer, hint?: { filename?: string; contentType?: string }): any[] {
  const name = String(hint?.filename ?? '').toLowerCase();
  const isCsv = name.endsWith('.csv') || (!looksLikeZip(buf) && /csv|text\/plain/i.test(hint?.contentType ?? ''));

  if (isCsv || (!looksLikeZip(buf) && !name.endsWith('.xlsx') && !name.endsWith('.xls'))) {
    // 쿠팡 보고서는 EUC-KR로 내려오는 경우가 많다. UTF-8로 읽어 대체문자(U+FFFD)가
    // 섞이면 EUC-KR로 다시 읽는다. BOM이 남으면 첫 열 이름이 "﻿날짜"가 되어
    // 어떤 컬럼 탐지에도 걸리지 않으므로 떼어낸다.
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!looksLikeZip(buf) && !/[,\t;]/.test(text.slice(0, 2000))) {
      // 구분자가 없으면 표가 아니다 — 엑셀로 한 번 더 시도한다
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws) as any[];
    }
    const out = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
    return out.data as any[];
  }

  // cellDates가 없으면 날짜 셀이 45000 같은 시리얼 숫자로 들어와 일자별 광고비를 뽑을 수 없다
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws) as any[];
}
