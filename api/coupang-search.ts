import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac } from "crypto";

const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.COUPANG_SECRET_KEY ?? "";

function buildDatetime(): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const MM = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const HH = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return yy + MM + dd + "T" + HH + mm + ss + "Z";
}

function generateSignature(secretKey: string, message: string): string {
  return createHmac("sha256", secretKey).update(message).digest("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
  const limit   = typeof req.query.limit   === "string" ? req.query.limit   : "10";

  if (!keyword) {
    return res.status(400).json({ error: "keyword is required" });
  }

  if (!ACCESS_KEY || !SECRET_KEY) {
    return res.status(500).json({ error: "API keys not configured on server" });
  }

  try {
    const method    = "GET";
    const path      = "/v2/providers/affiliate_open_api/apis/openapi/products/search";
    const query     = "keyword=" + encodeURIComponent(keyword) + "&limit=" + limit;
    const datetime  = buildDatetime();
    const message   = datetime + method + path + query;
    const signature = generateSignature(SECRET_KEY, message);

    const apiRes = await fetch(
      "https://api-gateway.coupang.com" + path + "?" + query,
      {
        headers: {
          Authorization: "CEA algorithm=HmacSHA256, access-key=" + ACCESS_KEY + ", signed-date=" + datetime + ", signature=" + signature,
          "Content-Type": "application/json;charset=UTF-8",
        },
      }
    );

    const data = await apiRes.json();

    // 전체 상품 가격 목록 출력
    console.log("가격 목록:", JSON.stringify((data.data?.productData ?? []).map((p: any) => ({
      id: p.productId,
      name: p.productName?.slice(0, 20),
      price: p.productPrice,
      landingUrl: p.landingUrl?.slice(0, 60),
    }))));

    if (data.rCode !== "0") {
      return res.status(400).json({ error: data.rMessage ?? "Coupang API error", rCode: data.rCode });
    }

    return res.status(200).json({
      products: (data.data?.productData ?? []).map((p: any) => ({
        productId:    String(p.productId),
        productName:  p.productName  ?? "",
        productPrice: p.productPrice ?? 0,
        productImage: p.productImage ?? "",
        productUrl:   p.landingUrl   ?? p.productUrl ?? "#",
        isRocket:     p.isRocket     ?? p.rocketBadge ?? false,
        rating:       p.rating       ?? p.starRating  ?? 0,
        reviewCount:  p.reviewCount  ?? p.review      ?? 0,
        salesRank:    p.salesRank    ?? null,
      }))
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
