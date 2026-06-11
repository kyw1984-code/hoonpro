import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
  const sellerDistribution = typeof req.query.sellerDistribution === "string" ? req.query.sellerDistribution : "";

  if (!keyword) return res.status(400).json({ error: "Keyword is required" });

  const broadRedKeywords = ["이어폰","블루투스 이어폰","텐트","캠핑 텐트","마스크","생수","기저귀","충전기","케이블","비타민","영양제","물티슈"];
  const exactRedKeywords = ["침대","의자","양말","샴푸","치약","칫솔","슬리퍼","텀블러","선스크린","면도기","물통","베개","보조배터리"];

  const isExactRed = exactRedKeywords.some((r) => keyword === r) || broadRedKeywords.some((r) => keyword === r);
  const isContainsRed = broadRedKeywords.some((r) => keyword.includes(r));

  const hash = Array.from(keyword).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  let searchVolume = Math.floor((hash % 100) * 1500 + 9000);
  if (keyword.length < 3) searchVolume *= 4;
  if (isExactRed) searchVolume *= 4.5;
  else if (isContainsRed) searchVolume *= 2.5;

  let productMultiplier = (hash % 15) * 0.5 + 0.2;
  if (isExactRed) productMultiplier = 250 + (hash % 100);
  else if (isContainsRed) {
    const isLongTail = keyword.split(" ").length >= 2 || keyword.length > 5;
    productMultiplier = isLongTail ? 15 + (hash % 20) : 60 + (hash % 40);
  }

  const totalProducts = Math.floor(searchVolume * productMultiplier * 1.05);
  const competitionRate = (totalProducts / searchVolume).toFixed(2);

  let grade: "Excellent" | "Good" | "Fair" | "Bad" = "Bad";
  if (sellerDistribution) {
    try {
      const dist = JSON.parse(sellerDistribution);
      const { rocketPct, jetPct, generalPct } = dist;
      if (generalPct >= 60) grade = "Excellent";
      else if (generalPct >= 40) grade = "Good";
      else if (generalPct >= 20) grade = "Fair";
      else grade = "Bad";
      if (rocketPct + jetPct >= 80) grade = "Bad";
    } catch {
      const score = parseFloat(competitionRate);
      if (score < 5.0) grade = "Excellent";
      else if (score < 15.0) grade = "Good";
      else if (score < 25.0) grade = "Fair";
      else grade = "Bad";
    }
  } else {
    const score = parseFloat(competitionRate);
    if (score < 5.0) grade = "Excellent";
    else if (score < 15.0) grade = "Good";
    else if (score < 25.0) grade = "Fair";
    else grade = "Bad";
    if (isExactRed && score > 20.0) grade = "Bad";
  }

  const baseAvgPrice = Math.floor((hash % 40) * 1000 + 20000);
  const minPrice = Math.floor(baseAvgPrice * (0.6 + (hash % 10) * 0.02));
  const maxPrice = Math.floor(baseAvgPrice * (1.8 + (hash % 10) * 0.05));

  let trendData: number[] = [];
  const NAVER_ID = process.env.NAVER_CLIENT_ID;
  const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

  if (NAVER_ID && NAVER_SECRET) {
    try {
      const today = new Date();
      const lastYear = new Date();
      lastYear.setFullYear(today.getFullYear() - 1);
      const naverRes = await fetch("https://openapi.naver.com/v1/datalab/search", {
        method: "POST",
        headers: {
          "X-Naver-Client-Id": NAVER_ID,
          "X-Naver-Client-Secret": NAVER_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: lastYear.toISOString().split("T")[0],
          endDate: today.toISOString().split("T")[0],
          timeUnit: "month",
          keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
        }),
      });
      if (naverRes.ok) {
        const naverData = await naverRes.json();
        const results = naverData.results?.[0]?.data || [];
        if (results.length > 0) {
          trendData = results.map((d: any) => Math.floor(searchVolume * (Math.max(d.ratio, 5) / 100)));
          while (trendData.length < 12) trendData.unshift(Math.floor(searchVolume * 0.3));
          if (trendData.length > 12) trendData = trendData.slice(-12);
        }
      }
    } catch {}
  }

  if (!trendData || trendData.length === 0) {
    trendData = Array.from({ length: 12 }, (_, i) => {
      const monthHash = Math.sin((hash + i) * 0.5) * 0.3 + 1;
      return Math.floor(searchVolume * monthHash * 0.8);
    });
  }

  const marketTrend = searchVolume > 30000 ? "Volume Burst" : grade === "Excellent" ? "Niche Gold" : "Steady Growth";

  return res.status(200).json({
    keyword,
    searchVolume,
    totalProducts,
    competitionRate: parseFloat(competitionRate),
    grade,
    averagePrice: baseAvgPrice,
    minPrice,
    maxPrice,
    trendData,
    marketTrend,
    top10VolumeIndex: Math.floor((hash % 30) * 5 + 30),
  });
}
