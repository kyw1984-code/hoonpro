/**
 * 윙 판매 데이터(최근 28일 조회수·판매량) 수집 북마클릿.
 *
 * 쿠팡 윙의 상품 검색(아이템 매칭 화면이 쓰는 내부 검색)은 상품마다 최근 28일
 * 조회수(pvLast28Day)와 판매량(salesLast28d)을 돌려준다. 공개 API가 아니고 로그인
 * 쿠키가 있어야 해서, 광고센터 연결과 같은 방식으로 간다 — 코드를 판매자의
 * 브라우저에 보내 윙 안에서 돌리고, 결과만 열어 둔 훈프로 창에 postMessage로
 * 넘긴다. 로그인 정보는 어디에도 보관하지 않는다.
 *
 * 흐름
 *   ① 훈프로 창을 연다 (/?wing-stats=1) → 그 창이 "조회할 상품 목록"을 돌려준다
 *   ② 상품마다 itemId(없으면 productId)를 검색어로 윙 검색
 *   ③ 응답에서 같은 productId·itemId의 줄을 찾아 조회수·판매량·판매가를 뽑는다
 *   ④ 모아서 훈프로 창에 넘긴다 → 그 창이 판매자 본인 세션으로 저장
 *
 * 쿠팡 내부 주소·응답 형태는 예고 없이 바뀐다. 그래서 주소는 두 개를 차례로
 * 시도하고, 응답은 형태를 가정하지 않고 pvLast28Day가 든 객체를 찾아낸다.
 * 차단 신호(401·403·429)가 오면 바로 멈춘다 — 계속 두드리면 계정이 위험하다.
 *
 * collector는 toString()으로 북마클릿에 실린다. 바깥을 참조하면 안 되고
 * 옵셔널 체이닝 같은 문법도 피한다.
 */

export const WING_ORIGIN = 'https://wing.coupang.com';
export const WING_STATS_QUERY = 'wing-stats';
/** SourcingFinder가 조회할 상품을 적어 두는 곳 (받는 창이 읽는다) */
export const WING_WANTED_KEY = 'hoonpro_wing_wanted';
/** 한 번에 조회하는 상품 수 상한 — 많이 두드릴수록 차단 위험이 커진다 */
export const WING_MAX_ITEMS = 40;

export interface WingWanted { productId: string; itemId?: string; name?: string }
export interface WingStatRow {
  productId: string; itemId?: string; vendorItemId?: string;
  pv28: number | null; sales28: number | null; salePrice: number | null;
}

function collector(origin: string) {
  if (location.host !== 'wing.coupang.com') {
    alert('쿠팡 윙(wing.coupang.com)에 로그인한 화면에서 이 즐겨찾기를 눌러주세요.');
    return;
  }
  var win = window.open(origin + '/?wing-stats=1', 'hoonpro-wing-stats');
  if (!win) {
    alert('팝업이 차단됐습니다. 주소창 오른쪽의 팝업 차단 아이콘을 눌러 허용한 뒤 다시 눌러주세요.');
    return;
  }
  var box = document.createElement('div');
  box.setAttribute(
    'style',
    'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;' +
      'border-radius:10px;background:#111827;color:#f9fafb;font:13px/1.5 -apple-system,system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
  );
  document.body.appendChild(box);
  var say = function (t: string) { box.textContent = '훈프로 판매 데이터 — ' + t; };
  var post = function (msg: any) { try { win!.postMessage(msg, origin); } catch (e) { /* 창이 닫혔다 */ } };
  var fail = function (t: string) { box.style.background = '#7f1d1d'; say(t); post({ type: 'hoonpro-wing-error', message: t }); };

  var wanted: any[] | null = null;
  window.addEventListener('message', function (ev) {
    if (ev.origin === origin && ev.data && ev.data.type === 'hoonpro-wing-wanted') wanted = ev.data.items || [];
  });

  var sleep = function (ms: number) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var cookie = function (name: string) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  // 응답 형태를 가정하지 않는다 — pvLast28Day나 salesLast28d가 든 객체를 전부 모은다
  var collect = function (node: any, out: any[], depth: number) {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) collect(node[i], out, depth + 1); return; }
    if (typeof node !== 'object') return;
    if ('pvLast28Day' in node || 'salesLast28d' in node) { out.push(node); return; }
    for (var k in node) collect(node[k], out, depth + 1);
  };
  var ENDPOINTS = [
    { url: '/tenants/seller-web/post-matching/search', extra: {} as any },
    { url: '/tenants/seller-web/pre-matching/search-v2', extra: { sortType: 'DEFAULT' } as any },
  ];
  var working = -1;
  var search = async function (keyword: string) {
    var order = working >= 0 ? [working] : [0, 1];
    var lastStatus = 0;
    for (var o = 0; o < order.length; o++) {
      var ep = ENDPOINTS[order[o]];
      var body: any = { keyword: keyword, excludedProductIds: [], searchPage: 0, searchOrder: 'DEFAULT' };
      for (var x in ep.extra) body[x] = ep.extra[x];
      var headers: any = { 'Content-Type': 'application/json', Accept: 'application/json' };
      var xsrf = cookie('XSRF-TOKEN');
      if (xsrf) headers['x-xsrf-token'] = xsrf;
      var res = await fetch(ep.url, { method: 'POST', credentials: 'include', headers: headers, body: JSON.stringify(body) });
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403 || res.status === 429) throw { blocked: true, status: res.status };
      if (!res.ok) continue;
      var json: any = null;
      try { json = await res.json(); } catch (e) { continue; }
      working = order[o];
      var rows: any[] = [];
      collect(json, rows, 0);
      return rows;
    }
    throw { status: lastStatus };
  };

  var run = async function () {
    say('훈프로 창을 기다리는 중...');
    for (var w = 0; w < 60 && wanted === null; w++) {
      if (win!.closed) throw new Error('훈프로 창이 닫혔습니다. 다시 눌러주세요.');
      post({ type: 'hoonpro-wing-hello' });
      await sleep(1000);
    }
    if (wanted === null) throw new Error('훈프로 창이 응답하지 않습니다. 훈프로에 로그인돼 있는지 확인하고 다시 눌러주세요.');
    if (wanted.length === 0) throw new Error('조회할 상품이 없습니다. 훈프로 소싱AI에서 키워드를 먼저 분석해 주세요.');

    var out: any[] = [];
    var miss = 0;
    for (var i = 0; i < wanted.length; i++) {
      var it = wanted[i];
      say('조회 중 ' + (i + 1) + ' / ' + wanted.length + ' (찾음 ' + out.length + ')');
      var rows: any[];
      try {
        rows = await search(String(it.itemId || it.productId));
      } catch (e) {
        var err: any = e;
        if (err && err.blocked) {
          if (out.length) post({ type: 'hoonpro-wing-stats', rows: out, partial: true });
          throw new Error('윙이 요청을 거절했습니다 (HTTP ' + err.status + '). 로그인이 풀렸거나 일시 차단입니다. ' + (out.length ? out.length + '개까지는 저장했습니다. ' : '') + '잠시 뒤 다시 시도해 주세요.');
        }
        if (i === 0) throw new Error('윙 검색 주소가 응답하지 않습니다 (HTTP ' + ((err && err.status) || '?') + '). 쿠팡이 화면을 바꿨을 수 있습니다.');
        miss++;
        await sleep(1500);
        continue;
      }
      var hit: any = null;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if ((it.itemId && String(row.itemId) === String(it.itemId)) || String(row.productId) === String(it.productId)) { hit = row; break; }
      }
      if (hit) {
        var num = function (v: any) { var n = Number(v); return isFinite(n) && n >= 0 ? n : null; };
        out.push({
          productId: String(it.productId), itemId: hit.itemId != null ? String(hit.itemId) : undefined,
          vendorItemId: hit.vendorItemId != null ? String(hit.vendorItemId) : undefined,
          pv28: num(hit.pvLast28Day), sales28: num(hit.salesLast28d), salePrice: num(hit.salePrice),
        });
      } else {
        miss++;
      }
      // 사람이 검색하는 속도에 맞춘다. 간격을 조금씩 흔든다
      await sleep(1200 + Math.floor(Math.random() * 800));
    }
    post({ type: 'hoonpro-wing-stats', rows: out, partial: false, missed: miss });
    box.style.background = '#14532d';
    say(out.length + '개 상품의 판매 데이터를 보냈습니다' + (miss ? ' (못 찾음 ' + miss + ')' : '') + '. 훈프로 창을 확인하세요.');
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 8000);
    try { win!.focus(); } catch (e) { /* 무시 */ }
  };
  run().catch(function (e) { fail((e && e.message) || String(e)); });
}

/** 즐겨찾기에 넣을 javascript: 주소 */
export function buildWingStatsBookmarklet(origin: string): string {
  return `javascript:${encodeURIComponent(`(${collector.toString()})(${JSON.stringify(origin)})`)}`;
}

/** 쿠팡 상품 주소에서 옵션 번호를 뽑는다 (검색 결과 주소에 itemId가 붙어 있다) */
export function itemIdFromUrl(url: string): string | undefined {
  const m = String(url || '').match(/[?&]itemId=(\d+)/);
  return m ? m[1] : undefined;
}

/** 전환율(%) — 조회수가 없으면 계산하지 않는다 */
export function conversionRate(pv28: number | null | undefined, sales28: number | null | undefined): number | null {
  if (!pv28 || pv28 <= 0 || sales28 == null || sales28 < 0) return null;
  return Math.round((sales28 / pv28) * 10000) / 100;
}
