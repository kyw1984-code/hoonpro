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

    const parseNum = (val: any) => {
      if (typeof val === "number") return val;
      if (!val) return 0;
      const num = parseFloat(String(val).replace(/,/g, "").replace(/-/g, "0"));
      return isNaN(num) ? 0 : num;
    };

    const cleanedData = normalizedData.map((row) => ({
      ...row,
      노출수: parseNum(row["노출수"]),
      클릭수: parseNum(row["클릭수"]),
      광고비: parseNum(row["광고비"]),
      [colQty]: parseNum(row[colQty]),
    }));

    // ── 지면별 집계 ──
    const placementMap = new Map<string, any>();
    cleanedData.forEach((row) => {
      const p = row["광고 노출 지면"] || "미확인";
      if (!placementMap.has(p)) placementMap.set(p, { 지면: p, 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0 });
      const acc = placementMap.get(p);
      acc.노출수 += row["노출수"] || 0;
      acc.클릭수 += row["클릭수"] || 0;
      acc.광고비 += row["광고비"] || 0;
      acc.판매수량 += row[colQty] || 0;
    });

    const placementSummary = Array.from(placementMap.values()).map((p) => {
      const 실제매출액 = p.판매수량 * unitPrice;
      const 실제ROAS = p.광고비 > 0 ? 실제매출액 / p.광고비 : 0;
      const 클릭률 = p.노출수 > 0 ? p.클릭수 / p.노출수 : 0;
      const 구매전환율 = p.클릭수 > 0 ? p.판매수량 / p.클릭수 : 0;
      const CPC = p.클릭수 > 0 ? p.광고비 / p.클릭수 : 0;
      const 실질순이익 = p.판매수량 * netUnitMargin - p.광고비;
      return { ...p, 실제매출액, 실제ROAS, 클릭률, 구매전환율, CPC, 실질순이익 };
    });

    // ── 전체 합계 ──
    const tot = placementSummary.reduce(
      (acc, curr) => { acc.노출수 += curr.노출수; acc.클릭수 += curr.클릭수; acc.광고비 += curr.광고비; acc.판매수량 += curr.판매수량; return acc; },
      { 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0 }
    );
    const totalRevenue = tot.판매수량 * unitPrice;
    const totalRealRoas = tot.광고비 > 0 ? totalRevenue / tot.광고비 : 0;
    const totalProfit = tot.판매수량 * netUnitMargin - tot.광고비;
    const totalCtr = tot.노출수 > 0 ? tot.클릭수 / tot.노출수 : 0;
    const totalCvr = tot.클릭수 > 0 ? tot.판매수량 / tot.클릭수 : 0;
    const avgCPC = tot.클릭수 > 0 ? tot.광고비 / tot.클릭수 : 0;

    // ── 옵션별 집계 ──
    let productSummary = null;
    if ("광고집행 상품명" in sampleRow) {
      const prodMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const prod = row["광고집행 상품명"] || "미확인";
        if (!prodMap.has(prod)) prodMap.set(prod, { 상품명: prod, 광고비: 0, 판매수량: 0, 노출수: 0, 클릭수: 0 });
        const acc = prodMap.get(prod);
        acc.광고비 += row["광고비"] || 0; acc.판매수량 += row[colQty] || 0;
        acc.노출수 += row["노출수"] || 0; acc.클릭수 += row["클릭수"] || 0;
      });
      productSummary = Array.from(prodMap.values()).map((p) => ({ ...p, 실질순이익: p.판매수량 * netUnitMargin - p.광고비 }));
    }

    // ── 돈만 먹는 키워드 ──
    let badKeywords = null;
    if ("키워드" in sampleRow) {
      const kwMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const kw = row["키워드"];
        const platform = row["광고 노출 지면"] || "";
        if (!kw || kw === "-" || !isSearchPlatform(platform)) return;
        if (!kwMap.has(kw)) kwMap.set(kw, { 키워드: kw, 광고비: 0, 클릭수: 0, 판매수량: 0 });
        const acc = kwMap.get(kw);
        acc.광고비 += row["광고비"] || 0; acc.클릭수 += row["클릭수"] || 0; acc.판매수량 += row[colQty] || 0;
      });
      badKeywords = Array.from(kwMap.values())
        .filter((k) => k.판매수량 === 0 && k.광고비 > 0)
        .sort((a: any, b: any) => b.광고비 - a.광고비);
    }

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

    // 7. 키워드 낭비
    if (badKeywords && badKeywords.length > 0) {
      const wastedCost = badKeywords.reduce((sum: number, k: any) => sum + k.광고비, 0);
      const wasteRatio = tot.광고비 > 0 ? (wastedCost / tot.광고비) * 100 : 0;
      if (wasteRatio >= 30) {
        recommendations.push(`🔴 [키워드 정리 긴급] 판매 0건 키워드에 ₩${fmt(wastedCost)}(전체 광고비의 ${pct(wasteRatio)}%)가 낭비 중입니다. ${badKeywords.length}개 키워드를 제외 등록하면 월 ₩${fmt(Math.round(wastedCost * 30))} 절감 가능합니다.`);
      } else if (wasteRatio >= 10) {
        recommendations.push(`⚠️ [키워드 정리 권장] 판매 0건 키워드 ${badKeywords.length}개에 ₩${fmt(wastedCost)}(${pct(wasteRatio)}%)가 소진 중입니다. 아래 '돈만 먹는 키워드' 목록을 복사하여 제외 키워드로 등록하세요.`);
      }
    }

    return {
      placementSummary, tot, totalRevenue, totalRealRoas, totalProfit, totalCtr, totalCvr, avgCPC,
      productSummary, badKeywords, recommendations,
      precision: {
        ctrScore: ctrResult.score, ctrLevel: ctrResult.level,
        cvrScore: cvrResult.score, cvrLevel: cvrResult.level,
        roasScore, efficiencyScore, totalScore, grade,
        cpcEfficiency,
      },
    };
  }, [rawData, unitPrice, unitCost, deliveryFee, coupangFeeRate, netUnitMargin, targetROAS, breakEvenROAS]);

  const gradeColor = (g: string) => ({ S: "text-purple-600", A: "text-blue-600", B: "text-green-600", C: "text-yellow-600", D: "text-red-600" }[g] || "text-slate-600");
  const gradeBg = (g: string) => ({ S: "bg-purple-50 border-purple-200", A: "bg-blue-50 border-blue-200", B: "bg-green-50 border-green-200", C: "bg-yellow-50 border-yellow-200", D: "bg-red-50 border-red-200" }[g] || "bg-slate-50 border-slate-200");
  const gradeEmoji = (g: string) => ({ S: "🏆", A: "🌟", B: "👍", C: "⚠️", D: "🚨" }[g] || "");

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-slate-200 p-6 flex flex-col h-full overflow-y-auto shrink-0">
        <h2 className="text-lg font-bold text-slate-900 mb-6">💰 마진 계산 설정</h2>
        <div className="space-y-4">
          {[
            { label: "상품 판매가 (원)", val: unitPrice, set: setUnitPrice, step: "1" },
            { label: "최종원가(매입가 등) (원)", val: unitCost, set: setUnitCost, step: "1" },
            { label: "로켓그로스 입출고비 (원)", val: deliveryFee, set: setDeliveryFee, step: "1" },
            { label: "쿠팡 수수료(vat포함) (%)", val: coupangFeeRate, set: setCoupangFeeRate, step: "0.1" },
            { label: "현재 목표수익률 (%)", val: targetROAS, set: setTargetROAS, step: "50" },
          ].map(({ label, val, set, step }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
              <input
                type="number" step={step} value={val || ""}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>
          ))}
        </div>
        <div className="mt-6 pt-6 border-t border-slate-200 space-y-3">
          <div className="flex justify-between text-sm"><span className="text-slate-600">📦 입출고비 합계:</span><span>{deliveryFee.toLocaleString()}원</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-600">📊 예상 수수료 ({coupangFeeRate}%):</span><span>{totalFeeAmount.toLocaleString()}원</span></div>
          <div className="flex justify-between text-base font-bold"><span className="text-slate-900">💡 개당 예상 마진:</span><span className="text-emerald-600">{netUnitMargin.toLocaleString()}원</span></div>
          {unitPrice > 0 && <div className="flex justify-between text-sm font-bold"><span>📈 예상 마진율:</span><span className="text-blue-600">{marginRate.toFixed(1)}%</span></div>}
          {breakEvenROAS > 0 && <div className="flex justify-between text-sm font-bold"><span>🎯 손익분기 ROAS:</span><span className="text-orange-600">{breakEvenROAS.toFixed(0)}%</span></div>}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">📊 쇼크트리 훈프로 쿠팡 광고 성과 분석기</h1>
            <p className="text-slate-600">쿠팡 보고서(CSV 또는 XLSX)를 업로드하면 훈프로의 정밀 운영 전략이 자동으로 생성됩니다.</p>
          </div>

          {/* File Upload */}
          <div className="mb-8">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-white hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 text-slate-400 mb-2" />
                <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">클릭하여 파일 업로드</span> 또는 드래그 앤 드롭</p>
                <p className="text-xs text-slate-500">CSV, XLSX 파일 지원</p>
              </div>
              <input type="file" className="hidden" accept=".csv, .xlsx" onChange={handleFileUpload} />
            </label>
            {fileName && <p className="mt-2 text-sm text-emerald-600 font-medium">선택된 파일: {fileName}</p>}
            {error && <p className="mt-2 text-sm text-red-500 font-medium">{error}</p>}
          </div>

          {processedData && !("error" in processedData) && (
            <div className="space-y-8">
              {/* KPI Cards */}
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-4">📌 핵심 성과 지표</h3>
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { label: "최종 실질 순이익", value: `${processedData.totalProfit.toLocaleString()}원`, color: processedData.totalProfit >= 0 ? "text-red-500" : "text-blue-500" },
                    { label: "총 광고비", value: `${processedData.tot.광고비.toLocaleString()}원`, color: "text-slate-900" },
                    { label: "실제 ROAS", value: `${(processedData.totalRealRoas * 100).toFixed(0)}%`, color: "text-slate-900" },
                    { label: "총 판매수량", value: `${processedData.tot.판매수량.toLocaleString()}개`, color: "text-slate-900" },
                    { label: "구매전환율(CVR)", value: `${(processedData.totalCvr * 100).toFixed(2)}%`, color: "text-slate-900" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
                      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 종합 등급 */}
              {processedData.precision && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">🎯 종합 진단 등급</h3>
                  <div className={`border rounded-xl p-6 ${gradeBg(processedData.precision.grade)}`}>
                    <div className="flex items-center gap-6 mb-6">
                      <div className="text-center">
                        <div className={`text-6xl font-black ${gradeColor(processedData.precision.grade)}`}>
                          {gradeEmoji(processedData.precision.grade)} {processedData.precision.grade}
                        </div>
                        <p className="text-sm text-slate-600 mt-1">종합 점수 {processedData.precision.totalScore.toFixed(1)}점</p>
                      </div>
                      <div className="flex-1 grid grid-cols-4 gap-4">
                        {[
                          { label: "CTR 점수", score: processedData.precision.ctrScore },
                          { label: "CVR 점수", score: processedData.precision.cvrScore },
                          { label: "ROAS 점수", score: processedData.precision.roasScore },
                          { label: "효율 점수", score: processedData.precision.efficiencyScore },
                        ].map(({ label, score }) => (
                          <div key={label} className="text-center">
                            <p className="text-xs text-slate-600 mb-1">{label}</p>
                            <p className="text-lg font-bold text-slate-900">{score.toFixed(0)}</p>
                            <div className="w-full bg-slate-200 rounded-full h-2 mt-1">
                              <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(score, 100)}%` }} />
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
                <h3 className="text-lg font-bold text-slate-900 mb-4">📍 지면별 상세 분석</h3>
                <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["지면","노출수","클릭수","광고비","판매수량","실제매출액","CPC","클릭률(CTR)","구매전환율(CVR)","실제ROAS","실질순이익"].map((h) => (
                          <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {processedData.placementSummary.map((row: any, idx: number) => (
                        <tr key={idx} className="bg-white border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{row.지면}</td>
                          <td className="px-4 py-3 text-right">{row.노출수.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{row.클릭수.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{row.광고비.toLocaleString()}원</td>
                          <td className="px-4 py-3 text-right">{row.판매수량.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{row.실제매출액.toLocaleString()}원</td>
                          <td className="px-4 py-3 text-right">{row.CPC.toFixed(0)}원</td>
                          <td className="px-4 py-3 text-right">{(row.클릭률 * 100).toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right">{(row.구매전환율 * 100).toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right">{(row.실제ROAS * 100).toFixed(0)}%</td>
                          <td className={`px-4 py-3 text-right font-bold ${row.실질순이익 >= 0 ? "text-red-500" : "text-blue-500"}`}>{row.실질순이익.toLocaleString()}원</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Products */}
              {processedData.productSummary && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">🛍️ 옵션별 성과 분석</h3>
                  <div className="flex flex-col gap-6">
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-3">🏆 효자 옵션 (판매순)</h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm max-h-80">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b border-slate-200 sticky top-0">
                            <tr><th className="px-4 py-3">상품명</th><th className="px-4 py-3 text-right">판매수량</th><th className="px-4 py-3 text-right">광고비</th><th className="px-4 py-3 text-right">실질순이익</th></tr>
                          </thead>
                          <tbody>
                            {processedData.productSummary.filter((p: any) => p.판매수량 > 0).sort((a: any, b: any) => b.판매수량 - a.판매수량).map((row: any, idx: number) => (
                              <tr key={idx} className="bg-white border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-900 whitespace-normal break-words">{row.상품명}</td>
                                <td className="px-4 py-3 text-right">{row.판매수량.toLocaleString()}개</td>
                                <td className="px-4 py-3 text-right">{row.광고비.toLocaleString()}원</td>
                                <td className={`px-4 py-3 text-right font-bold ${row.실질순이익 >= 0 ? "text-red-500" : "text-blue-500"}`}>{row.실질순이익.toLocaleString()}원</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-3">💸 돈만 쓰는 옵션 (판매0)</h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm max-h-80">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b border-slate-200 sticky top-0">
                            <tr><th className="px-4 py-3">상품명</th><th className="px-4 py-3 text-right">광고비</th><th className="px-4 py-3 text-right">클릭수</th></tr>
                          </thead>
                          <tbody>
                            {processedData.productSummary.filter((p: any) => p.판매수량 === 0 && p.광고비 > 0).sort((a: any, b: any) => b.광고비 - a.광고비).map((row: any, idx: number) => (
                              <tr key={idx} className="bg-white border-b border-slate-100 hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-900 whitespace-normal break-words">{row.상품명}</td>
                                <td className="px-4 py-3 text-right text-red-500 font-medium">{row.광고비.toLocaleString()}원</td>
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

              {/* Bad Keywords */}
              {processedData.badKeywords && processedData.badKeywords.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">✂️ 제외 키워드 제안</h3>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <p className="text-sm text-slate-600 mb-1">
                      광고비만 소진하고 판매가 없는 키워드 <span className="font-bold text-red-500">{processedData.badKeywords.length}개</span> —
                      낭비 광고비: <span className="font-bold text-red-500">₩{processedData.badKeywords.reduce((s: number, k: any) => s + k.광고비, 0).toLocaleString()}</span>
                    </p>
                    <p className="text-sm text-slate-600 mb-2">복사해서 제외 등록하세요:</p>
                    <textarea
                      readOnly
                      className="w-full h-24 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none"
                      value={processedData.badKeywords.map((k: any) => k.키워드).join(", ")}
                    />
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {processedData.recommendations.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">💡 훈프로의 정밀 운영 제안</h3>
                  <div className="space-y-3">
                    {processedData.recommendations.map((rec: string, idx: number) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <p className="text-sm text-slate-800 leading-relaxed">{rec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {"error" in (processedData ?? {}) && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600">
              {(processedData as any).error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
