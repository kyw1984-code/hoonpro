#!/usr/bin/env node
/**
 * 쿠팡 Open API 고정 IP 중계 서버
 *
 * 왜 필요한가
 *   쿠팡은 '자체개발(직접입력)' 연동에 등록된 IP에서만 API 호출을 허용한다.
 *   Vercel 서버리스는 고정 아웃바운드 IP가 없고, Vercel의 Static IPs 기능은
 *   프로젝트당 월 $100다. 대신 월 5달러짜리 최소 인스턴스에 이 파일을 띄우면
 *   그 서버의 IP가 유일한 출구가 되고, 판매자들은 그 IP 하나만 윙에 등록하면 된다.
 *   요청을 그대로 넘기기만 하므로 가장 싼 인스턴스로 충분하다.
 *
 * 띄우는 법
 *   1) 고정 IP가 있는 서버에 이 파일을 올린다 (Node 18 이상)
 *   2) RELAY_SECRET=충분히-긴-랜덤-문자열 PORT=8080 node coupang-relay.mjs
 *   3) 앞단에 HTTPS를 붙인다 (Caddy·nginx 등). 평문 HTTP로 열지 말 것 —
 *      요청에 쿠팡 서명 헤더가 실려 나간다.
 *   4) Vercel 환경변수에 등록
 *        COUPANG_RELAY_URL=https://relay.example.com/relay
 *        COUPANG_RELAY_SECRET=위와 같은 값
 *        COUPANG_RELAY_IP=이 서버의 공인 IP   (온보딩 화면에 안내로 표시된다)
 *
 * 보안
 *   · 공유 비밀키가 없거나 틀리면 즉시 거절한다. 비교는 상수 시간으로 한다.
 *   · 목적지 호스트를 쿠팡 API 게이트웨이로 고정한다. 임의 URL을 넘겨
 *     내부망을 찌르는 SSRF를 막기 위해서다.
 *   · 넘겨줄 헤더를 허용 목록으로 제한한다. 서명은 훈프로 서버에서 이미 끝난
 *     상태로 오므로, 중계는 키를 모른다.
 *   · 쿠팡이 응답을 안 주면 25초에 끊는다. 안 끊으면 훈프로 함수가 300초까지 묶인다.
 *
 * 오류 코드 규약 (훈프로 쪽이 이 규약에 의존한다)
 *   중계 서버 자체가 만든 오류에는 X-Relay-Error: 1 헤더를 붙이고,
 *   HTTP 상태는 쿠팡이 쓰는 401·403과 겹치지 않는 값을 쓴다.
 *   그래야 "중계 비밀키가 틀렸다"를 "판매자 키가 거부됐다"로 오인해
 *   판매자 계정을 무더기로 무효화하는 사고를 막을 수 있다.
 *     421  비밀키 불일치 / 허용되지 않은 목적지
 *     502  쿠팡에 닿지 못함
 *     504  쿠팡이 제한 시간 안에 응답하지 않음
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 8080);
const SECRET = (process.env.RELAY_SECRET || '').trim();
const ALLOWED_HOST = 'api-gateway.coupang.com';
const MAX_BODY = 2 * 1024 * 1024; // 2MB
const UPSTREAM_TIMEOUT_MS = 25_000;
const FORWARD_HEADERS = new Set(['authorization', 'content-type', 'accept']);

if (!SECRET) {
  console.error('RELAY_SECRET 환경변수가 필요합니다. 임의의 긴 랜덤 문자열을 넣어주세요.');
  process.exit(1);
}

const SECRET_BUF = Buffer.from(SECRET, 'utf8');

function secretMatches(given) {
  const buf = Buffer.from(String(given || ''), 'utf8');
  // 길이가 다르면 timingSafeEqual이 예외를 내므로 같은 길이의 더미와 비교해
  // 걸리는 시간을 맞춘다. 결과는 어차피 불일치다.
  if (buf.length !== SECRET_BUF.length) {
    timingSafeEqual(SECRET_BUF, SECRET_BUF);
    return false;
  }
  return timingSafeEqual(buf, SECRET_BUF);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('본문이 너무 큽니다'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const relayError = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Relay-Error': '1' });
    res.end(JSON.stringify(obj));
  };

  // 상태 확인 — 비밀키를 같이 보내면 그 값이 맞는지도 알려준다.
  // 훈프로 크론이 수집 전에 여기를 먼저 두드려, 비밀키가 어긋난 상태로
  // 판매자 계정을 건드리는 일을 막는다.
  if (req.method === 'GET' && req.url === '/health') {
    const given = req.headers['x-relay-secret'];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, auth: given === undefined ? null : secretMatches(given) }));
    return;
  }

  if (req.method !== 'POST') return relayError(421, { error: 'POST만 허용됩니다' });

  if (!secretMatches(req.headers['x-relay-secret'])) {
    return relayError(421, { error: 'relay secret mismatch' });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return relayError(421, { error: '본문을 읽을 수 없습니다' });
  }

  const { method, url, headers, body } = payload ?? {};
  if (!method || !url) return relayError(421, { error: 'method와 url이 필요합니다' });

  let target;
  try {
    target = new URL(url);
  } catch {
    return relayError(421, { error: 'url 형식이 올바르지 않습니다' });
  }
  if (target.protocol !== 'https:' || target.hostname !== ALLOWED_HOST) {
    return relayError(421, { error: `허용되지 않은 목적지입니다: ${target.hostname}` });
  }

  const safeHeaders = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (FORWARD_HEADERS.has(String(k).toLowerCase()) && typeof v === 'string') safeHeaders[k] = v;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(target.toString(), {
      method,
      headers: safeHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await upstream.text();
    // 쿠팡의 응답은 상태 코드까지 그대로 넘긴다. 401·403은 진짜 키 문제다.
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    });
    res.end(text);
  } catch (e) {
    if (e?.name === 'AbortError') return relayError(504, { error: '쿠팡이 제한 시간 안에 응답하지 않았습니다' });
    relayError(502, { error: `쿠팡 호출 실패: ${e?.message ?? e}` });
  } finally {
    clearTimeout(timer);
  }
});

server.listen(PORT, () => {
  console.log(`쿠팡 중계 서버가 ${PORT} 포트에서 대기 중입니다.`);
});
