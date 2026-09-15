import React, { useState, useMemo, useEffect } from "react";
import { Upload, Save, TrendingUp, X, Loader2 } from "lucide-react";
import { getToken } from "../../lib/auth";
import { coupangApi } from "../../lib/coupang";
import { extractDailyAdCost, extractItemAdCost } from "../../lib/adcost";
import { parseAdReportBuffer } from "../../lib/adReport";
import { AdCenterConnect } from "../AdCenter/AdCenterConnect";
import { computeMargin, optionMarginTable } from "../../lib/marginMath";
// 지면 분류·열 찾기·숫자 읽기는 한 곳에서만 한다. 지금 보고서와 저장본을
// 같은 규칙으로 읽어야 변화가 아닌 것이 변화로 보이지 않는다.
import {
  aggregateKeywords, diffKeywords, detectColumns, isNonSearchPlatform, isSearchPlatform,
  parseNum, normalizeRows, type KeywordDiff,
} from "../../lib/adReportKeywords";
import { AD_OPTION_COLUMNS } from "../../lib/adcost";

// ─── 정밀 분석 ───
const CTR_THRESHOLDS = { VERY_LOW: 0.0003, LOW: 0.0005, MEDIUM: 0.001, HIGH: 0.003 };
const CVR_THRESHOLDS = { VERY_LOW: 0.01, LOW: 0.03, MEDIUM: 0.05, HIGH: 0.10 };
const SCORE_GRADES = { S: { min: 75 }, A: { min: 60 }, B: { min: 45 }, C: { min: 30 } };

function getCTRLevel(ctr: number) {
  if (ctr < CTR_THRESHOLDS.VERY_LOW) return { level: "VERY_LOW", score: (ctr / CTR_THRESHOLDS.VERY_LOW) * 20 };
  if (ctr < CTR_THRESHOLDS.LOW) return { level: "LOW", score: 20 + ((ctr - CTR_THRESHOLDS.VERY_LOW) / (CTR_THRESHOLDS.LOW - CTR_THRESHOLDS.VERY_LOW)) * 20 };
  if (ctr < CTR_THRESHOLDS.MEDIUM) return { level: "MEDIUM", score: 40 + ((ctr - CTR_THRESHOLDS.LOW) / (CTR_THRESHOLDS.MEDIUM - CTR_THRESHOLDS.LOW)) * 20 };
  if (ctr < CTR_THRESHOLDS.HIGH) return { level: "HIGH", score: 60 + ((ctr - CTR_THRESHOLDS.MEDIUM) / (CTR_THRESHOLDS.HIGH - CTR_THRESHOLDS.MEDIUM)) * 20 };
  return { level: "VERY_HIGH", score: Math.min(100, 80 + ((ctr - CTR_THRESHOLDS.HIGH) / CTR_THRESHOLDS.HIGH) * 20) };
}

function getCVRLevel(cvr: number) {
  if (cvr < CVR_THRESHOLDS.VERY_LOW) return { level: "VERY_LOW", score: (cvr / CVR_THRESHOLDS.VERY_LOW) * 20 };
  if (cvr < CVR_THRESHOLDS.LOW) return { level: "LOW", score: 20 + ((cvr - CVR_THRESHOLDS.VERY_LOW) / (CVR_THRESHOLDS.LOW - CVR_THRESHOLDS.VERY_LOW)) * 20 };
  if (cvr < CVR_THRESHOLDS.MEDIUM) return { level: "MEDIUM", score: 40 + ((cvr - CVR_THRESHOLDS.LOW) / (CVR_THRESHOLDS.MEDIUM - CVR_THRESHOLDS.LOW)) * 20 };
  if (cvr < CVR_THRESHOLDS.HIGH) return { level: "HIGH", score: 60 + ((cvr - CVR_THRESHOLDS.MEDIUM) / (CVR_THRESHOLDS.HIGH - CVR_THRESHOLDS.MEDIUM)) * 20 };
  return { level: "VERY_HIGH", score: Math.min(100, 80 + ((cvr - CVR_THRESHOLDS.HIGH) / CVR_THRESHOLDS.HIGH) * 20) };
}

function getGrade(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= SCORE_GRADES.S.min) return "S";
  if (score >= SCORE_GRADES.A.min) return "A";
  if (score >= SCORE_GRADES.B.min) return "B";
  if (score >= SCORE_GRADES.C.min) return "C";
  return "D";
}

const fmt = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => n.toFixed(2);

/** 내 작업에서 넘겨주는 저장본 id. 탭을 옮기면서 값을 건네는 유일한 통로다 */
export const OPEN_REPORT_KEY = 'hoonpro_open_ad_report';

export function AnalyzerDashboard() {
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0);
  /** 개당 즉시할인쿠폰. 주문금액에서 이걸 빼야 고객이 실제로 낸 돈이 된다 */
  const [couponPerUnit, setCouponPerUnit] = useState<number>(0);
  const [deliveryFee, setDeliveryFee] = useState<number>(3650);
  // 쿠팡 판매수수료 기본값. 요금표 기준 10.8%(부가세 별도)이고 이 칸은
  // 부가세 포함 값을 받으므로 10.8 × 1.1 = 11.88이다.
  //
  // 매출내역 API의 수수료 값으로 실측 요율을 계산해 자동으로 넣는 안을 검토했지만
  // 쓰지 않는다. 같은 계정에서 6.9%로 계산되는데 실제는 10.8%였다. 틀린 요율이
  // 자동으로 들어가면 마진이 실제보다 커 보이고 손익분기 판정이 통째로 어긋난다.
  const [coupangFeeRate, setCoupangFeeRate] = useState<number>(11.88);
  // 반품률과 반품 배송비. 반품률 5%짜리 상품은 100개를 팔아도 95개치 마진만
  // 남고 그 5개에는 배송비까지 나간다. 이걸 빼고 손익분기 ROAS를 잡으면
  // 화면은 흑자인데 통장은 적자다. 쿠팡 연동에서 실측값을 불러온다.
  const [returnRate, setReturnRate] = useState<number>(0);
  const [returnShippingCost, setReturnShippingCost] = useState<number>(0);
  const [targetROAS, setTargetROAS] = useState<number>(300);

  const [rawData, setRawData] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string>("");
  // 쿠팡 연동에서 불러온 옵션별 판매가·원가
  const [presetItems, setPresetItems] = useState<any[] | null>(null);
  const [presetPick, setPresetPick] = useState<string>("");
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetMsg, setPresetMsg] = useState<string>("");
  const [error, setError] = useState<string>("");

  // 고객이 실제로 낸 돈 = 주문금액 − 즉시할인쿠폰.
  // 수수료도 마진도 이 금액이 기준이다. 쿠폰 전 금액으로 계산하면 들어오지도
  // 않은 돈에 수수료를 물리고 마진을 쿠폰만큼 부풀린다.
  const netUnitPrice = Math.max(0, unitPrice - couponPerUnit);
  // 마진 계산은 src/lib/marginMath.ts 한 곳에서만 한다. 화면에 식을 흩어 두면
  // 한 곳만 고쳐지고 같은 화면이 서로 다른 마진을 보여 준다.
  const margin = computeMargin({
    netUnitPrice, unitCost, deliveryFee, feeRate: coupangFeeRate, returnRate, returnShippingCost,
  });
  const totalFeeAmount = margin.fee;
  // 아래 판단(입찰·최대 CPC·키워드 제외)은 전부 반품까지 반영한 마진으로 한다
  const netUnitMargin = margin.netMargin;
  const marginRate = margin.marginRate;
  const breakEvenROAS = margin.breakEvenROAS;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    try {
      // 파싱은 광고센터 북마클릿과 같은 곳(adReport)에서 한다. 제목 줄이 헤더 위에 있는
      // 보고서, EUC-KR, BOM 처리를 한 군데서만 고치면 양쪽에 같이 반영된다.
      const buffer = await file.arrayBuffer();
      setRawData(await parseAdReportBuffer(buffer, { filename: file.name, contentType: file.type }));
    } catch (err: any) {
      setError(`파일 처리 중 오류 발생: ${err.message}`);
    }
  };

  const processedData = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;

    const normalizedData = normalizeRows(rawData);
    const sampleRow = normalizedData[0] || {};
    const cols = detectColumns(sampleRow);
    const colQty = cols.qty;
    if (!colQty) return { error: "판매수량 컬럼을 찾을 수 없습니다." };

    // 실제 전환매출액 컬럼이 있으면 '판매수량 × 입력 판매가' 추정 대신 실측을 쓴다
    const colRevenue = cols.revenue;
    const colRevenue1d = cols.revenue1d;
    const colIndirectRev = cols.indirect;

    const cleanedData = normalizedData.map((row) => ({
      ...row,
      노출수: parseNum(row["노출수"]),
      클릭수: parseNum(row["클릭수"]),
      광고비: parseNum(row["광고비"]),
      [colQty]: parseNum(row[colQty]),
      실측매출: colRevenue ? parseNum(row[colRevenue]) : 0,
      매출1일: colRevenue1d ? parseNum(row[colRevenue1d]) : 0,
      간접매출: colIndirectRev ? parseNum(row[colIndirectRev]) : 0,
    }));

    // 매출 산정 모드: 실측 컬럼이 있으면 실측, 없으면 판매수량 × 입력 판매가
    const revenueMode: "actual" | "estimated" = colRevenue ? "actual" : "estimated";
    const rowRevenue = (row: any) => (revenueMode === "actual" ? row.실측매출 : (row[colQty] || 0) * netUnitPrice);
    // 순이익: 실측 모드에서는 마진율(개당마진 ÷ 판매가)을 실측 매출에 적용해 옵션별 단가 차이를 흡수
    const netMarginRate = netUnitPrice > 0 ? netUnitMargin / netUnitPrice : 0;
    // ── 옵션별 마진 ──
    //
    // 보고서 한 장에 옵션이 여럿 들어 있는 것이 보통인데 마진 계산 칸은 하나다.
    // 3,000원짜리와 30,000원짜리를 같은 마진으로 계산하면 옵션별 순이익이 통째로
    // 틀리고, 그 값으로 키워드를 제외하게 된다. 쿠팡 연동에서 불러온 옵션별
    // 판매가·원가가 있으면 줄마다 제 옵션 값을 쓴다.
    const optMargins = optionMarginTable(presetItems ?? [], coupangFeeRate);
    const optCol = AD_OPTION_COLUMNS.find((c) => c in sampleRow) ?? null;
    const optionIdOf = (row: any) => {
      if (!optCol) return null;
      const v = String(row[optCol] ?? "").replace(/\.0$/, "").trim();
      return /^\d+$/.test(v) ? v : null;
    };
    /** 이 줄에 쓸 마진. 옵션을 못 찾으면 화면에 입력된 값으로 돌아간다 */
    const marginOfRow = (row: any) => {
      const id = optionIdOf(row);
      const m = id ? optMargins.get(id) : undefined;
      return m ?? { netUnitMargin, netMarginRate };
    };
    // 순이익은 줄 단위로 내고 더한다. 합계에 한 번 곱하면 옵션별 마진이 섞이지 않는다.
    const rowProfit = (row: any) => {
      const m = marginOfRow(row);
      const adCost = row["광고비"] || 0;
      return revenueMode === "actual"
        ? rowRevenue(row) * m.netMarginRate - adCost
        : (row[colQty] || 0) * m.netUnitMargin - adCost;
    };

    // 옵션별 마진이 실제로 몇 %에 적용됐는지. 화면에 밝혀야 판매자가
    // '원가를 더 넣으면 정확해진다'는 것을 안다.
    let optionCoveredCost = 0;
    let totalRowCost = 0;
    for (const row of cleanedData) {
      const c = row["광고비"] || 0;
      totalRowCost += c;
      const id = optionIdOf(row);
      if (id && optMargins.has(id)) optionCoveredCost += c;
    }
    const optionMarginCoverage = totalRowCost > 0 ? (optionCoveredCost / totalRowCost) * 100 : 0;

    // 마진 미입력(판매가 0 등) 시: 순이익은 계산 불가로 표시하고,
    // 판정은 쿠팡 셀러 통상 기준선(손익분기 ROAS 300%)으로 폴백해 어긋난 판정을 막는다.
    // 옵션별 마진이 하나라도 있으면 화면 칸이 비어 있어도 순이익을 낼 수 있다.
    const marginProvided = breakEvenROAS > 0 || optMargins.size > 0;
    const effectiveBE = breakEvenROAS > 0 ? breakEvenROAS : 300;

    // ── 지면별 집계 ──
    const placementMap = new Map<string, any>();
    cleanedData.forEach((row) => {
      const p = row["광고 노출 지면"] || "미확인";
      if (!placementMap.has(p)) placementMap.set(p, { 지면: p, 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0, 매출: 0, 순이익: 0 });
      const acc = placementMap.get(p);
      acc.노출수 += row["노출수"] || 0;
      acc.클릭수 += row["클릭수"] || 0;
      acc.광고비 += row["광고비"] || 0;
      acc.판매수량 += row[colQty] || 0;
      acc.매출 += rowRevenue(row);
      acc.순이익 += rowProfit(row);
    });

    const placementSummary = Array.from(placementMap.values()).map((p) => {
      const 실제매출액 = p.매출;
      const 실제ROAS = p.광고비 > 0 ? 실제매출액 / p.광고비 : 0;
      const 클릭률 = p.노출수 > 0 ? p.클릭수 / p.노출수 : 0;
      const 구매전환율 = p.클릭수 > 0 ? p.판매수량 / p.클릭수 : 0;
      const CPC = p.클릭수 > 0 ? p.광고비 / p.클릭수 : 0;
      const 실질순이익 = p.순이익;
      return { ...p, 실제매출액, 실제ROAS, 클릭률, 구매전환율, CPC, 실질순이익 };
    });

    // ── 전체 합계 ──
    const tot = placementSummary.reduce(
      (acc, curr) => { acc.노출수 += curr.노출수; acc.클릭수 += curr.클릭수; acc.광고비 += curr.광고비; acc.판매수량 += curr.판매수량; acc.매출 += curr.실제매출액; acc.순이익 += curr.실질순이익; return acc; },
      { 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0, 매출: 0, 순이익: 0 }
    );
    const totalRevenue = tot.매출;
    const totalRealRoas = tot.광고비 > 0 ? totalRevenue / tot.광고비 : 0;
    const totalProfit = tot.순이익;
    const totalCtr = tot.노출수 > 0 ? tot.클릭수 / tot.노출수 : 0;
    const totalCvr = tot.클릭수 > 0 ? tot.판매수량 / tot.클릭수 : 0;
    const avgCPC = tot.클릭수 > 0 ? tot.광고비 / tot.클릭수 : 0;

    // ── 캠페인별 집계 + 개별 판정 ──
    // 8개 캠페인이 하나로 합산되면 좋은 캠페인이 나쁜 캠페인을 가린다. 캠페인 단위로 잘라서 각각 판정한다.
    let campaignSummary: any[] | null = null;
    if ("캠페인명" in sampleRow) {
      const campMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const c = row["캠페인명"] || "미확인";
        if (!campMap.has(c)) campMap.set(c, { 캠페인: c, 광고유형: row["광고유형"] || "", 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0, 매출: 0, 순이익: 0, 검색광고비: 0, 검색매출: 0, 검색클릭: 0, 비검색광고비: 0, 비검색매출: 0, 비검색클릭: 0 });
        const acc = campMap.get(c);
        acc.노출수 += row["노출수"] || 0; acc.클릭수 += row["클릭수"] || 0;
        acc.광고비 += row["광고비"] || 0; acc.판매수량 += row[colQty] || 0;
        acc.매출 += rowRevenue(row);
        acc.순이익 += rowProfit(row);
        // 목표수익률 레버 판단용: 캠페인 내 검색/비검색 분해
        const area = row["광고 노출 지면"] || "";
        if (isSearchPlatform(area)) { acc.검색광고비 += row["광고비"] || 0; acc.검색매출 += rowRevenue(row); acc.검색클릭 += row["클릭수"] || 0; }
        else if (isNonSearchPlatform(area)) { acc.비검색광고비 += row["광고비"] || 0; acc.비검색매출 += rowRevenue(row); acc.비검색클릭 += row["클릭수"] || 0; }
      });
      campaignSummary = Array.from(campMap.values()).map((c) => {
        const roasPct = c.광고비 > 0 ? (c.매출 / c.광고비) * 100 : 0;
        const ctr = c.노출수 > 0 ? c.클릭수 / c.노출수 : 0;
        const cvr = c.클릭수 > 0 ? c.판매수량 / c.클릭수 : 0;
        const cpc = c.클릭수 > 0 ? c.광고비 / c.클릭수 : 0;
        const 순이익 = c.순이익;
        const 검색ROAS = c.검색광고비 > 0 ? (c.검색매출 / c.검색광고비) * 100 : 0;
        const 비검색ROAS = c.비검색광고비 > 0 ? (c.비검색매출 / c.비검색광고비) * 100 : 0;
        const 검색비중 = c.광고비 > 0 ? (c.검색광고비 / c.광고비) * 100 : 0;
        // 판정: 데이터가 부족한 캠페인을 성급하게 '중단'으로 몰지 않는다
        let verdict: "scale" | "keep" | "fix" | "stop" | "watch";
        if (roasPct >= effectiveBE * 1.3 && c.판매수량 >= 2) verdict = "scale";
        else if (roasPct >= effectiveBE) verdict = "keep";
        else if (c.판매수량 === 0 && c.클릭수 >= 30) verdict = "stop";
        else if (c.클릭수 >= 20) verdict = "fix";
        else verdict = "watch";
        // 추천 세팅: 매출 최적화 캠페인의 실제 레버는 예산·목표수익률 둘뿐.
        // 목표수익률↓ → 입찰 공격적 → 검색 순위·클릭↑(CPC↑) / 목표수익률↑ → 검색 순위↓ → 소진이 비검색으로 이동
        const 검색표본 = c.검색클릭 >= 10;
        const 비검색표본 = c.비검색클릭 >= 10;
        // 목표수익률 % 코칭: 사이드바의 '현재 목표수익률' 입력값을 기준으로 구체적인 숫자를 제안한다.
        // 쿠팡 세팅 단위에 맞춰 50%p 단위로 반올림하고, 손익분기 아래로는 내리지 않는다.
        const cur = targetROAS > 0 ? targetROAS : 0;
        const beFloor = Math.ceil((effectiveBE * 1.1) / 50) * 50;
        const coachDown = (factor: number): string | null => {
          if (cur > 0) {
            const sug = Math.max(Math.floor((cur * factor) / 50) * 50, beFloor);
            return sug < cur ? `${fmt(cur)}%→${fmt(sug)}%` : null; // 이미 손익분기 근처 → 더 내리면 위험
          }
          return `${fmt(beFloor)}%로`;
        };
        const coachUp = (factor: number): string => {
          if (cur > 0) return `${fmt(cur)}%→${fmt(Math.max(Math.ceil((cur * factor) / 50) * 50, cur + 50))}%`;
          return `${fmt(Math.ceil(Math.max(effectiveBE * 1.5, 400) / 50) * 50)}%로`;
        };
        let lever = "";
        if (verdict === "watch") lever = "현 세팅 유지 · 데이터 축적";
        else if (verdict === "stop") lever = "예산 축소/일시중지 → 가격·리뷰·상세 점검";
        else {
          const searchGood = 검색ROAS >= effectiveBE;
          const nonSearchGood = 비검색ROAS >= effectiveBE;
          if (searchGood && nonSearchGood) lever = verdict === "scale" ? "예산 ↑ · 목표수익률 유지" : "세팅 유지";
          else if (searchGood && 비검색표본 && !nonSearchGood) {
            const d = coachDown(0.85);
            lever = d ? `목표수익률 ↓ ${d} → 소진을 검색으로 (검색이 팔림)` : "목표수익률 유지 (손익분기 여유 없음) · 검색이 팔리는 중";
          } else if (!searchGood && 검색표본 && nonSearchGood) lever = `목표수익률 ↑ ${coachUp(1.2)} → 소진을 비검색으로 (비검색이 팔림)`;
          else if (searchGood) {
            const d = coachDown(0.9);
            const move = d ? `목표수익률 ↓ ${d} (검색 확대)` : "목표수익률 유지 (손익분기 여유 없음)";
            lever = verdict === "scale" ? `예산 ↑ · ${move}` : move;
          } else if (nonSearchGood) lever = `목표수익률 ↑ ${coachUp(1.2)} (저단가 비검색 확대)`;
          else lever = `목표수익률 ↑ ${coachUp(1.3)} (CPC 절감) + 제외키워드 정리`;
        }
        return { ...c, roasPct, ctr, cvr, cpc, 순이익, verdict, 검색ROAS, 비검색ROAS, 검색비중, lever };
      }).sort((a, b) => b.광고비 - a.광고비);
    }

    // ── 옵션별 집계 ──
    let productSummary = null;
    if ("광고집행 상품명" in sampleRow) {
      const prodMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const prod = row["광고집행 상품명"] || "미확인";
        if (!prodMap.has(prod)) prodMap.set(prod, { 상품명: prod, 광고비: 0, 판매수량: 0, 노출수: 0, 클릭수: 0, 매출: 0, 순이익: 0 });
        const acc = prodMap.get(prod);
        acc.광고비 += row["광고비"] || 0; acc.판매수량 += row[colQty] || 0;
        acc.노출수 += row["노출수"] || 0; acc.클릭수 += row["클릭수"] || 0;
        acc.매출 += rowRevenue(row);
        acc.순이익 += rowProfit(row);
      });
      productSummary = Array.from(prodMap.values()).map((p) => ({
        ...p,
        실질순이익: p.순이익,
      }));
    }

    // ── 키워드 정밀 분류 (검색 영역) ──
    // 기존 '판매0 & 광고비>0' 단일 필터는 클릭 1개짜리까지 제외 추천하는 성급함이 있었다.
    // 4분류: 스타(확장) / 효율(유지) / 저효율(입찰 하향) / 제외 후보(충분한 클릭에도 전환 0) / 관찰(데이터 부족)
    let badKeywords = null;
    let keywordDiag: any = null;
    if ("키워드" in sampleRow) {
      const kwMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const kw = row["키워드"];
        const platform = row["광고 노출 지면"] || "";
        if (!kw || kw === "-" || !isSearchPlatform(platform)) return;
        if (!kwMap.has(kw)) kwMap.set(kw, { 키워드: kw, 광고비: 0, 클릭수: 0, 노출수: 0, 판매수량: 0, 매출: 0 });
        const acc = kwMap.get(kw);
        acc.광고비 += row["광고비"] || 0; acc.클릭수 += row["클릭수"] || 0;
        acc.노출수 += row["노출수"] || 0; acc.판매수량 += row[colQty] || 0;
        acc.매출 += rowRevenue(row);
      });
      const allKw = Array.from(kwMap.values()).map((k) => ({
        ...k,
        roasPct: k.광고비 > 0 ? (k.매출 / k.광고비) * 100 : 0,
        cpc: k.클릭수 > 0 ? k.광고비 / k.클릭수 : 0,
      }));
      // 제외 판단 기준: 평균 CVR로 '이 정도 클릭이면 1건은 나왔어야 할' 클릭수 (최소 6, 최대 15)
      const expectClicks = totalCvr > 0 ? Math.min(15, Math.max(6, Math.ceil(1.5 / totalCvr))) : 10;
      // 광고비 기준: 한 개 팔았을 때의 마진만큼 쓰고도 0건이면, 팔렸어도 적자였던 키워드
      const drainCostFloor = netUnitMargin > 0 ? Math.max(2000, netUnitMargin) : Math.max(3000, avgCPC * expectClicks);
      const star = allKw.filter((k) => k.매출 > 0 && k.roasPct >= effectiveBE * 1.2).sort((a, b) => b.매출 - a.매출);
      const ok = allKw.filter((k) => k.매출 > 0 && k.roasPct >= effectiveBE && k.roasPct < effectiveBE * 1.2);
      const lowRoas = allKw.filter((k) => k.매출 > 0 && k.roasPct < effectiveBE).sort((a, b) => b.광고비 - a.광고비);
      const drain = allKw.filter((k) => k.판매수량 === 0 && k.광고비 > 0 && (k.클릭수 >= expectClicks || k.광고비 >= drainCostFloor)).sort((a, b) => b.광고비 - a.광고비);
      const drainSet = new Set(drain.map((k) => k.키워드));
      const watch = allKw.filter((k) => k.판매수량 === 0 && k.광고비 > 0 && !drainSet.has(k.키워드)).sort((a, b) => b.광고비 - a.광고비);
      keywordDiag = {
        total: allKw.length, expectClicks,
        star, ok, lowRoas, drain, watch,
        drainCost: drain.reduce((s, k) => s + k.광고비, 0),
        watchCost: watch.reduce((s, k) => s + k.광고비, 0),
        starRevenue: star.reduce((s, k) => s + k.매출, 0),
      };
      badKeywords = drain; // 기존 '제외 키워드 제안' UI와 호환
    }

    // ── 간접 전환 · 어트리뷰션 ──
    const totalIndirect = colIndirectRev ? cleanedData.reduce((s, r) => s + (r.간접매출 || 0), 0) : 0;
    const indirectShare = totalRevenue > 0 && colIndirectRev ? (totalIndirect / totalRevenue) * 100 : null;
    const totalRev1d = colRevenue1d ? cleanedData.reduce((s, r) => s + (r.매출1일 || 0), 0) : null;
    const attributionLag = totalRev1d !== null && totalRev1d > 0 && totalRevenue > totalRev1d * 1.2
      ? ((totalRevenue - totalRev1d) / totalRevenue) * 100
      : null;
    const adTypes = "광고유형" in sampleRow ? Array.from(new Set(cleanedData.map((r) => r["광고유형"]).filter(Boolean))) : [];

    // ── 정밀 분석 ──
    const ctrResult = getCTRLevel(totalCtr);
    const cvrResult = getCVRLevel(totalCvr);

    let roasScore = 0;
    if (breakEvenROAS > 0) {
      const roasRatio = totalRealRoas / breakEvenROAS;
      roasScore = roasRatio >= 2 ? 100 : roasRatio >= 1 ? 50 + (roasRatio - 1) * 50 : roasRatio * 50;
    }

    const industryCPC = 500;
    const cpcRatio = avgCPC / industryCPC;
    const cpcEfficiency = cpcRatio <= 0.5 ? "EXCELLENT" : cpcRatio <= 0.8 ? "GOOD" : cpcRatio <= 1.2 ? "AVERAGE" : "POOR";
    const efficiencyScore = cpcEfficiency === "EXCELLENT" ? 100 : cpcEfficiency === "GOOD" ? 75 : cpcEfficiency === "AVERAGE" ? 50 : 25;

    const totalScore = ctrResult.score * 0.3 + cvrResult.score * 0.3 + roasScore * 0.25 + efficiencyScore * 0.15;
    const grade = getGrade(totalScore);

    // ── 검색/비검색 분리 ──
    const searchData = placementSummary.filter((p) => isSearchPlatform(p.지면))
      .reduce((a, p) => ({ adCost: a.adCost + p.광고비, qty: a.qty + p.판매수량, clicks: a.clicks + p.클릭수, profit: a.profit + p.실질순이익, sales: a.sales + p.실제매출액 }), { adCost: 0, qty: 0, clicks: 0, profit: 0, sales: 0 });
    const nonSearchData = placementSummary.filter((p) => isNonSearchPlatform(p.지면))
      .reduce((a, p) => ({ adCost: a.adCost + p.광고비, qty: a.qty + p.판매수량, clicks: a.clicks + p.클릭수, profit: a.profit + p.실질순이익, sales: a.sales + p.실제매출액 }), { adCost: 0, qty: 0, clicks: 0, profit: 0, sales: 0 });
    const searchROAS = searchData.adCost > 0 ? (searchData.sales / searchData.adCost) * 100 : 0;
    const nonSearchROAS = nonSearchData.adCost > 0 ? (nonSearchData.sales / nonSearchData.adCost) * 100 : 0;
    const searchCPC = searchData.clicks > 0 ? searchData.adCost / searchData.clicks : 0;
    const nonSearchCPC = nonSearchData.clicks > 0 ? nonSearchData.adCost / nonSearchData.clicks : 0;

    // ── 추천사항 생성 ──
    const currentROASPct = totalRealRoas * 100;
    const breakEvenROASPct = breakEvenROAS;
    const recommendations: string[] = [];

    // 1. 목표수익률 조정
    const hasSearch = searchData.adCost > 0;
    const hasNonSearch = nonSearchData.adCost > 0;
    if (breakEvenROASPct > 0 && (hasSearch || hasNonSearch)) {
      if (currentROASPct < breakEvenROASPct) {
        const suggestedTarget = Math.max(Math.ceil(breakEvenROASPct * 1.3 / 50) * 50, Math.ceil((targetROAS + 100) / 50) * 50);
        if (suggestedTarget > targetROAS) {
          recommendations.push(`🔴 [목표수익률 긴급 상향] 현재 ROAS ${fmt(currentROASPct)}%는 손익분기 ${fmt(breakEvenROASPct)}% 미만 적자입니다. 목표수익률을 ${fmt(targetROAS)}% → ${fmt(suggestedTarget)}%로 즉시 상향하세요. CPC가 낮아져 비검색영역에서 저단가 노출로 출혈을 막을 수 있습니다.`);
        } else {
          recommendations.push(`🔴 [적자 — 구조 개선 필요] 현재 목표수익률 ${fmt(targetROAS)}%는 이미 높지만 실제 ROAS ${fmt(currentROASPct)}%로 손익분기에 미치지 못합니다. ① 고비용 키워드 즉시 제외 ② 상세페이지 전환율 개선 ③ 마진/판매가 재검토가 필요합니다.`);
        }
      } else if (hasSearch && hasNonSearch) {
        if (searchData.profit > nonSearchData.profit && searchData.profit > 0) {
          const suggestedTarget = Math.max(Math.floor(targetROAS * 0.85 / 50) * 50, Math.ceil(breakEvenROASPct * 1.2 / 50) * 50);
          if (suggestedTarget < targetROAS) {
            recommendations.push(`🟢 [목표수익률 소폭 하향 → 검색 강화] 검색영역 ROAS ${fmt(searchROAS)}%(순이익 ₩${fmt(searchData.profit)})이 비검색 ROAS ${fmt(nonSearchROAS)}%(순이익 ₩${fmt(nonSearchData.profit)})보다 우수합니다. 목표수익률 ${fmt(targetROAS)}% → ${fmt(suggestedTarget)}%로 낮추면 검색 노출이 증가합니다. 검색 CPC ₩${fmt(searchCPC)}에서 약 20% 상승을 감안하세요.`);
          } else {
            recommendations.push(`✅ [목표수익률 유지] 검색영역 ROAS ${fmt(searchROAS)}%로 효율이 좋습니다. 현재 목표수익률 ${fmt(targetROAS)}%가 균형점이므로 유지하세요.`);
          }
        } else if (nonSearchData.profit > searchData.profit && nonSearchData.profit > 0) {
          const suggestedTarget = Math.min(Math.ceil(targetROAS * 1.2 / 50) * 50, Math.ceil(breakEvenROASPct * 2 / 50) * 50);
          recommendations.push(`🟢 [목표수익률 상향 → 비검색 강화] 비검색영역 ROAS ${fmt(nonSearchROAS)}%(순이익 ₩${fmt(nonSearchData.profit)})이 검색 ROAS ${fmt(searchROAS)}%(순이익 ₩${fmt(searchData.profit)})보다 우수합니다. 목표수익률 ${fmt(targetROAS)}% → ${fmt(suggestedTarget)}%로 상향하면 CPC가 절감되어 비검색영역에 예산이 더 배분됩니다. 비검색 CPC ₩${fmt(nonSearchCPC)}은 검색 CPC ₩${fmt(searchCPC)}보다 저렴합니다.`);
        } else {
          recommendations.push(`✅ [목표수익률 유지] 검색 ROAS ${fmt(searchROAS)}%, 비검색 ROAS ${fmt(nonSearchROAS)}%로 비슷한 성과입니다. 현재 목표수익률 ${fmt(targetROAS)}%를 유지하면서 키워드 최적화로 효율을 높이세요.`);
        }
      }
    }

    // 2. 손익 구조 분석
    if (netUnitMargin > 0) {
      const adCostPerSale = tot.판매수량 > 0 ? tot.광고비 / tot.판매수량 : 0;
      const adCostRatio = netUnitPrice > 0 ? (adCostPerSale / netUnitPrice) * 100 : 0;
      recommendations.push(`💰 [손익 구조] 개당 마진 ₩${fmt(netUnitMargin)} | 판매 1건에 광고비 ₩${fmt(adCostPerSale)} 소요 (판매가의 ${pct(adCostRatio)}%). ${adCostPerSale > netUnitMargin ? `광고비가 마진 초과 — 팔수록 적자입니다. 광고 효율 개선 시급!` : `판매 1건당 순수익 ₩${fmt(netUnitMargin - adCostPerSale)}이 남습니다.`}`);
    }

    // 3. 지면 전략
    if (hasSearch && hasNonSearch) {
      const searchCVR = searchData.clicks > 0 ? (searchData.qty / searchData.clicks) * 100 : 0;
      const nonSearchCVR = nonSearchData.clicks > 0 ? (nonSearchData.qty / nonSearchData.clicks) * 100 : 0;
      if (searchData.profit > 0 && nonSearchData.profit < 0) {
        recommendations.push(`📊 [지면 전략] 검색영역은 순이익 ₩${fmt(searchData.profit)} 흑자, 비검색영역은 ₩${fmt(Math.abs(nonSearchData.profit))} 적자입니다. 비검색 광고비(₩${fmt(nonSearchData.adCost)})를 검색영역으로 전환하면 수익이 크게 개선됩니다.`);
      } else if (nonSearchData.profit > searchData.profit && nonSearchData.profit > 0) {
        recommendations.push(`📊 [지면 전략] 비검색영역이 순이익 ₩${fmt(nonSearchData.profit)}으로 더 효율적입니다. 비검색 예산을 확대하고 검색영역은 키워드 정리 후 효율화하세요.`);
      }
      if (searchCVR > 0 && nonSearchCVR > 0) {
        recommendations.push(`🔍 [전환율 비교] 검색 CVR ${pct(searchCVR)}% vs 비검색 CVR ${pct(nonSearchCVR)}%. ${searchCVR > nonSearchCVR ? `검색영역 전환이 ${pct(searchCVR / nonSearchCVR)}배 높으므로 검색 키워드 최적화에 집중하세요.` : `비검색영역 전환이 더 높습니다. 상품이 탐색형 구매에 적합한 특성을 갖고 있습니다.`}`);
      }
    }

    // 4. CPC 효율
    if (avgCPC > 0 && netUnitMargin > 0) {
      const maxCPC = netUnitMargin * totalCvr;
      if (avgCPC > maxCPC && maxCPC > 0) {
        recommendations.push(`⚠️ [CPC 과다] 평균 CPC ₩${fmt(avgCPC)}은 수익 가능 CPC 상한 ₩${fmt(maxCPC)}을 초과합니다. 고단가 키워드를 정리하여 CPC ₩${fmt(maxCPC)} 이하로 유지하세요.`);
      } else if (maxCPC > 0 && avgCPC <= maxCPC * 0.5) {
        recommendations.push(`✅ [CPC 우수] 평균 CPC ₩${fmt(avgCPC)}은 상한(₩${fmt(maxCPC)}) 대비 여유가 있습니다. 목표수익률을 소폭 낮추면 CPC가 올라가며 검색 노출이 확대됩니다.`);
      }
    }

    // 5. CTR 분석
    const ctrPct = totalCtr * 100;
    if (ctrPct < 0.05) {
      recommendations.push(`📸 [CTR 개선 시급] 클릭률 ${pct(ctrPct)}%로 ${fmt(tot.노출수)}회 노출 중 ${fmt(tot.클릭수)}번만 클릭되었습니다. ① 썸네일 배경을 밝은 색으로 교체하고 상품이 크게 보이도록 조정 ② 대표 이미지를 실사용컷·모델컷으로 변경 ③ 관련 없는 키워드 제외`);
    } else if (ctrPct < 0.1) {
      recommendations.push(`📸 [CTR 개선 권장] 클릭률 ${pct(ctrPct)}%로 평균 수준입니다. 경쟁 상품 대비 썸네일 차별화(모델컷, 사용장면)로 0.1% 이상 달성 시 클릭수가 ${Math.round(0.1 / ctrPct)}배로 증가합니다.`);
    } else {
      recommendations.push(`✅ [CTR 우수] 클릭률 ${pct(ctrPct)}%로 양호합니다. 현재 썸네일을 유지하면서 노출 확대에 집중하세요.`);
    }

    // 6. CVR 분석
    const cvrPct = totalCvr * 100;
    if (cvrPct < 1.0) {
      recommendations.push(`📄 [CVR 개선 시급] 전환율 ${pct(cvrPct)}%로 ${fmt(tot.클릭수)}명 방문 중 ${fmt(tot.판매수량)}건만 구매했습니다. ① 상세페이지 상단 3초 영역에 차별점·후기 배치 ② 리뷰 평점 4.5 이상 유지 ③ 경쟁사 대비 가격이 10% 이상 비싸면 쿠폰 활용 검토`);
    } else if (cvrPct < 3.0) {
      const extraSales = Math.round(tot.클릭수 * 0.01);
      recommendations.push(`📄 [CVR 개선 가능] 전환율 ${pct(cvrPct)}%입니다. 전환율이 1%p 상승하면 약 ${fmt(extraSales)}건 추가 판매 발생 → 순이익 약 ₩${fmt(extraSales * netUnitMargin)} 증가`);
    } else {
      recommendations.push(`✅ [CVR 우수] 전환율 ${pct(cvrPct)}%로 높습니다. 상세페이지 설득력이 우수하니 트래픽 확대에 집중하세요.`);
    }

    // 7. 키워드 낭비 (충분한 클릭에도 전환 0인 '제외 후보'만 집계 — 데이터 부족 키워드는 별도 관찰)
    if (keywordDiag && keywordDiag.drain.length > 0) {
      const wasteRatio = tot.광고비 > 0 ? (keywordDiag.drainCost / tot.광고비) * 100 : 0;
      if (wasteRatio >= 30) {
        recommendations.push(`🔴 [키워드 정리 긴급] 클릭 ${keywordDiag.expectClicks}회 이상에도 판매 0건인 키워드 ${keywordDiag.drain.length}개에 ₩${fmt(keywordDiag.drainCost)}(전체 광고비의 ${pct(wasteRatio)}%)가 낭비 중입니다. 제외 등록 시 월 환산 약 ₩${fmt(Math.round(keywordDiag.drainCost * 30))} 절감됩니다.`);
      } else if (wasteRatio >= 10) {
        recommendations.push(`⚠️ [키워드 정리 권장] 제외 후보 키워드 ${keywordDiag.drain.length}개에 ₩${fmt(keywordDiag.drainCost)}(${pct(wasteRatio)}%)가 소진 중입니다. 아래 '키워드 정밀 진단'의 제외 후보 목록을 복사해 등록하세요.`);
      }
    }

    // 8. 스타 키워드 확장
    if (keywordDiag && keywordDiag.star.length > 0) {
      const top = keywordDiag.star.slice(0, 3).map((k: any) => `'${k.키워드}'(ROAS ${fmt(k.roasPct)}%)`).join(", ");
      recommendations.push(`🌟 [스타 키워드 확장] ${top} 등 ${keywordDiag.star.length}개 키워드가 손익분기를 크게 웃돕니다. 매출 최적화(자동) 캠페인은 키워드별 입찰 조절이 불가하므로, ① 이 키워드들만 수동 캠페인으로 분리해 공격적으로 입찰하거나 ② 자동 캠페인의 목표수익률을 낮춰 검색 노출 자체를 키우는 방식으로 확대하세요.`);
    }

    // 9. 저효율 키워드 입찰 하향
    if (keywordDiag && keywordDiag.lowRoas.length > 0) {
      const top = keywordDiag.lowRoas.slice(0, 3).map((k: any) => `'${k.키워드}'(ROAS ${fmt(k.roasPct)}%, CPC ₩${fmt(k.cpc)})`).join(", ");
      recommendations.push(`🟡 [저효율 키워드] ${top} — 판매는 있지만 손익분기(${fmt(breakEvenROASPct)}%) 미만입니다. 수동 캠페인이라면 입찰가를 20~30% 낮추고, 매출 최적화(자동) 캠페인이라면 키워드별 입찰 조절이 불가하므로 목표수익률을 한 단계(+50%p) 올려 CPC를 줄이거나, 그래도 적자가 지속되면 제외 등록하세요.`);
    }

    // 10. 관찰 키워드 — 성급한 제외 방지
    if (keywordDiag && keywordDiag.watch.length > 0 && keywordDiag.watchCost > 0) {
      recommendations.push(`👀 [판단 보류 키워드] 전환은 없지만 클릭이 ${keywordDiag.expectClicks}회 미만인 키워드 ${keywordDiag.watch.length}개(₩${fmt(keywordDiag.watchCost)})는 아직 데이터가 부족합니다. 지금 제외하면 잠재 키워드를 놓칠 수 있으니 3~7일 더 지켜본 뒤 판단하세요.`);
    }

    // 11. 캠페인별 액션
    if (campaignSummary && campaignSummary.length > 1) {
      const stopList = campaignSummary.filter((c) => c.verdict === "stop");
      const scaleList = campaignSummary.filter((c) => c.verdict === "scale");
      const fixList = campaignSummary.filter((c) => c.verdict === "fix");
      if (stopList.length > 0) {
        recommendations.push(`🛑 [캠페인 중단 검토] ${stopList.map((c) => `'${c.캠페인}'(광고비 ₩${fmt(c.광고비)}, 클릭 ${fmt(c.클릭수)}회, 판매 0)`).join(", ")} — 충분한 클릭에도 전환이 없습니다. 일시중지 후 가격·리뷰·상세페이지를 점검하고 재개하세요.`);
      }
      if (scaleList.length > 0) {
        recommendations.push(`🚀 [예산 확대 대상] ${scaleList.map((c) => `'${c.캠페인}'(ROAS ${fmt(c.roasPct)}%, 순이익 ₩${fmt(c.순이익)})`).join(", ")} — 손익분기를 여유 있게 넘겼습니다. 일예산을 20~30% 늘려 이익 규모를 키우세요.`);
      }
      if (fixList.length > 0) {
        recommendations.push(`🔧 [효율 개선 대상] ${fixList.map((c) => `'${c.캠페인}'(ROAS ${fmt(c.roasPct)}%)`).join(", ")} — 손익분기 미달입니다. 키워드 정리와 목표수익률 상향으로 CPC부터 낮추세요.`);
      }
    }

    // 12. 간접 전환 시너지
    if (indirectShare !== null && indirectShare >= 25) {
      recommendations.push(`🔗 [간접 전환 시너지] 전환매출의 ${pct(indirectShare)}%가 광고 상품이 아닌 다른 옵션/상품에서 발생했습니다. 광고가 스토어 전체 유입을 만들고 있으니, 옵션 구성을 늘리고 연관 상품을 같은 스토어에 배치하면 광고 효율이 배가됩니다.`);
    }

    // 13. 전환 지연 경고
    if (attributionLag !== null) {
      recommendations.push(`⏳ [전환 지연형 상품] 매출의 ${pct(attributionLag)}%가 클릭 다음 날 이후(14일 어트리뷰션)에 발생했습니다. 당일 성과만 보고 키워드를 끄면 실제로는 팔리는 키워드를 죽일 수 있습니다. 최소 7일 누적 데이터로 판단하세요.`);
    }

    // 14-0. 분석 기간이 짧아 키워드 판단이 어려운 경우
    if (keywordDiag && keywordDiag.drain.length === 0 && keywordDiag.watch.length >= 20) {
      recommendations.push(`📅 [기간 짧음 — 키워드 판단 보류] 키워드 대부분(${keywordDiag.watch.length}개)이 클릭 수 부족으로 '판단 보류' 상태입니다. 하루치 보고서로는 제외/확장 판단이 성급해질 수 있으니, 쿠팡윙에서 7~14일 기간으로 보고서를 받아 다시 분석하면 정확한 키워드 진단이 가능합니다.`);
    }

    // 14. 매출 최적화(자동) 캠페인 안내
    if (adTypes.some((t: string) => String(t).includes("매출 최적화"))) {
      recommendations.push(`🤖 [매출 최적화 캠페인 참고] 이 보고서에는 자동(매출 최적화) 캠페인이 포함되어 있습니다. 자동 캠페인은 키워드별 입찰 제어가 제한되므로, 위 제외 키워드는 '제외 키워드 등록'으로, 스타 키워드는 별도 수동 캠페인 분리로 대응하는 것이 정석입니다.`);
    }

    return {
      placementSummary, tot, totalRevenue, totalRealRoas, totalProfit, totalCtr, totalCvr, avgCPC,
      productSummary, badKeywords, recommendations,
      revenueMode, campaignSummary, keywordDiag, indirectShare, attributionLag,
      marginProvided, effectiveBE,
      optionMarginCoverage, optionMarginCount: optMargins.size, hasOptionColumn: Boolean(optCol),
      precision: {
        ctrScore: ctrResult.score, ctrLevel: ctrResult.level,
        cvrScore: cvrResult.score, cvrLevel: cvrResult.level,
        roasScore, efficiencyScore, totalScore, grade,
        cpcEfficiency,
      },
    };
  }, [rawData, unitPrice, couponPerUnit, netUnitPrice, unitCost, deliveryFee, coupangFeeRate, returnRate, returnShippingCost, netUnitMargin, targetROAS, breakEvenROAS, presetItems]);

  // ─── 성과 추이 — 보고서 요약을 저장해 지난 분석 대비 변화를 비교 ────────────
  const [savedReports, setSavedReports] = useState<any[] | null>(null);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportMsg, setReportMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /** 저장할 때 붙이는 이름 — "8월 나시티" 처럼 나중에 알아볼 수 있게 */
  const [reportLabel, setReportLabel] = useState<string>("");
  /** 무엇과 비교할지. 비어 있으면 가장 최근 저장본 */
  const [compareId, setCompareId] = useState<string>("");
  /**
   * 키워드 단위 비교.
   *
   * 합계만 견주면 부족하다. ROAS가 그대로여도 안에서는 스타 키워드 하나가
   * 죽고 다른 하나가 살아난 것일 수 있다. 무엇을 손봐야 하는지는 키워드
   * 단위로만 보인다. 저장본의 원본 줄은 무거워서 목록에 실려 오지 않으므로
   * 누를 때 한 건만 따로 받는다.
   */
  const [kwDiff, setKwDiff] = useState<ReturnType<typeof diffKeywords> | null>(null);
  const [kwDiffFor, setKwDiffFor] = useState<string>("");
  const [kwDiffBusy, setKwDiffBusy] = useState(false);
  const [kwDiffMsg, setKwDiffMsg] = useState<string | null>(null);

  // 광고비를 순이익 화면으로 넘기기 위한 기간. 보고서에 일자 컬럼이 있으면
  // 자동으로 채워지고, 없으면 사용자가 직접 넣는다.
  const adDaily = useMemo(() => extractDailyAdCost(rawData), [rawData]);
  const [adFrom, setAdFrom] = useState("");
  const [adTo, setAdTo] = useState("");
  // rawData가 바뀌면 반드시 다시 판단한다. adDaily만 의존하면 일자 컬럼이 없는
  // 보고서를 올렸을 때 (adDaily === null) 이전 보고서의 기간이 그대로 남고,
  // 서버가 그 기간을 통째로 지우고 총액을 뿌려 정확했던 일자별 값이 사라진다.
  useEffect(() => {
    if (adDaily) { setAdFrom(adDaily.from); setAdTo(adDaily.to); }
    else { setAdFrom(""); setAdTo(""); }
  }, [adDaily, rawData]);

  const usageHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` });

  const loadReports = async () => {
    try {
      const res = await fetch("/api/usage?action=report-list", { method: "POST", headers: usageHeaders(), body: "{}" });
      const data = await res.json();
      setSavedReports(res.ok && Array.isArray(data.reports) ? data.reports : []);
    } catch {
      setSavedReports([]);
    }
  };
  useEffect(() => { loadReports(); }, []);

  /** 쿠팡 연동에서 옵션별 판매가·원가를 가져온다 (수수료율은 건드리지 않는다) */
  const loadMarginPreset = async (opts?: { silent?: boolean }) => {
    setPresetBusy(true);
    if (!opts?.silent) setPresetMsg("");
    try {
      const r = await coupangApi.marginPreset(30);
      const items = r.items ?? [];
      if (items.length === 0) {
        // 화면을 열자마자 자동으로 돈 경우에는 조용히 넘어간다. 쿠팡을 아직
        // 연동하지 않은 사람에게 열자마자 빨간 안내가 뜰 이유가 없다.
        if (!opts?.silent) setPresetMsg("최근 30일 판매 기록이 없습니다. 정산AI에서 쿠팡을 먼저 연동해주세요.");
        setPresetItems([]);
        return;
      }
      setPresetItems(items);
      applyPreset(items[0]);
      setPresetPick(items[0].vendorItemId);
    } catch (e: any) {
      if (!opts?.silent) setPresetMsg(e?.message ?? "불러오지 못했습니다.");
    } finally {
      setPresetBusy(false);
    }
  };

  const applyPreset = (it: any) => {
    if (!it) return;
    setUnitPrice(it.unitPrice || 0);
    setCouponPerUnit(it.couponPerUnit || 0);
    setUnitCost(it.unitCost || 0);
    setDeliveryFee(it.fulfillmentCost || 0);
    setReturnRate(it.returnRate || 0);
    setReturnShippingCost(it.returnShippingCost || 0);
    const net = Math.max(0, (it.unitPrice || 0) - (it.couponPerUnit || 0));
    const parts = [`${it.quantity}개 판매 기준 · 실결제가 ${net.toLocaleString()}원`];
    if (it.returnRate > 0) parts.push(`반품률 ${it.returnRate}%.`);
    // 한두 개 팔린 옵션의 평균가는 쿠폰 한 번에 크게 흔들린다. 그대로 믿으면 안 된다.
    if (it.quantity < 5) parts.push("판매 건수가 적어 평균가가 흔들릴 수 있습니다.");
    if (!it.hasCost) parts.push("원가가 비어 있습니다 — 정산AI [원가 입력]에 넣으면 함께 채워집니다.");
    setPresetMsg(parts.join(" "));
  };

  /** 광고센터 버튼으로 저장해 둔 보고서를 파일 없이 읽는다 */
  const loadSavedAdReport = async () => {
    try {
      const { report } = await coupangApi.adReportRaw();
      if (!report || !report.rows?.length) return false;
      setRawData(report.rows);
      setFileName(`광고센터에서 가져온 보고서 (${report.from} ~ ${report.to}${report.truncated ? " · 일부만" : ""})`);
      return true;
    } catch {
      return false;
    }
  };

  // 파일을 올리지 않았어도 광고센터에서 가져온 보고서가 있으면 그걸로 채운다.
  // 예전에는 버튼을 눌러도 이 화면이 비어 있어서 같은 보고서를 파일로 또 올려야 했다.
  //
  // 내 작업에서 "광고분석AI에서 열기"로 넘어온 경우에는 그 저장본이 우선이다.
  // 사용자가 고른 것이 최근 것보다 먼저다.
  useEffect(() => {
    let requested: string | null = null;
    try {
      requested = sessionStorage.getItem(OPEN_REPORT_KEY);
      if (requested) sessionStorage.removeItem(OPEN_REPORT_KEY);
    } catch { /* 무시 */ }
    if (requested) void openReport(Number(requested));
    else void loadSavedAdReport();
  }, []);

  // 마진 칸도 열릴 때 알아서 채운다. 버튼을 한 번 더 누르게 할 이유가 없다.
  // 이미 값이 들어 있으면 건드리지 않는다 — 사용자가 고쳐 둔 값을 덮으면 안 된다.
  useEffect(() => {
    if (unitPrice > 0) return;
    void loadMarginPreset({ silent: true });
    // 최초 1회만. 의존성에 unitPrice를 넣으면 불러온 직후 다시 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildReportSummary = () => {
    if (!processedData) return null;
    const pd: any = processedData;
    return {
      // 언제 집행한 보고서인지 남긴다. 이게 없으면 저장 목록에 저장 시각만
      // 보여서 8월 것과 9월 것을 구분할 수 없었다.
      from: adFrom || null,
      to: adTo || null,
      label: reportLabel.trim() || null,
      // 어떤 마진 기준으로 계산한 순이익인지도 함께 남긴다 — 기준이 다르면
      // 순이익 비교가 사과와 오렌지가 된다.
      basis: { unitPrice, couponPerUnit, unitCost, deliveryFee, feeRate: coupangFeeRate, returnRate, returnShippingCost },
      grade: pd.precision?.grade ?? null,
      totalCost: Math.round(pd.tot?.광고비 || 0),
      totalRevenue: Math.round(pd.totalRevenue || 0),
      roasPct: Math.round((pd.totalRealRoas || 0) * 1000) / 10,
      totalProfit: pd.marginProvided ? Math.round(pd.totalProfit || 0) : null,
      qty: pd.tot?.판매수량 || 0,
      starCount: pd.keywordDiag?.star?.length ?? null,
      drainCount: pd.keywordDiag?.drain?.length ?? null,
      drainCost: pd.keywordDiag ? Math.round(pd.keywordDiag.drainCost || 0) : null,
    };
  };

  const saveReport = async () => {
    const summary = buildReportSummary();
    if (!summary || reportSaving) return;
    setReportSaving(true);
    setReportMsg(null);
    try {
      const res = await fetch("/api/usage?action=report-save", {
        method: "POST", headers: usageHeaders(),
        // 본문도 함께 보낸다. 요약만 저장하면 나중에 그 분석을 다시 열 수 없다.
        body: JSON.stringify({ action: "report-save", summary, rows: rawData }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setReportMsg({ text: data.error || "저장 실패", ok: false }); return; }

      // 광고비를 날짜별로 남긴다. 이걸 해두면 [정산AI → 순이익] 화면이
      // 조회 기간에 겹치는 날만 합산해 광고비를 자동으로 채운다.
      let adMsg = " 광고비 기간을 넣으면 순이익 화면에도 자동 반영됩니다.";
      let adOk = true;
      if (adFrom && adTo && adFrom <= adTo) {
        try {
          const r = adDaily
            ? await coupangApi.adCostSave({ from: adFrom, to: adTo, daily: adDaily.days, items: extractItemAdCost(rawData) ?? [] })
            : await coupangApi.adCostSave({ from: adFrom, to: adTo, total: Math.round(summary.totalCost) });
          adMsg = adDaily
            ? ` 광고비 ${r.days}일치(${r.total.toLocaleString()}원)가 순이익 화면에 자동 반영됩니다.`
            : ` 광고비 ${r.total.toLocaleString()}원을 ${r.days}일로 나눠 순이익 화면에 반영했습니다.`;
        } catch (e: any) {
          adMsg = ` 다만 광고비 반영은 실패했습니다: ${e.message}`;
          adOk = false;
        }
      }
      // 광고비가 실패했으면 초록색으로 띄우지 않는다. 성공으로 읽고 넘어가면
      // 순이익 화면에 광고비가 빠진 채로 남는다.
      setReportMsg({ text: "저장됐습니다. 아래 목록에서 비교 기준으로 고를 수 있습니다." + adMsg, ok: adOk });
      setReportLabel("");
      loadReports();
    } catch (e: any) {
      setReportMsg({ text: e.message, ok: false });
    } finally {
      setReportSaving(false);
    }
  };

  /**
   * 저장본과 지금을 키워드 단위로 견준다.
   *
   * 두 보고서의 매출 산정 방식이 다르면(한쪽은 실측 전환매출, 한쪽은
   * 판매수량 × 판매가 추정) ROAS를 나란히 놓을 수 없다. 그럴 때는 비교를
   * 내놓지 않고 그 이유를 말한다 — 틀린 비교보다 낫다.
   */
  const runKeywordDiff = async (id: string) => {
    setKwDiffBusy(true);
    setKwDiffMsg(null);
    try {
      const res = await fetch("/api/usage?action=report-get", {
        method: "POST", headers: usageHeaders(),
        body: JSON.stringify({ action: "report-get", id: Number(id) }),
      });
      const data = await res.json();
      if (!res.ok || !data.report?.rows?.length) {
        setKwDiff(null);
        setKwDiffMsg(data.error ?? "이 저장본에는 원본이 없어 키워드까지 견줄 수 없습니다.");
        return;
      }
      const prev = aggregateKeywords(data.report.rows, netUnitPrice);
      const cur = aggregateKeywords(rawData, netUnitPrice);
      if (!prev.hasKeywordColumn || !cur.hasKeywordColumn) {
        setKwDiff(null);
        setKwDiffMsg("두 보고서 중 하나에 키워드 열이 없습니다. 광고센터에서 키워드 보고서로 받아주세요.");
        return;
      }
      if (prev.revenueMode !== cur.revenueMode) {
        setKwDiff(null);
        setKwDiffMsg("두 보고서의 매출 기준이 다릅니다(한쪽은 실측 전환매출, 한쪽은 추정). ROAS를 나란히 놓을 수 없어 비교하지 않습니다.");
        return;
      }
      setKwDiff(diffKeywords(prev.keywords, cur.keywords));
      setKwDiffFor(id);
    } catch (e: any) {
      setKwDiff(null);
      setKwDiffMsg(e?.message ?? "견주지 못했습니다.");
    } finally {
      setKwDiffBusy(false);
    }
  };

  /** 저장해 둔 분석을 다시 연다 */
  const openReport = async (id: number) => {
    setReportMsg(null);
    try {
      const res = await fetch("/api/usage?action=report-get", {
        method: "POST", headers: usageHeaders(),
        body: JSON.stringify({ action: "report-get", id }),
      });
      const data = await res.json();
      if (!res.ok || !data.report?.rows?.length) {
        setReportMsg({ text: data.error ?? "이 보고서는 다시 열 수 없습니다.", ok: false });
        return;
      }
      const sum = data.report.summary ?? {};
      setRawData(data.report.rows);
      setFileName(
        `저장본: ${sum.label ? sum.label + " · " : ""}${sum.from && sum.to ? `${sum.from} ~ ${sum.to}` : new Date(data.report.created_at).toLocaleDateString("ko-KR")}`,
      );
      // 저장 당시의 마진 기준까지 되살린다. 기준이 다르면 순이익이 달라져
      // 같은 보고서인데 다른 숫자가 나온다.
      const b = sum.basis;
      if (b) {
        if (typeof b.unitPrice === "number") setUnitPrice(b.unitPrice);
        if (typeof b.couponPerUnit === "number") setCouponPerUnit(b.couponPerUnit);
        if (typeof b.unitCost === "number") setUnitCost(b.unitCost);
        if (typeof b.deliveryFee === "number") setDeliveryFee(b.deliveryFee);
        if (typeof b.returnRate === "number") setReturnRate(b.returnRate);
        if (typeof b.returnShippingCost === "number") setReturnShippingCost(b.returnShippingCost);
        if (typeof b.feeRate === "number") setCoupangFeeRate(b.feeRate);
      }
      if (sum.from) setAdFrom(sum.from);
      if (sum.to) setAdTo(sum.to);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setReportMsg({ text: e?.message ?? "불러오지 못했습니다.", ok: false });
    }
  };

  const deleteReport = async (id: number) => {
    await fetch("/api/usage?action=report-delete", {
      method: "POST", headers: usageHeaders(),
      body: JSON.stringify({ action: "report-delete", id }),
    }).catch(() => {});
    loadReports();
  };

  // 스타 키워드 → 소싱AI 관심 키워드 원클릭 등록 (매일 자동 추적 대상이 됨)
  const [favAdded, setFavAdded] = useState<Record<string, boolean>>({});

  const addStarToFavorites = async (keyword: string) => {
    if (favAdded[keyword]) return;
    try {
      const params = new URLSearchParams({ type: "favorites", action: "add", keyword });
      const res = await fetch(`/api/sourcing?${params.toString()}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || "등록 실패"); return; }
      setFavAdded(prev => ({ ...prev, [keyword]: true }));
    } catch (e: any) {
      alert(e.message);
    }
  };

  const gradeColor = (g: string) => ({ S: "text-purple-600", A: "text-accent", B: "text-positive", C: "text-caution", D: "text-critical" }[g] || "text-ink-2");
  const gradeBg = (g: string) => ({ S: "bg-purple-50 border-purple-200", A: "bg-accent-soft border-accent-line", B: "bg-positive-soft border-positive/30", C: "bg-caution-soft border-caution/30", D: "bg-critical-soft border-critical/30" }[g] || "bg-paper-2 border-line");
  const gradeEmoji = (g: string) => ({ S: "🏆", A: "🌟", B: "👍", C: "⚠️", D: "🚨" }[g] || "");

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-paper-2 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-paper border-r border-line p-6 flex flex-col h-full overflow-y-auto shrink-0">
        <h2 className="text-lg font-semibold text-ink mb-4">💰 마진 계산 설정</h2>

        {/* 손으로 넣지 않아도 되는 값은 연동에서 가져온다 */}
        <div className="mb-5 rounded-card border border-accent-line bg-accent-soft p-3">
          <button
            onClick={() => loadMarginPreset()}
            disabled={presetBusy}
            className="flex w-full items-center justify-center gap-1.5 rounded-control bg-accent px-3 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {presetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            쿠팡 연동에서 불러오기
          </button>

          {presetItems && presetItems.length > 0 && (
            <select
              value={presetPick}
              onChange={(e) => {
                setPresetPick(e.target.value);
                applyPreset(presetItems.find((i) => i.vendorItemId === e.target.value));
              }}
              className="mt-2 w-full rounded-control border border-line bg-paper px-2 py-1.5 text-[12px] text-ink"
            >
              {presetItems.map((i) => (
                <option key={i.vendorItemId} value={i.vendorItemId}>
                  {(i.optionName || i.productName || i.vendorItemId).slice(0, 30)} · {i.quantity}개 · 실결제 {Math.max(0, i.unitPrice - (i.couponPerUnit || 0)).toLocaleString()}원
                </option>
              ))}
            </select>
          )}

          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
            {presetMsg || "화면을 열면 최근 30일 실제 판매가(쿠폰 할인 후)와 원가를 자동으로 불러옵니다. 다른 상품을 보려면 위에서 고르세요."}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            수수료율은 가져오지 않습니다 — 기본값 11.88%(10.8% + 부가세)를 쓰고,
            카테고리가 다르면 직접 고쳐주세요. 수수료는 쿠폰을 뺀 <b>실결제가</b>에 붙습니다.
            반품률은 같은 기간 반품 접수 수량으로 채우고, 반품 배송비는 정산AI [원가 입력]의 값을 씁니다.
          </p>
        </div>

        <div className="space-y-4">
          {[
            { label: "상품 판매가 (쿠폰 전, 원)", val: unitPrice, set: setUnitPrice, step: "1" },
            { label: "개당 즉시할인쿠폰 (원)", val: couponPerUnit, set: setCouponPerUnit, step: "1" },
            { label: "최종원가(매입가 등) (원)", val: unitCost, set: setUnitCost, step: "1" },
            { label: "로켓그로스 입출고비 (원)", val: deliveryFee, set: setDeliveryFee, step: "1" },
            { label: "쿠팡 수수료 (부가세 포함, %)", val: coupangFeeRate, set: setCoupangFeeRate, step: "0.01" },
            { label: "반품률 (%)", val: returnRate, set: setReturnRate, step: "0.1" },
            { label: "반품 1건 배송비 (원)", val: returnShippingCost, set: setReturnShippingCost, step: "1" },
            { label: "현재 목표수익률 (%)", val: targetROAS, set: setTargetROAS, step: "50" },
          ].map(({ label, val, set, step }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-ink mb-1">{label}</label>
              <input
                type="number" step={step} value={val || ""}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full px-3 py-2 border border-line rounded-control focus:ring-2 focus:ring-accent focus:border-accent outline-none transition-all"
              />
            </div>
          ))}
        </div>
        <div className="mt-6 pt-6 border-t border-line space-y-3">
          <div className="flex justify-between text-sm"><span className="text-ink-2">💳 고객 실결제가:</span><span className="font-semibold text-ink">{netUnitPrice.toLocaleString()}원</span></div>
          <div className="flex justify-between text-sm"><span className="text-ink-2">📦 입출고비 합계:</span><span>{deliveryFee.toLocaleString()}원</span></div>
          <div className="flex justify-between text-sm"><span className="text-ink-2">📊 예상 수수료 ({coupangFeeRate}% · 실결제가 기준):</span><span>{totalFeeAmount.toLocaleString()}원</span></div>
          {margin.returnLoss > 0 && (
            <div className="flex justify-between text-sm"><span className="text-ink-2">↩️ 반품 손실 ({returnRate}% 반영):</span><span className="text-critical">-{margin.returnLoss.toLocaleString()}원</span></div>
          )}
          <div className="flex justify-between text-base font-semibold"><span className="text-ink">💡 개당 예상 마진:</span><span className="text-positive">{netUnitMargin.toLocaleString()}원</span></div>
          {unitPrice > 0 && <div className="flex justify-between text-sm font-semibold"><span>📈 예상 마진율:</span><span className="text-accent">{marginRate.toFixed(1)}%</span></div>}
          {breakEvenROAS > 0 && <div className="flex justify-between text-sm font-semibold"><span>🎯 손익분기 ROAS{margin.returnLoss > 0 ? " (반품 반영)" : ""}:</span><span className="text-orange-600">{breakEvenROAS.toFixed(0)}%</span></div>}
          {netUnitPrice > 0 && netUnitMargin <= 0 && (
            <p className="text-[11.5px] leading-relaxed text-critical">
              개당 마진이 남지 않습니다. 어떤 ROAS로도 광고로는 흑자가 되지 않으니 판매가·원가·쿠폰부터 보셔야 합니다.
            </p>
          )}
          {/* 보고서에 옵션이 여럿이면 위 칸 하나로는 순이익이 맞지 않는다.
              옵션별 원가가 들어와 있는 만큼은 그 옵션 값으로 계산한다. */}
          {processedData && !processedData.error && processedData.hasOptionColumn && (
            processedData.optionMarginCount > 0 ? (
              <p className="rounded-card border border-accent-line bg-accent-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2">
                옵션 <b>{processedData.optionMarginCount}개</b>는 각자의 판매가·원가로 순이익을 계산했습니다
                (광고비 기준 <b>{processedData.optionMarginCoverage.toFixed(0)}%</b>).
                {processedData.optionMarginCoverage < 95 && ' 나머지는 위 칸 값을 씁니다 — 정산AI [원가 입력]에 원가를 더 넣으면 그만큼 정확해집니다.'}
              </p>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                이 보고서에는 옵션이 여럿입니다. 정산AI [원가 입력]에 옵션별 원가를 넣으면 옵션마다 제 마진으로 순이익을 계산합니다
                — 지금은 위 칸 하나를 모든 옵션에 똑같이 적용하고 있습니다.
              </p>
            )
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-[20px] font-semibold text-ink mb-2">📊 쇼크트리 훈프로 쿠팡 광고 성과 분석기</h1>
            <p className="text-ink-2">
              아래 [광고센터 연결]로 버튼 한 번에 가져오거나, 쿠팡 보고서(CSV·XLSX)를 직접 올리면 운영 전략이 자동으로 만들어집니다.
            </p>
          </div>

          {/* File Upload */}
          <div className="mb-8">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-line-strong border-dashed rounded-card cursor-pointer bg-paper hover:bg-paper-2 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 text-ink-3 mb-2" />
                <p className="mb-2 text-sm text-ink-2"><span className="font-semibold">클릭하여 파일 업로드</span> 또는 드래그 앤 드롭</p>
                <p className="text-xs text-ink-2">CSV, XLSX 파일 지원</p>
              </div>
              <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
            </label>
            {fileName && <p className="mt-2 text-sm text-positive font-medium">선택된 파일: {fileName}</p>}
            {error && <p className="mt-2 text-sm text-critical font-medium">{error}</p>}
          </div>

          {/* 광고비만 필요하면 파일을 내려받을 필요가 없다 — 광고센터에서 버튼 하나로 들어온다 */}
          <div className="mb-8">
            <AdCenterConnect compact />
          </div>

          {processedData && !("error" in processedData) && (
            <div className="space-y-8">
              {/* 마진 미입력 안내 */}
              {!processedData.marginProvided && (
                <div className="rounded-card border border-caution/35 bg-caution-soft p-4 text-sm text-caution">
                  <b>왼쪽에 판매가·원가·수수료를 입력하면 순이익과 손익분기 판정이 정확해집니다.</b>{" "}
                  현재는 순이익을 계산할 수 없어 '—'로 표시하고, 판정은 기본 기준(손익분기 ROAS 300%)으로 대신하고 있습니다.
                </div>
              )}

              {/* KPI Cards */}
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-ink">📌 핵심 성과 지표</h3>
                  <span className={`rounded-control border px-2 py-0.5 text-[11px] font-semibold ${
                    processedData.revenueMode === "actual"
                      ? "border-positive/35 bg-positive-soft text-positive"
                      : "border-caution/35 bg-caution-soft text-caution"
                  }`}>
                    {processedData.revenueMode === "actual" ? "보고서 실측 매출 기준" : "판매수량 × 입력 판매가 추정"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: "최종 실질 순이익", value: processedData.marginProvided ? `${Math.round(processedData.totalProfit).toLocaleString()}원` : "—", color: !processedData.marginProvided ? "text-ink-3" : processedData.totalProfit >= 0 ? "text-positive" : "text-critical" },
                    { label: "총 전환매출", value: `${Math.round(processedData.totalRevenue).toLocaleString()}원`, color: "text-ink" },
                    { label: "총 광고비", value: `${processedData.tot.광고비.toLocaleString()}원`, color: "text-ink" },
                    { label: "실제 ROAS", value: `${(processedData.totalRealRoas * 100).toFixed(0)}%`, color: "text-ink" },
                    { label: "총 판매수량", value: `${processedData.tot.판매수량.toLocaleString()}개`, color: "text-ink" },
                    { label: "구매전환율(CVR)", value: `${(processedData.totalCvr * 100).toFixed(2)}%`, color: "text-ink" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-paper p-4 rounded-card border border-line text-center">
                      <p className="text-xs text-ink-2 font-medium mb-1">{label}</p>
                      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
                {(processedData.indirectShare !== null || processedData.attributionLag !== null) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-ink-2">
                    {processedData.indirectShare !== null && (
                      <span className="rounded-control border border-line bg-paper px-2.5 py-1">간접 전환 비중 <b className="text-ink">{processedData.indirectShare.toFixed(0)}%</b></span>
                    )}
                    {processedData.attributionLag !== null && (
                      <span className="rounded-control border border-line bg-paper px-2.5 py-1">익일 이후 전환 <b className="text-ink">{processedData.attributionLag.toFixed(0)}%</b> (전환 지연형)</span>
                    )}
                  </div>
                )}
              </div>

              {/* 캠페인별 성과 */}
              {processedData.campaignSummary && processedData.campaignSummary.length > 1 && (
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-4">🗂️ 캠페인별 성과 판정</h3>
                  <div className="overflow-x-auto border border-line rounded-card">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-ink uppercase bg-paper-2 border-b border-line">
                        <tr>
                          {["캠페인", "판정", "광고비", "매출", "ROAS", "검색 ROAS", "비검색 ROAS", "순이익", "추천 세팅"].map((h) => (
                            <th key={h} className="px-4 py-3 text-right first:text-left last:text-left [&:nth-child(2)]:text-center">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {processedData.campaignSummary.map((c: any, idx: number) => {
                          const V: Record<string, { label: string; cls: string }> = {
                            scale: { label: "확대", cls: "border-positive/35 bg-positive-soft text-positive" },
                            keep: { label: "유지", cls: "border-accent/35 bg-accent-soft text-accent" },
                            fix: { label: "개선", cls: "border-caution/35 bg-caution-soft text-caution" },
                            stop: { label: "중단 검토", cls: "border-critical/35 bg-critical-soft text-critical" },
                            watch: { label: "관찰", cls: "border-line-strong bg-paper-2 text-ink-3" },
                          };
                          const v = V[c.verdict];
                          return (
                            <tr key={idx} className="bg-paper border-b border-line last:border-b-0 hover:bg-paper-2">
                              <td className="px-4 py-3 font-medium text-ink">{c.캠페인}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex rounded-control border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${v.cls}`}>{v.label}</span>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.광고비.toLocaleString()}원</td>
                              <td className="px-4 py-3 text-right tabular-nums">{Math.round(c.매출).toLocaleString()}원</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.roasPct.toFixed(0)}%</td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {c.검색광고비 > 0 ? `${c.검색ROAS.toFixed(0)}%` : "—"}
                                {c.광고비 > 0 && <span className="ml-1 text-[11px] text-ink-3">({c.검색비중.toFixed(0)}%)</span>}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.비검색광고비 > 0 ? `${c.비검색ROAS.toFixed(0)}%` : "—"}</td>
                              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${!processedData.marginProvided ? "text-ink-3" : c.순이익 >= 0 ? "text-positive" : "text-critical"}`}>{processedData.marginProvided ? `${Math.round(c.순이익).toLocaleString()}원` : "—"}</td>
                              <td className="px-4 py-3 text-left text-[12px] font-medium leading-snug text-ink whitespace-nowrap">{c.lever}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-2">
                    판정 기준(손익분기 ROAS {Math.round(processedData.effectiveBE)}%{processedData.marginProvided ? '' : ' — 마진 미입력으로 기본값 적용'}): <b>확대</b> 손익분기×1.3↑ & 판매 2건↑ · <b>유지</b> 손익분기 이상 · <b>개선</b> 미달(클릭 20↑) · <b>중단 검토</b> 클릭 30↑ 판매 0 · <b>관찰</b> 데이터 부족
                  </p>
                  <p className="mt-1 text-[12px] text-ink-2">
                    검색 ROAS 옆 괄호는 광고비 중 검색 지면 비중입니다. <b>추천 세팅</b>의 목표수익률 %는 왼쪽 사이드바의 '현재 목표수익률' 입력값을 기준으로 계산됩니다 — 매출 최적화 캠페인의 조작 레버는 <b>예산</b>과 <b>목표수익률</b> 두 가지뿐이며, 목표수익률을 내리면 검색 노출·클릭이 늘고(CPC↑), 올리면 CPC가 절감되며 소진이 비검색 위주로 이동합니다.
                  </p>
                </div>
              )}

              {/* 종합 등급 */}
              {processedData.precision && (
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-4">🎯 종합 진단 등급</h3>
                  <div className={`border rounded-card p-6 ${gradeBg(processedData.precision.grade)}`}>
                    <div className="flex items-center gap-6 mb-6">
                      <div className="text-center">
                        <div className={`text-6xl font-semibold ${gradeColor(processedData.precision.grade)}`}>
                          {gradeEmoji(processedData.precision.grade)} {processedData.precision.grade}
                        </div>
                        <p className="text-sm text-ink-2 mt-1">종합 점수 {processedData.precision.totalScore.toFixed(1)}점</p>
                      </div>
                      <div className="flex-1 grid grid-cols-4 gap-4">
                        {[
                          { label: "CTR 점수", score: processedData.precision.ctrScore },
                          { label: "CVR 점수", score: processedData.precision.cvrScore },
                          { label: "ROAS 점수", score: processedData.precision.roasScore },
                          { label: "효율 점수", score: processedData.precision.efficiencyScore },
                        ].map(({ label, score }) => (
                          <div key={label} className="text-center">
                            <p className="text-xs text-ink-2 mb-1">{label}</p>
                            <p className="text-lg font-semibold text-ink">{score.toFixed(0)}</p>
                            <div className="w-full bg-line rounded-full h-2 mt-1">
                              <div className="bg-accent h-2 rounded-full" style={{ width: `${Math.min(score, 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 성과 추이 — 지난 보고서 대비 변화 */}
              <div>
                <h3 className="text-lg font-semibold text-ink mb-4">📈 성과 추이 — 지난 보고서와 비교</h3>
                <div className="rounded-card border border-line bg-paper p-5">
                  {(() => {
                    const cur = buildReportSummary();
                    // 비교 기준은 고를 수 있다. 고르지 않았으면 가장 최근 저장본.
                    // 예전에는 늘 최근 것과만 비교돼서 "지난달과 비교"가 불가능했다.
                    const prevRow = savedReports && savedReports.length > 0
                      ? (savedReports.find((r: any) => String(r.id) === compareId) ?? savedReports[0])
                      : null;
                    const prev = prevRow ? prevRow.summary : null;
                    const deltaBadge = (d: number | null, unit: string, goodUp: boolean, digits = 0) => {
                      if (d === null || Math.abs(d) < 0.05) return <span className="text-[11px] text-ink-3">변화 없음</span>;
                      const good = goodUp ? d > 0 : d < 0;
                      return (
                        <span className={`inline-flex items-center rounded-control border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${good ? "border-positive/35 bg-positive-soft text-positive" : "border-critical/35 bg-critical-soft text-critical"}`}>
                          {d > 0 ? "▲" : "▼"} {Math.abs(d).toLocaleString(undefined, { maximumFractionDigits: digits })}{unit}
                        </span>
                      );
                    };
                    const num = (v: any): number | null => (typeof v === "number" ? v : null);
                    return (
                      <>
                        {cur && prev ? (
                          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                            {[
                              { label: "ROAS", cur: `${cur.roasPct.toFixed(0)}%`, d: cur.roasPct - (num(prev.roasPct) ?? cur.roasPct), unit: "%p", goodUp: true, digits: 1 },
                              { label: "광고비", cur: `${cur.totalCost.toLocaleString()}원`, d: cur.totalCost - (num(prev.totalCost) ?? cur.totalCost), unit: "원", goodUp: false },
                              { label: "실질 순이익", cur: cur.totalProfit !== null ? `${cur.totalProfit.toLocaleString()}원` : "—", d: cur.totalProfit !== null && num(prev.totalProfit) !== null ? cur.totalProfit - prev.totalProfit : null, unit: "원", goodUp: true },
                              { label: "제외 후보 키워드", cur: cur.drainCount !== null ? `${cur.drainCount}개` : "—", d: cur.drainCount !== null && num(prev.drainCount) !== null ? cur.drainCount - prev.drainCount : null, unit: "개", goodUp: false },
                            ].map(({ label, cur: cv, d, unit, goodUp, digits }) => (
                              <div key={label} className="rounded-card border border-line bg-paper-2 p-3.5">
                                <p className="text-[11px] font-semibold text-ink-3">{label}</p>
                                <p className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{cv}</p>
                                <div className="mt-1">{deltaBadge(d, unit, goodUp, digits)}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mb-4 text-[13px] text-ink-2">
                            아직 저장된 보고서가 없습니다. 아래 버튼으로 이번 분석을 저장해두면, <b>다음 보고서를 올릴 때 지난번 대비 변화</b>(ROAS·순이익·제외 키워드)가 여기 표시됩니다 — 코칭을 반영한 결과를 데이터로 확인하세요.
                          </p>
                        )}
                        {cur && prev && prevRow && (
                          <div className="mb-4 flex flex-wrap items-center gap-2">
                            <span className="text-[11.5px] text-ink-3">비교 기준</span>
                            <select
                              value={compareId || String(prevRow.id)}
                              onChange={e => setCompareId(e.target.value)}
                              className="rounded-control border border-line bg-paper px-2 py-1 text-[12px] text-ink"
                            >
                              {savedReports!.map((r: any) => (
                                <option key={r.id} value={String(r.id)}>
                                  {r.summary?.label ? `${r.summary.label} · ` : ""}
                                  {r.summary?.from && r.summary?.to ? `${r.summary.from}~${r.summary.to}` : new Date(r.created_at).toLocaleDateString("ko-KR")}
                                  {` · ROAS ${Number(r.summary?.roasPct ?? 0).toFixed(0)}%`}
                                </option>
                              ))}
                            </select>
                            {prevRow.summary?.basis && prevRow.summary.basis.feeRate !== coupangFeeRate && (
                              <span className="text-[11px] text-caution">
                                마진 기준이 다릅니다 (저장 당시 수수료 {prevRow.summary.basis.feeRate}%) — 순이익 비교는 참고만 하세요.
                              </span>
                            )}
                            <button
                              onClick={() => void runKeywordDiff(String(compareId || prevRow.id))}
                              disabled={kwDiffBusy}
                              className="inline-flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 transition-colors hover:border-accent-line hover:text-accent disabled:opacity-50"
                            >
                              {kwDiffBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
                              키워드까지 견주기
                            </button>
                          </div>
                        )}

                        {kwDiffMsg && <p className="mb-4 text-[12px] text-caution">{kwDiffMsg}</p>}
                        {kwDiff && kwDiffFor === String(compareId || (prevRow?.id ?? "")) && (
                          <KeywordDiffPanel diff={kwDiff} />
                        )}
                        {/* 광고비 기간 — 이 값이 순이익 화면의 광고비가 된다.
                            쿠팡은 광고 API를 제공하지 않아 여기서 받는 수밖에 없다. */}
                        <div className="mb-4 rounded-card border border-line bg-paper-2 p-4">
                          <p className="text-[12px] font-semibold text-ink">이 보고서의 광고 집행 기간</p>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">
                            {adDaily
                              ? `보고서에 일자가 있어 ${adDaily.days.length}일치를 날짜별로 저장합니다. 순이익 화면에서 어떤 기간을 보든 그 기간에 맞는 광고비가 자동으로 빠집니다.`
                              : "보고서에 일자 컬럼이 없습니다. 기간을 넣어 주시면 총 광고비를 일수로 나눠 반영합니다. (일자별 보고서를 받으시면 더 정확합니다)"}
                          </p>
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <input type="date" value={adFrom} onChange={e => setAdFrom(e.target.value)}
                              className="rounded-control border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-accent" />
                            <span className="text-[12px] text-ink-3">~</span>
                            <input type="date" value={adTo} onChange={e => setAdTo(e.target.value)}
                              className="rounded-control border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-accent" />
                            {adFrom && adTo && adFrom > adTo && (
                              <span className="text-[11.5px] text-critical">시작일이 종료일보다 뒤입니다.</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                          <input
                            value={reportLabel}
                            onChange={e => setReportLabel(e.target.value.slice(0, 40))}
                            placeholder="이름 (예: 8월 나시티)"
                            className="w-48 rounded-control border border-line bg-paper px-2.5 py-2 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-accent"
                          />
                          <button onClick={saveReport} disabled={reportSaving || !cur}
                            className="flex items-center gap-1.5 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
                            {reportSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            현재 분석 저장
                          </button>
                          {reportMsg && <span className={`text-[12px] ${reportMsg.ok ? "text-positive" : "text-critical"}`}>{reportMsg.text}</span>}
                        </div>

                        {savedReports && savedReports.length > 0 && (
                          <div className="mt-5">
                            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-ink-3">
                              <TrendingUp className="h-3.5 w-3.5" />저장된 보고서 ({savedReports.length})
                            </p>
                            <div className="overflow-x-auto rounded-card border border-line">
                              <table className="w-full text-[13px]">
                                <thead className="bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                                  <tr>
                                    <th className="px-4 py-2 text-left">이름 · 기간</th>
                                    <th className="px-4 py-2 text-center">등급</th>
                                    <th className="px-4 py-2 text-right">광고비</th>
                                    <th className="px-4 py-2 text-right">매출</th>
                                    <th className="px-4 py-2 text-right">ROAS</th>
                                    <th className="px-4 py-2 text-right">순이익</th>
                                    <th className="px-4 py-2 text-right">제외 후보</th>
                                    <th className="px-4 py-2"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {savedReports.map((r: any) => (
                                    <tr key={r.id} className="border-t border-line bg-paper hover:bg-paper-2">
                                      <td className="px-4 py-2 whitespace-nowrap text-ink">
                                        {r.summary?.label && <span className="font-semibold">{r.summary.label}</span>}
                                        {r.summary?.label && <br />}
                                        <span className={r.summary?.label ? "text-[11.5px] text-ink-3" : ""}>
                                          {r.summary?.from && r.summary?.to
                                            ? `${r.summary.from} ~ ${r.summary.to}`
                                            : `${new Date(r.created_at).toLocaleDateString("ko-KR")} 저장`}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2 text-center font-semibold text-ink">{r.summary?.grade ?? "—"}</td>
                                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Number(r.summary?.totalCost ?? 0).toLocaleString()}원</td>
                                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Number(r.summary?.totalRevenue ?? 0).toLocaleString()}원</td>
                                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-ink">{Number(r.summary?.roasPct ?? 0).toFixed(0)}%</td>
                                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${r.summary?.totalProfit === null || r.summary?.totalProfit === undefined ? "text-ink-3" : r.summary.totalProfit >= 0 ? "text-positive" : "text-critical"}`}>
                                        {r.summary?.totalProfit === null || r.summary?.totalProfit === undefined ? "—" : `${Number(r.summary.totalProfit).toLocaleString()}원`}
                                      </td>
                                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">{r.summary?.drainCount ?? "—"}</td>
                                      <td className="px-2 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          {(r.row_count ?? 0) > 0 ? (
                                            <button
                                              onClick={() => openReport(r.id)}
                                              className="rounded-control border border-line px-2 py-1 text-[11.5px] font-semibold text-ink-2 hover:border-accent-line hover:text-accent"
                                            >
                                              열기
                                            </button>
                                          ) : (
                                            <span className="text-[11px] text-ink-3" title="요약만 저장된 옛 기록입니다">요약만</span>
                                          )}
                                          <button onClick={() => deleteReport(r.id)} title="삭제" className="rounded-control p-1 text-ink-3 hover:bg-paper-2 hover:text-critical">
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Placement Table */}
              <div>
                <h3 className="text-lg font-semibold text-ink mb-4">📍 지면별 상세 분석</h3>
                <div className="overflow-x-auto border border-line rounded-card">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-ink uppercase bg-paper-2 border-b border-line">
                      <tr>
                        {["지면","노출수","클릭수","광고비","판매수량","실제매출액","CPC","클릭률(CTR)","구매전환율(CVR)","실제ROAS","실질순이익"].map((h) => (
                          <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {processedData.placementSummary.map((row: any, idx: number) => (
                        <tr key={idx} className="bg-paper border-b border-line hover:bg-paper-2">
                          <td className="px-4 py-3 font-medium text-ink">{row.지면}</td>
                          <td className="px-4 py-3 text-right">{row.노출수.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{row.클릭수.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{row.광고비.toLocaleString()}원</td>
                          <td className="px-4 py-3 text-right">{row.판매수량.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{row.실제매출액.toLocaleString()}원</td>
                          <td className="px-4 py-3 text-right">{row.CPC.toFixed(0)}원</td>
                          <td className="px-4 py-3 text-right">{(row.클릭률 * 100).toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right">{(row.구매전환율 * 100).toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right">{(row.실제ROAS * 100).toFixed(0)}%</td>
                          <td className={`px-4 py-3 text-right font-semibold tabular-nums ${!processedData.marginProvided ? "text-ink-3" : row.실질순이익 >= 0 ? "text-positive" : "text-critical"}`}>{processedData.marginProvided ? `${Math.round(row.실질순이익).toLocaleString()}원` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Products */}
              {processedData.productSummary && (
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-4">🛍️ 옵션별 성과 분석</h3>
                  <div className="flex flex-col gap-6">
                    <div>
                      <h4 className="font-semibold text-ink mb-3">🏆 효자 옵션 (판매순)</h4>
                      <div className="overflow-x-auto border border-line rounded-card max-h-80">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-ink uppercase bg-paper-2 border-b border-line sticky top-0">
                            <tr><th className="px-4 py-3">상품명</th><th className="px-4 py-3 text-right">판매수량</th><th className="px-4 py-3 text-right">광고비</th><th className="px-4 py-3 text-right">실질순이익</th></tr>
                          </thead>
                          <tbody>
                            {processedData.productSummary.filter((p: any) => p.판매수량 > 0).sort((a: any, b: any) => b.판매수량 - a.판매수량).map((row: any, idx: number) => (
                              <tr key={idx} className="bg-paper border-b border-line hover:bg-paper-2">
                                <td className="px-4 py-3 font-medium text-ink whitespace-normal break-words">{row.상품명}</td>
                                <td className="px-4 py-3 text-right">{row.판매수량.toLocaleString()}개</td>
                                <td className="px-4 py-3 text-right">{row.광고비.toLocaleString()}원</td>
                                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${!processedData.marginProvided ? "text-ink-3" : row.실질순이익 >= 0 ? "text-positive" : "text-critical"}`}>{processedData.marginProvided ? `${Math.round(row.실질순이익).toLocaleString()}원` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-ink mb-3">💸 돈만 쓰는 옵션 (판매0)</h4>
                      <div className="overflow-x-auto border border-line rounded-card max-h-80">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-ink uppercase bg-paper-2 border-b border-line sticky top-0">
                            <tr><th className="px-4 py-3">상품명</th><th className="px-4 py-3 text-right">광고비</th><th className="px-4 py-3 text-right">클릭수</th></tr>
                          </thead>
                          <tbody>
                            {processedData.productSummary.filter((p: any) => p.판매수량 === 0 && p.광고비 > 0).sort((a: any, b: any) => b.광고비 - a.광고비).map((row: any, idx: number) => (
                              <tr key={idx} className="bg-paper border-b border-line hover:bg-paper-2">
                                <td className="px-4 py-3 font-medium text-ink whitespace-normal break-words">{row.상품명}</td>
                                <td className="px-4 py-3 text-right text-critical font-medium">{row.광고비.toLocaleString()}원</td>
                                <td className="px-4 py-3 text-right">{row.클릭수.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 키워드 정밀 진단 */}
              {processedData.keywordDiag && processedData.keywordDiag.total > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-1">🔬 키워드 정밀 진단 (검색 영역 {processedData.keywordDiag.total}개)</h3>
                  <p className="text-[12px] text-ink-2 mb-4">
                    현재 전환율 기준, 클릭 {processedData.keywordDiag.expectClicks}회면 1건은 팔렸어야 합니다 — 이 기준으로 '제외'와 '판단 보류'를 구분합니다.
                  </p>
                  <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
                    {[
                      { label: "🌟 스타 (확장)", n: processedData.keywordDiag.star.length, sub: `매출 ₩${Math.round(processedData.keywordDiag.starRevenue).toLocaleString()}`, cls: "border-positive/35 bg-positive-soft text-positive" },
                      { label: "✅ 효율 (유지)", n: processedData.keywordDiag.ok.length, sub: "손익분기 이상", cls: "border-accent/35 bg-accent-soft text-accent" },
                      { label: "🟡 저효율 (개선)", n: processedData.keywordDiag.lowRoas.length, sub: "판매 有, 손익분기 미달", cls: "border-caution/35 bg-caution-soft text-caution" },
                      { label: "🔴 제외 후보", n: processedData.keywordDiag.drain.length, sub: `낭비 ₩${processedData.keywordDiag.drainCost.toLocaleString()}`, cls: "border-critical/35 bg-critical-soft text-critical" },
                      { label: "👀 판단 보류", n: processedData.keywordDiag.watch.length, sub: `₩${processedData.keywordDiag.watchCost.toLocaleString()} · 데이터 부족`, cls: "border-line-strong bg-paper-2 text-ink-2" },
                    ].map(({ label, n, sub, cls }) => (
                      <div key={label} className={`rounded-card border p-3 text-center ${cls}`}>
                        <p className="text-[12px] font-semibold">{label}</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{n}</p>
                        <p className="mt-0.5 text-[11px] opacity-80">{sub}</p>
                      </div>
                    ))}
                  </div>

                  {processedData.keywordDiag.star.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-semibold text-ink mb-2">🌟 스타 키워드 — 수동 캠페인 분리·확대 추천</h4>
                      <div className="overflow-x-auto border border-line rounded-card max-h-64">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-ink uppercase bg-paper-2 border-b border-line sticky top-0">
                            <tr><th className="px-4 py-2.5">키워드</th><th className="px-4 py-2.5 text-right">클릭</th><th className="px-4 py-2.5 text-right">광고비</th><th className="px-4 py-2.5 text-right">매출</th><th className="px-4 py-2.5 text-right">ROAS</th><th className="px-4 py-2.5 text-right">CPC</th><th className="px-4 py-2.5 text-right">소싱AI</th></tr>
                          </thead>
                          <tbody>
                            {processedData.keywordDiag.star.map((k: any, i: number) => (
                              <tr key={i} className="bg-paper border-b border-line last:border-b-0 hover:bg-paper-2">
                                <td className="px-4 py-2.5 font-medium text-ink">{k.키워드}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{k.클릭수.toLocaleString()}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{k.광고비.toLocaleString()}원</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{Math.round(k.매출).toLocaleString()}원</td>
                                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-positive">{k.roasPct.toFixed(0)}%</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{k.cpc.toFixed(0)}원</td>
                                <td className="px-4 py-2.5 text-right">
                                  <button onClick={() => addStarToFavorites(k.키워드)} disabled={favAdded[k.키워드]}
                                    title="소싱AI 관심 키워드로 저장 — 매일 자동 수집·시장 추적 대상이 됩니다"
                                    className="rounded-control border border-line px-2 py-1 text-[11px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-60 whitespace-nowrap">
                                    {favAdded[k.키워드] ? "✓ 추적 중" : "★ 관심 등록"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {processedData.keywordDiag.drain.length > 0 && (
                    <div className="bg-paper border border-line rounded-card p-4">
                      <p className="text-sm text-ink-2 mb-1">
                        🔴 제외 후보 <span className="font-semibold text-critical">{processedData.keywordDiag.drain.length}개</span> —
                        충분한 클릭에도 판매 0건, 낭비 광고비 <span className="font-semibold text-critical">₩{processedData.keywordDiag.drainCost.toLocaleString()}</span>
                      </p>
                      <p className="text-sm text-ink-2 mb-2">복사해서 제외 키워드로 등록하세요:</p>
                      <textarea
                        readOnly
                        className="w-full h-24 p-3 bg-paper-2 border border-line rounded-control text-sm text-ink focus:outline-none"
                        value={processedData.keywordDiag.drain.map((k: any) => k.키워드).join(", ")}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Recommendations */}
              {processedData.recommendations.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-ink mb-4">💡 훈프로의 정밀 운영 제안</h3>
                  <div className="space-y-3">
                    {processedData.recommendations.map((rec: string, idx: number) => (
                      <div key={idx} className="bg-paper border border-line rounded-card p-4">
                        <p className="text-sm text-ink leading-relaxed">{rec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {"error" in (processedData ?? {}) && (
            <div className="p-4 bg-critical-soft border border-critical/30 rounded-card text-critical">
              {(processedData as any).error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 키워드 단위 비교표.
 *
 * 전부 늘어놓지 않는다. 키워드가 수백 개인 계정에서 표를 끝까지 내리는
 * 사람은 없다. 손봐야 할 것부터 짚어 준다 —
 *   ① 돈은 더 썼는데 ROAS가 떨어진 키워드 (가장 먼저)
 *   ② 사라진 키워드와 그 돈이 어디로 갔는지
 *   ③ 살아난 키워드 (같은 처방을 다른 데도 쓸 수 있다)
 */
function KeywordDiffPanel({ diff }: { diff: { rows: KeywordDiff[]; summary: any } }) {
  const { summary } = diff;
  const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
  const roas = (n: number | null | undefined) => (typeof n === "number" ? `${n.toFixed(0)}%` : "—");

  const Section = ({ title, hint, rows, tone }: { title: string; hint: string; rows: KeywordDiff[]; tone: string }) => {
    if (rows.length === 0) return null;
    return (
      <div className="mb-3">
        <p className={`mb-1 text-[12.5px] font-semibold ${tone}`}>{title} <span className="font-normal text-ink-3">· {hint}</span></p>
        <div className="overflow-x-auto rounded-card border border-line bg-paper">
          <table className="w-full min-w-[440px] text-[12px]">
            <thead className="bg-paper-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-2.5 py-1.5 text-left">키워드</th>
                <th className="px-2.5 py-1.5 text-right">광고비</th>
                <th className="px-2.5 py-1.5 text-right">ROAS</th>
                <th className="px-2.5 py-1.5 text-right">판매</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map(d => (
                <tr key={d.keyword} className="border-t border-line">
                  <td className="max-w-[200px] px-2.5 py-1.5"><span className="line-clamp-1 text-ink">{d.keyword}</span></td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-ink-2">
                    {won(d.current?.cost ?? 0)}
                    {d.costDelta !== 0 && (
                      <span className={`ml-1 text-[10px] ${d.costDelta > 0 ? "text-critical" : "text-ink-3"}`}>
                        {d.costDelta > 0 ? "+" : ""}{Math.round(d.costDelta).toLocaleString()}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">
                    <span className="text-ink-3">{roas(d.prev?.roasPct)}</span>
                    <span className="mx-1 text-ink-3">→</span>
                    <span className={d.change === "better" ? "font-semibold text-positive" : d.change === "worse" ? "font-semibold text-critical" : "text-ink"}>
                      {roas(d.current?.roasPct)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-ink-2">
                    {d.current?.qty ?? 0}건
                    {d.qtyDelta !== 0 && (
                      <span className={`ml-1 text-[10px] ${d.qtyDelta > 0 ? "text-positive" : "text-ink-3"}`}>
                        {d.qtyDelta > 0 ? "+" : ""}{d.qtyDelta}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 10 && <p className="mt-1 text-[10.5px] text-ink-3">광고비가 큰 10개만 보여줍니다 (전체 {rows.length}개).</p>}
      </div>
    );
  };

  return (
    <div className="mb-4 rounded-card border border-line bg-paper-2 p-4">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: "악화 + 증액", v: `${summary.worseAndCostlier.length}개`, tone: "text-critical" },
          { k: "개선", v: `${summary.improved.length}개`, tone: "text-positive" },
          { k: "새 키워드", v: `${summary.added}개`, tone: "text-ink" },
          { k: "사라진 키워드", v: `${summary.removed}개`, tone: "text-ink-2" },
        ].map(c => (
          <div key={c.k} className="rounded-card border border-line bg-paper px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{c.k}</p>
            <p className={`text-[15px] font-semibold tabular-nums ${c.tone}`}>{c.v}</p>
          </div>
        ))}
      </div>

      {summary.removed > 0 && (
        <p className="mb-3 rounded-card border border-line bg-paper px-2.5 py-2 text-[12px] leading-relaxed text-ink-2">
          사라진 키워드가 지난번 쓰던 광고비 <b>{won(summary.removedCost)}</b>, 새로 생긴 키워드가 쓴 광고비 <b>{won(summary.addedCost)}</b>입니다.
          {summary.addedCost > summary.removedCost * 1.2 && " 예산이 새 키워드 쪽으로 옮겨 갔습니다 — 그 키워드들의 ROAS를 먼저 보세요."}
        </p>
      )}

      <Section
        title="🔴 돈은 더 썼는데 ROAS가 떨어졌습니다"
        hint="가장 먼저 손볼 것"
        rows={summary.worseAndCostlier}
        tone="text-critical"
      />
      <Section
        title="🟢 살아난 키워드"
        hint="같은 처방을 다른 키워드에도"
        rows={summary.improved}
        tone="text-positive"
      />

      <p className="text-[10.5px] leading-relaxed text-ink-3">
        ROAS가 10%p 안쪽으로 움직인 것은 '변화 없음'으로 봅니다 — 광고 성과는 날마다 흔들려서,
        그보다 작은 차이를 변화로 읽으면 없는 추세를 쫓게 됩니다.
      </p>
    </div>
  );
}
