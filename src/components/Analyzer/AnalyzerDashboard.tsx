import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { Upload } from "lucide-react";

// ─── 지면 분류 헬퍼 ("비검색"이 "검색"을 포함하는 substring 함정 방지) ───
function isSearchPlatform(platform: string): boolean {
  if (!platform) return false;
  const lower = platform.toLowerCase();
  if (platform.includes("비검색") || lower.includes("non-search") || lower.includes("nonsearch")) return false;
  return platform.includes("검색") || lower.includes("search");
}

function isNonSearchPlatform(platform: string): boolean {
  if (!platform) return false;
  const lower = platform.toLowerCase();
  if (platform.includes("비검색") || lower.includes("non-search") || lower.includes("nonsearch")) return true;
  if (platform.includes("검색") || lower.includes("search")) return false;
  return false;
}

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

export function AnalyzerDashboard() {
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0);
  const [deliveryFee, setDeliveryFee] = useState<number>(3650);
  const [coupangFeeRate, setCoupangFeeRate] = useState<number>(11.55);
  const [targetROAS, setTargetROAS] = useState<number>(300);

  const [rawData, setRawData] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");

  const totalFeeAmount = unitPrice * (coupangFeeRate / 100);
  const netUnitMargin = unitPrice - unitCost - deliveryFee - totalFeeAmount;
  const marginRate = unitPrice > 0 ? (netUnitMargin / unitPrice) * 100 : 0;
  const breakEvenROAS = netUnitMargin > 0 ? (unitPrice / netUnitMargin) * 100 : 0;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    try {
      if (file.name.endsWith(".csv")) {
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder("utf-8").decode(buffer);
        if (text.includes("")) text = new TextDecoder("euc-kr").decode(buffer);
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => setRawData(results.data as any[]),
          error: (err: any) => setError(`CSV 파싱 오류: ${err.message}`),
        });
      } else {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        setRawData(XLSX.utils.sheet_to_json(ws) as any[]);
      }
    } catch (err: any) {
      setError(`파일 처리 중 오류 발생: ${err.message}`);
    }
  };

  const processedData = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;

    const normalizedData = rawData.map((row) => {
      const newRow: any = {};
      Object.keys(row).forEach((key) => { newRow[key.trim()] = row[key]; });
      return newRow;
    });

    const qtyTargets = ["총 판매수량(14일)", "총 판매수량(1일)", "총 판매수량", "전환 판매수량", "판매수량"];
    const sampleRow = normalizedData[0] || {};
    const colQty = qtyTargets.find((c) => c in sampleRow);
    if (!colQty) return { error: "판매수량 컬럼을 찾을 수 없습니다." };

    // 실제 전환매출액 컬럼 자동 감지 — 있으면 '판매수량 × 입력 판매가' 추정 대신 실측 사용
    const revenueTargets = ["총 전환매출액(14일)", "총 전환매출액(1일)", "총 전환매출액", "전환매출액"];
    const colRevenue = revenueTargets.find((c) => c in sampleRow) || null;
    const colRevenue1d = colRevenue === "총 전환매출액(14일)" && "총 전환매출액(1일)" in sampleRow ? "총 전환매출액(1일)" : null;
    const colIndirectRev = colRevenue === "총 전환매출액(14일)" && "간접 전환매출액(14일)" in sampleRow
      ? "간접 전환매출액(14일)"
      : "간접 전환매출액(1일)" in sampleRow ? "간접 전환매출액(1일)" : null;

    const parseNum = (val: any) => {
      if (typeof val === "number") return val;
      if (!val) return 0;
      const num = parseFloat(String(val).replace(/,/g, "").replace(/%/g, "").replace(/^-$/, "0"));
      return isNaN(num) ? 0 : num;
    };

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
    const rowRevenue = (row: any) => (revenueMode === "actual" ? row.실측매출 : (row[colQty] || 0) * unitPrice);
    // 순이익: 실측 모드에서는 마진율(개당마진 ÷ 판매가)을 실측 매출에 적용해 옵션별 단가 차이를 흡수
    const netMarginRate = unitPrice > 0 ? netUnitMargin / unitPrice : 0;
    // 마진 미입력(판매가 0 등) 시: 순이익은 계산 불가로 표시하고,
    // 판정은 쿠팡 셀러 통상 기준선(손익분기 ROAS 300%)으로 폴백해 어긋난 판정을 막는다
    const marginProvided = breakEvenROAS > 0;
    const effectiveBE = marginProvided ? breakEvenROAS : 300;
    const rowProfit = (row: any) =>
      revenueMode === "actual"
        ? rowRevenue(row) * netMarginRate - (row.광고비 || 0)
        : (row[colQty] || 0) * netUnitMargin - (row.광고비 || 0);

    // ── 지면별 집계 ──
    const placementMap = new Map<string, any>();
    cleanedData.forEach((row) => {
      const p = row["광고 노출 지면"] || "미확인";
      if (!placementMap.has(p)) placementMap.set(p, { 지면: p, 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0, 매출: 0 });
      const acc = placementMap.get(p);
      acc.노출수 += row["노출수"] || 0;
      acc.클릭수 += row["클릭수"] || 0;
      acc.광고비 += row["광고비"] || 0;
      acc.판매수량 += row[colQty] || 0;
      acc.매출 += rowRevenue(row);
    });

    const placementSummary = Array.from(placementMap.values()).map((p) => {
      const 실제매출액 = p.매출;
      const 실제ROAS = p.광고비 > 0 ? 실제매출액 / p.광고비 : 0;
      const 클릭률 = p.노출수 > 0 ? p.클릭수 / p.노출수 : 0;
      const 구매전환율 = p.클릭수 > 0 ? p.판매수량 / p.클릭수 : 0;
      const CPC = p.클릭수 > 0 ? p.광고비 / p.클릭수 : 0;
      const 실질순이익 = revenueMode === "actual" ? 실제매출액 * netMarginRate - p.광고비 : p.판매수량 * netUnitMargin - p.광고비;
      return { ...p, 실제매출액, 실제ROAS, 클릭률, 구매전환율, CPC, 실질순이익 };
    });

    // ── 전체 합계 ──
    const tot = placementSummary.reduce(
      (acc, curr) => { acc.노출수 += curr.노출수; acc.클릭수 += curr.클릭수; acc.광고비 += curr.광고비; acc.판매수량 += curr.판매수량; acc.매출 += curr.실제매출액; return acc; },
      { 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0, 매출: 0 }
    );
    const totalRevenue = tot.매출;
    const totalRealRoas = tot.광고비 > 0 ? totalRevenue / tot.광고비 : 0;
    const totalProfit = revenueMode === "actual" ? totalRevenue * netMarginRate - tot.광고비 : tot.판매수량 * netUnitMargin - tot.광고비;
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
        if (!campMap.has(c)) campMap.set(c, { 캠페인: c, 광고유형: row["광고유형"] || "", 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0, 매출: 0 });
        const acc = campMap.get(c);
        acc.노출수 += row["노출수"] || 0; acc.클릭수 += row["클릭수"] || 0;
        acc.광고비 += row["광고비"] || 0; acc.판매수량 += row[colQty] || 0;
        acc.매출 += rowRevenue(row);
      });
      campaignSummary = Array.from(campMap.values()).map((c) => {
        const roasPct = c.광고비 > 0 ? (c.매출 / c.광고비) * 100 : 0;
        const ctr = c.노출수 > 0 ? c.클릭수 / c.노출수 : 0;
        const cvr = c.클릭수 > 0 ? c.판매수량 / c.클릭수 : 0;
        const cpc = c.클릭수 > 0 ? c.광고비 / c.클릭수 : 0;
        const 순이익 = revenueMode === "actual" ? c.매출 * netMarginRate - c.광고비 : c.판매수량 * netUnitMargin - c.광고비;
        // 판정: 데이터가 부족한 캠페인을 성급하게 '중단'으로 몰지 않는다
        let verdict: "scale" | "keep" | "fix" | "stop" | "watch";
        if (roasPct >= effectiveBE * 1.3 && c.판매수량 >= 2) verdict = "scale";
        else if (roasPct >= effectiveBE) verdict = "keep";
        else if (c.판매수량 === 0 && c.클릭수 >= 30) verdict = "stop";
        else if (c.클릭수 >= 20) verdict = "fix";
        else verdict = "watch";
        return { ...c, roasPct, ctr, cvr, cpc, 순이익, verdict };
      }).sort((a, b) => b.광고비 - a.광고비);
    }

    // ── 옵션별 집계 ──
    let productSummary = null;
    if ("광고집행 상품명" in sampleRow) {
      const prodMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const prod = row["광고집행 상품명"] || "미확인";
        if (!prodMap.has(prod)) prodMap.set(prod, { 상품명: prod, 광고비: 0, 판매수량: 0, 노출수: 0, 클릭수: 0, 매출: 0 });
        const acc = prodMap.get(prod);
        acc.광고비 += row["광고비"] || 0; acc.판매수량 += row[colQty] || 0;
        acc.노출수 += row["노출수"] || 0; acc.클릭수 += row["클릭수"] || 0;
        acc.매출 += rowRevenue(row);
      });
      productSummary = Array.from(prodMap.values()).map((p) => ({
        ...p,
        실질순이익: revenueMode === "actual" ? p.매출 * netMarginRate - p.광고비 : p.판매수량 * netUnitMargin - p.광고비,
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
      const adCostRatio = unitPrice > 0 ? (adCostPerSale / unitPrice) * 100 : 0;
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
      recommendations.push(`🌟 [스타 키워드 확장] ${top} 등 ${keywordDiag.star.length}개 키워드가 손익분기를 크게 웃돕니다. 이 키워드들은 수동 캠페인으로 분리해 입찰가를 10~20% 올리고, 연관 세부 키워드(수식어 조합)를 추가해 노출을 확대하세요.`);
    }

    // 9. 저효율 키워드 입찰 하향
    if (keywordDiag && keywordDiag.lowRoas.length > 0) {
      const top = keywordDiag.lowRoas.slice(0, 3).map((k: any) => `'${k.키워드}'(ROAS ${fmt(k.roasPct)}%, CPC ₩${fmt(k.cpc)})`).join(", ");
      recommendations.push(`🟡 [입찰 하향 대상] ${top} — 판매는 있지만 손익분기(${fmt(breakEvenROASPct)}%) 미만입니다. 제외 대신 입찰가를 20~30% 낮춰 CPC를 줄이면 흑자 전환 여지가 있습니다.`);
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
      precision: {
        ctrScore: ctrResult.score, ctrLevel: ctrResult.level,
        cvrScore: cvrResult.score, cvrLevel: cvrResult.level,
        roasScore, efficiencyScore, totalScore, grade,
        cpcEfficiency,
      },
    };
  }, [rawData, unitPrice, unitCost, deliveryFee, coupangFeeRate, netUnitMargin, targetROAS, breakEvenROAS]);

  const gradeColor = (g: string) => ({ S: "text-purple-600", A: "text-accent", B: "text-positive", C: "text-caution", D: "text-critical" }[g] || "text-ink-2");
  const gradeBg = (g: string) => ({ S: "bg-purple-50 border-purple-200", A: "bg-accent-soft border-accent-line", B: "bg-positive-soft border-positive/30", C: "bg-caution-soft border-caution/30", D: "bg-critical-soft border-critical/30" }[g] || "bg-paper-2 border-line");
  const gradeEmoji = (g: string) => ({ S: "🏆", A: "🌟", B: "👍", C: "⚠️", D: "🚨" }[g] || "");

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-paper-2 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-paper border-r border-line p-6 flex flex-col h-full overflow-y-auto shrink-0">
        <h2 className="text-lg font-semibold text-ink mb-6">💰 마진 계산 설정</h2>
        <div className="space-y-4">
          {[
            { label: "상품 판매가 (원)", val: unitPrice, set: setUnitPrice, step: "1" },
            { label: "최종원가(매입가 등) (원)", val: unitCost, set: setUnitCost, step: "1" },
            { label: "로켓그로스 입출고비 (원)", val: deliveryFee, set: setDeliveryFee, step: "1" },
            { label: "쿠팡 수수료(vat포함) (%)", val: coupangFeeRate, set: setCoupangFeeRate, step: "0.1" },
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
          <div className="flex justify-between text-sm"><span className="text-ink-2">📦 입출고비 합계:</span><span>{deliveryFee.toLocaleString()}원</span></div>
          <div className="flex justify-between text-sm"><span className="text-ink-2">📊 예상 수수료 ({coupangFeeRate}%):</span><span>{totalFeeAmount.toLocaleString()}원</span></div>
          <div className="flex justify-between text-base font-semibold"><span className="text-ink">💡 개당 예상 마진:</span><span className="text-positive">{netUnitMargin.toLocaleString()}원</span></div>
          {unitPrice > 0 && <div className="flex justify-between text-sm font-semibold"><span>📈 예상 마진율:</span><span className="text-accent">{marginRate.toFixed(1)}%</span></div>}
          {breakEvenROAS > 0 && <div className="flex justify-between text-sm font-semibold"><span>🎯 손익분기 ROAS:</span><span className="text-orange-600">{breakEvenROAS.toFixed(0)}%</span></div>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-[20px] font-semibold text-ink mb-2">📊 쇼크트리 훈프로 쿠팡 광고 성과 분석기</h1>
            <p className="text-ink-2">쿠팡 보고서(CSV 또는 XLSX)를 업로드하면 훈프로의 정밀 운영 전략이 자동으로 생성됩니다.</p>
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
                          {["캠페인", "판정", "광고비", "매출", "ROAS", "CTR", "CVR", "CPC", "순이익"].map((h) => (
                            <th key={h} className="px-4 py-3 text-right first:text-left [&:nth-child(2)]:text-center">{h}</th>
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
                              <td className="px-4 py-3 text-right tabular-nums">{(c.ctr * 100).toFixed(2)}%</td>
                              <td className="px-4 py-3 text-right tabular-nums">{(c.cvr * 100).toFixed(1)}%</td>
                              <td className="px-4 py-3 text-right tabular-nums">{c.cpc.toFixed(0)}원</td>
                              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${!processedData.marginProvided ? "text-ink-3" : c.순이익 >= 0 ? "text-positive" : "text-critical"}`}>{processedData.marginProvided ? `${Math.round(c.순이익).toLocaleString()}원` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-2">
                    판정 기준(손익분기 ROAS {Math.round(processedData.effectiveBE)}%{processedData.marginProvided ? '' : ' — 마진 미입력으로 기본값 적용'}): <b>확대</b> 손익분기×1.3↑ & 판매 2건↑ · <b>유지</b> 손익분기 이상 · <b>개선</b> 미달(클릭 20↑) · <b>중단 검토</b> 클릭 30↑ 판매 0 · <b>관찰</b> 데이터 부족
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
                      { label: "🟡 저효율 (입찰↓)", n: processedData.keywordDiag.lowRoas.length, sub: "판매 有, 손익분기 미달", cls: "border-caution/35 bg-caution-soft text-caution" },
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
                      <h4 className="font-semibold text-ink mb-2">🌟 스타 키워드 — 입찰 상향·수동 캠페인 분리 추천</h4>
                      <div className="overflow-x-auto border border-line rounded-card max-h-64">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-ink uppercase bg-paper-2 border-b border-line sticky top-0">
                            <tr><th className="px-4 py-2.5">키워드</th><th className="px-4 py-2.5 text-right">클릭</th><th className="px-4 py-2.5 text-right">광고비</th><th className="px-4 py-2.5 text-right">매출</th><th className="px-4 py-2.5 text-right">ROAS</th><th className="px-4 py-2.5 text-right">CPC</th></tr>
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
