import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  Upload,
  LogOut,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  MousePointerClick,
  ShoppingCart,
} from "lucide-react";

export function AnalyzerDashboard() {
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0);
  const [deliveryFee, setDeliveryFee] = useState<number>(3650);
  const [coupangFeeRate, setCoupangFeeRate] = useState<number>(11.55);

  const [rawData, setRawData] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");

  const totalFeeAmount = unitPrice * (coupangFeeRate / 100);
  const netUnitMargin = unitPrice - unitCost - deliveryFee - totalFeeAmount;
  const marginRate = unitPrice > 0 ? (netUnitMargin / unitPrice) * 100 : 0;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError("");

    try {
      if (file.name.endsWith(".csv")) {
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder("utf-8").decode(buffer);
        if (text.includes("")) {
          text = new TextDecoder("euc-kr").decode(buffer);
        }

        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            setRawData(results.data);
          },
          error: (err: any) => {
            setError(`CSV 파싱 오류: ${err.message}`);
          },
        });
      } else {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        setRawData(data);
      }
    } catch (err: any) {
      setError(`파일 처리 중 오류 발생: ${err.message}`);
    }
  };

  const processedData = useMemo(() => {
    if (!rawData || rawData.length === 0) return null;

    // Normalize keys (trim whitespace)
    const normalizedData = rawData.map((row) => {
      const newRow: any = {};
      Object.keys(row).forEach((key) => {
        newRow[key.trim()] = row[key];
      });
      return newRow;
    });

    const qtyTargets = [
      "총 판매수량(14일)",
      "총 판매수량(1일)",
      "총 판매수량",
      "전환 판매수량",
      "판매수량",
    ];
    const sampleRow = normalizedData[0] || {};
    const colQty = qtyTargets.find((c) => c in sampleRow);

    if (!colQty) {
      return { error: "판매수량 컬럼을 찾을 수 없습니다." };
    }

    const parseNum = (val: any) => {
      if (typeof val === "number") return val;
      if (!val) return 0;
      const str = String(val).replace(/,/g, "").replace(/-/g, "0");
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };

    // Clean data
    const cleanedData = normalizedData.map((row) => ({
      ...row,
      노출수: parseNum(row["노출수"]),
      클릭수: parseNum(row["클릭수"]),
      광고비: parseNum(row["광고비"]),
      [colQty]: parseNum(row[colQty]),
    }));

    // Placement Summary
    const placementMap = new Map<string, any>();
    cleanedData.forEach((row) => {
      const placement = row["광고 노출 지면"] || "미확인";
      if (!placementMap.has(placement)) {
        placementMap.set(placement, {
          지면: placement,
          노출수: 0,
          클릭수: 0,
          광고비: 0,
          판매수량: 0,
        });
      }
      const p = placementMap.get(placement);
      p.노출수 += row["노출수"] || 0;
      p.클릭수 += row["클릭수"] || 0;
      p.광고비 += row["광고비"] || 0;
      p.판매수량 += row[colQty] || 0;
    });

    const placementSummary = Array.from(placementMap.values()).map((p) => {
      const 실제매출액 = p.판매수량 * unitPrice;
      const 실제ROAS = p.광고비 > 0 ? 실제매출액 / p.광고비 : 0;
      const 클릭률 = p.노출수 > 0 ? p.클릭수 / p.노출수 : 0;
      const 구매전환율 = p.클릭수 > 0 ? p.판매수량 / p.클릭수 : 0;
      const CPC = p.클릭수 > 0 ? p.광고비 / p.클릭수 : 0;
      const 실질순이익 = p.판매수량 * netUnitMargin - p.광고비;

      return {
        ...p,
        실제매출액,
        실제ROAS,
        클릭률,
        구매전환율,
        CPC,
        실질순이익,
      };
    });

    // Totals
    const tot = placementSummary.reduce(
      (acc, curr) => {
        acc.노출수 += curr.노출수;
        acc.클릭수 += curr.클릭수;
        acc.광고비 += curr.광고비;
        acc.판매수량 += curr.판매수량;
        return acc;
      },
      { 노출수: 0, 클릭수: 0, 광고비: 0, 판매수량: 0 },
    );

    const totalRealRevenue = tot.판매수량 * unitPrice;
    const totalRealRoas = tot.광고비 > 0 ? totalRealRevenue / tot.광고비 : 0;
    const totalProfit = tot.판매수량 * netUnitMargin - tot.광고비;
    const totalCtr = tot.노출수 > 0 ? tot.클릭수 / tot.노출수 : 0;
    const totalCvr = tot.클릭수 > 0 ? tot.판매수량 / tot.클릭수 : 0;

    // Product Summary
    let productSummary = null;
    if ("광고집행 상품명" in sampleRow) {
      const prodMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const prod = row["광고집행 상품명"] || "미확인";
        if (!prodMap.has(prod)) {
          prodMap.set(prod, {
            상품명: prod,
            광고비: 0,
            판매수량: 0,
            노출수: 0,
            클릭수: 0,
          });
        }
        const p = prodMap.get(prod);
        p.광고비 += row["광고비"] || 0;
        p.판매수량 += row[colQty] || 0;
        p.노출수 += row["노출수"] || 0;
        p.클릭수 += row["클릭수"] || 0;
      });
      productSummary = Array.from(prodMap.values()).map((p) => ({
        ...p,
        실질순이익: p.판매수량 * netUnitMargin - p.광고비,
      }));
    }

    // Keyword Summary
    let badKeywords = null;
    if ("키워드" in sampleRow) {
      const kwMap = new Map<string, any>();
      cleanedData.forEach((row) => {
        const kw = row["키워드"];
        if (!kw) return;
        if (!kwMap.has(kw)) {
          kwMap.set(kw, { 키워드: kw, 광고비: 0, 판매수량: 0 });
        }
        const k = kwMap.get(kw);
        k.광고비 += row["광고비"] || 0;
        k.판매수량 += row[colQty] || 0;
      });
      badKeywords = Array.from(kwMap.values())
        .filter((k) => k.판매수량 === 0 && k.광고비 > 0)
        .sort((a, b) => b.광고비 - a.광고비);
    }

    return {
      placementSummary,
      tot,
      totalRealRevenue,
      totalRealRoas,
      totalProfit,
      totalCtr,
      totalCvr,
      productSummary,
      badKeywords,
    };
  }, [
    rawData,
    unitPrice,
    unitCost,
    deliveryFee,
    coupangFeeRate,
    netUnitMargin,
  ]);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-slate-200 p-6 flex flex-col h-full overflow-y-auto shrink-0">
        <h2 className="text-lg font-bold text-slate-900 mb-6">
          💰 마진 계산 설정
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              상품 판매가 (원)
            </label>
            <input
              type="number"
              value={unitPrice || ""}
              onChange={(e) => setUnitPrice(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              최종원가(매입가 등) (원)
            </label>
            <input
              type="number"
              value={unitCost || ""}
              onChange={(e) => setUnitCost(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              로켓그로스 입출고비 (원)
            </label>
            <input
              type="number"
              value={deliveryFee || ""}
              onChange={(e) => setDeliveryFee(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              쿠팡 수수료(vat포함) (%)
            </label>
            <input
              type="number"
              step="0.1"
              value={coupangFeeRate || ""}
              onChange={(e) => setCoupangFeeRate(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600 font-medium">
              📦 입출고비 합계:
            </span>
            <span className="text-slate-900">
              {deliveryFee.toLocaleString()}원
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600 font-medium">
              📊 예상 수수료 ({coupangFeeRate}%):
            </span>
            <span className="text-slate-900">
              {totalFeeAmount.toLocaleString()}원
            </span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span className="text-slate-900">💡 개당 예상 마진:</span>
            <span className="text-emerald-600">
              {netUnitMargin.toLocaleString()}원
            </span>
          </div>
          {unitPrice > 0 && (
            <div className="flex justify-between text-sm font-bold">
              <span className="text-slate-900">📈 예상 마진율:</span>
              <span className="text-blue-600">{marginRate.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              📊 쇼크트리 훈프로 쿠팡 광고 성과 분석기
            </h1>
            <p className="text-slate-600">
              쿠팡 보고서(CSV 또는 XLSX)를 업로드하면 훈프로의 정밀 운영 전략이
              자동으로 생성됩니다.
            </p>
          </div>

          {/* File Upload */}
          <div className="mb-8">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-white hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 text-slate-400 mb-2" />
                <p className="mb-2 text-sm text-slate-500">
                  <span className="font-semibold">클릭하여 파일 업로드</span>{" "}
                  또는 드래그 앤 드롭
                </p>
                <p className="text-xs text-slate-500">CSV, XLSX 파일 지원</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".csv, .xlsx"
                onChange={handleFileUpload}
              />
            </label>
            {fileName && (
              <p className="mt-2 text-sm text-emerald-600 font-medium">
                선택된 파일: {fileName}
              </p>
            )}
            {error && (
              <p className="mt-2 text-sm text-red-500 font-medium">{error}</p>
            )}
          </div>

          {/* Results */}
          {processedData && !processedData.error && (
            <div className="space-y-8">
              {/* Key Metrics */}
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-4">
                  📌 핵심 성과 지표
                </h3>
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
                    <p className="text-sm text-slate-500 font-medium mb-1">
                      최종 실질 순이익
                    </p>
                    <h2
                      className={`text-2xl font-bold ${processedData.totalProfit >= 0 ? "text-red-500" : "text-blue-500"}`}
                    >
                      {processedData.totalProfit.toLocaleString()}원
                    </h2>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
                    <p className="text-sm text-slate-500 font-medium mb-1">
                      총 광고비
                    </p>
                    <h2 className="text-2xl font-bold text-slate-900">
                      {processedData.tot.광고비.toLocaleString()}원
                    </h2>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
                    <p className="text-sm text-slate-500 font-medium mb-1">
                      실제 ROAS
                    </p>
                    <h2 className="text-2xl font-bold text-slate-900">
                      {(processedData.totalRealRoas * 100).toFixed(2)}%
                    </h2>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
                    <p className="text-sm text-slate-500 font-medium mb-1">
                      총 판매수량
                    </p>
                    <h2 className="text-2xl font-bold text-slate-900">
                      {processedData.tot.판매수량.toLocaleString()}개
                    </h2>
                  </div>
                </div>
              </div>

              {/* Placement Table */}
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-4">
                  📍 지면별 상세 분석
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3">지면</th>
                        <th className="px-4 py-3 text-right">노출수</th>
                        <th className="px-4 py-3 text-right">클릭수</th>
                        <th className="px-4 py-3 text-right">광고비</th>
                        <th className="px-4 py-3 text-right">판매수량</th>
                        <th className="px-4 py-3 text-right">실제매출액</th>
                        <th className="px-4 py-3 text-right">CPC</th>
                        <th className="px-4 py-3 text-right">클릭률(CTR)</th>
                        <th className="px-4 py-3 text-right">
                          구매전환율(CVR)
                        </th>
                        <th className="px-4 py-3 text-right">실제ROAS</th>
                        <th className="px-4 py-3 text-right">실질순이익</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedData.placementSummary.map((row, idx) => (
                        <tr
                          key={idx}
                          className="bg-white border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {row.지면}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.노출수.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.클릭수.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.광고비.toLocaleString()}원
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.판매수량.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.실제매출액.toLocaleString()}원
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.CPC.toFixed(0)}원
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(row.클릭률 * 100).toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(row.구매전환율 * 100).toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right">
                            {(row.실제ROAS * 100).toFixed(2)}%
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-bold ${row.실질순이익 >= 0 ? "text-red-500" : "text-blue-500"}`}
                          >
                            {row.실질순이익.toLocaleString()}원
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Products Analysis — stacked layout */}
              {processedData.productSummary && (
                <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">
                    🛍️ 옵션별 성과 분석
                  </h3>
                  <div className="flex flex-col gap-6">
                    {/* 효자 옵션 */}
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-3 flex items-center">
                        <span className="text-xl mr-2">🏆</span> 효자 옵션
                        (판매순)
                      </h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm max-h-80">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b border-slate-200 sticky top-0">
                            <tr>
                              <th className="px-4 py-3">상품명</th>
                              <th className="px-4 py-3 text-right">판매수량</th>
                              <th className="px-4 py-3 text-right">광고비</th>
                              <th className="px-4 py-3 text-right">
                                실질순이익
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {processedData.productSummary
                              .filter((p) => p.판매수량 > 0)
                              .sort((a, b) => b.판매수량 - a.판매수량)
                              .map((row, idx) => (
                                <tr
                                  key={idx}
                                  className="bg-white border-b border-slate-100 hover:bg-slate-50"
                                >
                                  <td className="px-4 py-3 font-medium text-slate-900 whitespace-normal break-words">
                                    {row.상품명}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {row.판매수량.toLocaleString()}개
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {row.광고비.toLocaleString()}원
                                  </td>
                                  <td
                                    className={`px-4 py-3 text-right font-bold ${row.실질순이익 >= 0 ? "text-red-500" : "text-blue-500"}`}
                                  >
                                    {row.실질순이익.toLocaleString()}원
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 돈만 쓰는 옵션 */}
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-3 flex items-center">
                        <span className="text-xl mr-2">💸</span> 돈만 쓰는 옵션
                        (판매0)
                      </h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm max-h-80">
                        <table className="w-full text-sm text-left">
                          <thead className="text-xs text-slate-700 uppercase bg-slate-50 border-b border-slate-200 sticky top-0">
                            <tr>
                              <th className="px-4 py-3">상품명</th>
                              <th className="px-4 py-3 text-right">광고비</th>
                              <th className="px-4 py-3 text-right">클릭수</th>
                            </tr>
                          </thead>
                          <tbody>
                            {processedData.productSummary
                              .filter((p) => p.판매수량 === 0 && p.광고비 > 0)
                              .sort((a, b) => b.광고비 - a.광고비)
                              .map((row, idx) => (
                                <tr
                                  key={idx}
                                  className="bg-white border-b border-slate-100 hover:bg-slate-50"
                                >
                                  <td className="px-4 py-3 font-medium text-slate-900 whitespace-normal break-words">
                                    {row.상품명}
                                  </td>
                                  <td className="px-4 py-3 text-right text-red-500 font-medium">
                                    {row.광고비.toLocaleString()}원
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {row.클릭수.toLocaleString()}
                                  </td>
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
              {processedData.badKeywords &&
                processedData.badKeywords.length > 0 && (
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 mb-4">
                      ✂️ 제외 키워드 제안
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                      <p className="text-sm text-slate-600 mb-2">
                        광고비만 소진하고 판매가 없는 키워드들입니다. 복사해서
                        제외 등록하세요:
                      </p>
                      <textarea
                        readOnly
                        className="w-full h-24 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none"
                        value={processedData.badKeywords
                          .map((k) => k.키워드)
                          .join(", ")}
                      />
                    </div>
                  </div>
                )}

              {/* Insights */}
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-4">
                  💡 훈프로의 정밀 운영 제안
                </h3>
                <div className="grid grid-cols-3 gap-6">
                  {/* CTR Insight */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                    <h4 className="font-bold text-blue-900 mb-3 flex items-center">
                      <span className="text-xl mr-2">🖼️</span> 클릭률(CTR) 분석
                      (썸네일)
                    </h4>
                    <p className="text-sm text-blue-800 mb-2 font-medium">
                      현재 CTR: {(processedData.totalCtr * 100).toFixed(2)}%
                    </p>
                    <ul className="text-sm text-blue-800 space-y-2 list-disc pl-4">
                      {processedData.totalCtr < 0.01 ? (
                        <>
                          <li>
                            <span className="font-semibold">상태:</span> 고객의
                            눈길을 전혀 끌지 못하고 있습니다.
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span> 썸네일
                            배경 제거, 텍스트 강조, 혹은 주력 이미지 교체가
                            시급합니다.
                          </li>
                        </>
                      ) : (
                        <>
                          <li>
                            <span className="font-semibold">상태:</span> 시각적
                            매력이 충분합니다.
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span>{" "}
                            클릭률을 유지하며 공격적인 노출을 시도하세요.
                          </li>
                        </>
                      )}
                    </ul>
                  </div>

                  {/* CVR Insight */}
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-5">
                    <h4 className="font-bold text-amber-900 mb-3 flex items-center">
                      <span className="text-xl mr-2">🛒</span> 구매전환율(CVR)
                      분석 (상세페이지)
                    </h4>
                    <p className="text-sm text-amber-800 mb-2 font-medium">
                      현재 CVR: {(processedData.totalCvr * 100).toFixed(2)}%
                    </p>
                    <ul className="text-sm text-amber-800 space-y-2 list-disc pl-4">
                      {processedData.totalCvr < 0.05 ? (
                        <>
                          <li>
                            <span className="font-semibold">상태:</span> 유입은
                            되나 설득력이 부족해 구매로 이어지지 않습니다.
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span> 상단에
                            '무료배송', '이벤트' 등 혜택을 강조하고 구매평
                            관리에 집중하세요.
                          </li>
                        </>
                      ) : (
                        <>
                          <li>
                            <span className="font-semibold">상태:</span>{" "}
                            상세페이지 전환 능력이 탁월합니다.
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span> 유입
                            단가(CPC) 관리에 힘쓰세요.
                          </li>
                        </>
                      )}
                    </ul>
                  </div>

                  {/* ROAS Insight */}
                  <div className="bg-rose-50 border border-rose-100 rounded-xl p-5">
                    <h4 className="font-bold text-rose-900 mb-3 flex items-center">
                      <span className="text-xl mr-2">💰</span> 목표수익률 최적화
                      가이드
                    </h4>
                    <p className="text-sm text-rose-800 mb-2 font-medium">
                      현재 실제 ROAS:{" "}
                      {(processedData.totalRealRoas * 100).toFixed(2)}%
                    </p>
                    <ul className="text-sm text-rose-800 space-y-2">
                      {processedData.totalRealRoas < 2.0 ? (
                        <>
                          <li className="font-bold text-red-600">
                            🔴 [200% 미만] 절대 손실 구간
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span> 광고를
                            새로만드시거나 대대적인 수정이 시급합니다.
                            목표수익률을 최소 200%p 이상 상향하세요.
                          </li>
                        </>
                      ) : processedData.totalRealRoas < 3.0 ? (
                        <>
                          <li className="font-bold text-orange-600">
                            🟠 [200%~300%] 적자 지속 구간
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span>{" "}
                            역마진이 심각합니다. 목표수익률 상향과 고비용 키워드
                            차단이 필요합니다.
                          </li>
                        </>
                      ) : processedData.totalRealRoas < 4.0 ? (
                        <>
                          <li className="font-bold text-yellow-600">
                            🟡 [300%~400%] 손익분기점 안착 구간
                          </li>
                          <li>
                            <span className="font-semibold">액션:</span> 수익이
                            나기 시작합니다. 효율 낮은 키워드를 솎아내며
                            목표수익률을 50%p 상향하세요.
                          </li>
                        </>
                      ) : processedData.totalRealRoas < 5.0 ? (
                        <>
                          <li className="font-bold text-green-600">
                            🟢 [400%~500%] 안정적 수익 구간
                          </li>
                          <li>
                            <span className="font-semibold">전략:</span> 황금
                            밸런스입니다. 현재를 유지하며 매출 확대를 위해
                            목표수익률을 미세 조정하세요.
                          </li>
                        </>
                      ) : processedData.totalRealRoas < 6.0 ? (
                        <>
                          <li className="font-bold text-blue-600">
                            🔵 [500%~600%] 시장 점유 확장 단계
                          </li>
                          <li>
                            <span className="font-semibold">전략:</span> 수익이
                            넉넉합니다. 목표수익률을 하향 조정한 후 노출량을
                            극대화하세요.
                          </li>
                        </>
                      ) : (
                        <>
                          <li className="font-bold text-purple-600">
                            🚀 [600% 이상] 시장 지배 구간
                          </li>
                          <li>
                            <span className="font-semibold">전략:</span> 과감한
                            하향 조정을 통해 매출 규모 자체를 키우세요.
                          </li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
          {processedData?.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600">
              {processedData.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
