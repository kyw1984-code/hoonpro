/**
 * 광고 보고서 파일을 읽어 광고비·보고서 원본을 저장한다.
 * 북마클릿이 연 창(AdReportReceiver)과 훈프로 도우미 확장 프로그램이 같이 쓴다.
 */
import { parseAdReportBuffer } from './adReport';
import { extractDailyAdCost, extractItemAdCost } from './adcost';
import { coupangApi } from './coupang';

export interface AdSaveResult { days: number; total: number; estimated: boolean; columns: string[]; rawSaved?: boolean }

export const saveAdReportBuffer = async (buf: ArrayBuffer, from: string, to: string, hint?: { filename?: string; contentType?: string; dateGroup?: string }): Promise<AdSaveResult> => {
    const rows = await parseAdReportBuffer(buf, hint);
    if (rows.length === 0) throw new Error('보고서가 비어 있습니다. 이 기간에 광고 집행이 없었을 수 있습니다.');
    const cols = Object.keys(rows[0] ?? {});

    // 보고서 원본을 그대로 남긴다. 지금까지는 광고비만 뽑고 키워드·노출·클릭·
    // 전환을 버려서, 버튼을 눌러도 광고분석AI 화면은 비어 있었다. 같은 보고서를
    // 파일로 한 번 더 올려야 했다.
    // 실패해도 광고비 저장은 계속한다 — 순이익 반영이 더 중요하다. 다만 실패한
    // 건 화면에 말해 준다. 조용히 넘기면 광고분석AI가 왜 비었는지 알 길이 없다.
    let rawSaved = true;
    try {
      await coupangApi.adReportRawSave({ from, to, columns: cols, rows });
    } catch (e) {
      rawSaved = false;
      console.warn('[광고보고서] 원본 저장 실패 — 광고비만 반영합니다', e);
    }

    const daily = extractDailyAdCost(rows);
    if (daily) {
      // 보고서 안의 날짜가 기준이다. 요청 기간보다 좁을 수 있다(집행 없는 날).
      const r = await coupangApi.adCostSave({ from, to, daily: daily.days, source: 'report', items: extractItemAdCost(rows) ?? [], columns: cols, dateGroup: hint?.dateGroup });
      return { days: r.days, total: r.total, estimated: false, columns: cols, rawSaved };
    }
    // 일자 컬럼이 없으면 합계라도 기간에 나눠 넣는다. 아예 없는 것보다 낫지만 화면에는 '추정'으로 표시되고,
    // 어떤 열이 왔는지 남겨 다음 수정의 단서로 삼는다.
    const costCol = cols.find(c => c.trim() === '광고비');
    if (!costCol) throw new Error(`보고서에 '광고비' 열이 없습니다. (열: ${cols.slice(0, 8).join(', ')})`);
    const total = rows.reduce((n, r) => n + (Number(String(r[costCol] ?? '').replace(/[^0-9.-]/g, '')) || 0), 0);
    const r = await coupangApi.adCostSave({ from, to, total: Math.round(total), columns: cols, dateGroup: hint?.dateGroup });
    return { days: r.days, total: r.total, estimated: true, columns: cols, rawSaved };
};
