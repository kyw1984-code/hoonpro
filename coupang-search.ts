import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac } from "crypto";

// ─── Vercel Serverless Function ───────────────────────────────────────────────
// 환경변수: COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY
// Vercel 대시보드 → Settings → Environment Variables 에서 설정
// ─────────────────────────────────────────────────────────────────────────────

const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.COUPANG_SECRET_KEY ?? "";

function buildDatetime(): string {
  return (
    new Date().toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z"
  );
}

function generateSignature(secretKey: string, message: string): string {
  return createHmac("sha256", secretKey).update(message).digest("hex");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 허용
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
    const method   = "GET";
    const path     = "/v2/providers/affiliate_open_api/apis/openapi/products/search";
    const query    = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
    const datetime = buildDatetime();
    const message  = datetime + method + path + query;
    const signature = generateSignature(SECRET_KEY, message);

    const apiRes = await fetch(
      `https://api-gateway.coupang.com${path}?${query}`,
      {
        headers: {
          Authorization: `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`,
          "Content-Type": "application/json;charset=UTF-8",
        },
      }
    );

    const data = await apiRes.json();

    if (data.rCode !== "0") {
      return res.status(400).json({ error: data.rMessage ?? "Coupang API error" });
    }

    return res.status(200).json({ products: data.data?.productData ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
