#!/usr/bin/env node
/**
 * 쿠팡 Open API 고정 IP 중계 서버
 *
 * 왜 필요한가
 *   쿠팡은 '자체개발(직접입력)' 연동에 등록된 IP에서만 API 호출을 허용한다.
 *   Vercel 서버리스는 고정 아웃바운드 IP가 없고, Vercel의 Static IPs 기능은
 *   프로젝트당 월 $100다. 대신 아무 VPS에나 이 파일을 띄우면 그 서버의 IP가
 *   유일한 출구가 되고, 판매자들은 그 IP 하나만 윙에 등록하면 된다.
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
 *   · 공유 비밀키가 없거나 틀리면 즉시 거절한다.
 *   · 목적지 호스트를 쿠팡 API 게이트웨이로 고정한다. 임의 URL을 넘겨
 *     내부망을 찌르는 SSRF를 막기 위해서다.
 *   · 서명은 훈프로 서버에서 이미 끝난 상태로 오므로, 중계는 키를 모른다.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const SECRET = (process.env.RELAY_SECRET || '').trim();
const ALLOWED_HOST = 'api-gateway.coupang.com';
const MAX_BODY = 2 * 1024 * 1024; // 2MB

if (!SECRET) {
  console.error('RELAY_SECRET 환경변수가 필요합니다. 임의의 긴 랜덤 문자열을 넣어주세요.');
  process.exit(1);
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
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  if (req.method !== 'POST') return send(405, { error: 'POST만 허용됩니다' });

  // 타이밍 공격을 피하려고 길이를 먼저 맞춰 비교한다
  const given = String(req.headers['x-relay-secret'] || '');
  if (given.length !== SECRET.length || given !== SECRET) {
    return send(401, { error: 'unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return send(400, { error: '본문을 읽을 수 없습니다' });
  }

  const { method, url, headers, body } = payload ?? {};
  if (!method || !url) return send(400, { error: 'method와 url이 필요합니다' });

  let target;
  try {
    target = new URL(url);
  } catch {
    return send(400, { error: 'url 형식이 올바르지 않습니다' });
  }
  if (target.protocol !== 'https:' || target.hostname !== ALLOWED_HOST) {
    return send(403, { error: `허용되지 않은 목적지입니다: ${target.hostname}` });
  }

  try {
    const upstream = await fetch(target.toString(), {
      method,
      headers: headers ?? {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    });
    res.end(text);
  } catch (e) {
    send(502, { error: `쿠팡 호출 실패: ${e?.message ?? e}` });
  }
});

server.listen(PORT, () => {
  console.log(`쿠팡 중계 서버가 ${PORT} 포트에서 대기 중입니다.`);
});
