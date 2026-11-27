// 윙 상품 검색으로 최근 28일 조회수·판매량을 읽는다.
// 이 함수는 두 곳에서 그대로 돈다 — 백그라운드에서 직접(base = 윙 주소),
// 그리고 막히면 윙 탭 안에 주입해서(base = ''). 그래서 바깥을 참조하지 않는다.
// 401·403·429가 오면 바로 멈춘다. 계속 두드리면 계정이 위험하다.
async function hoonproWingSearchAll(items, base, xsrf, progressKey) {
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  if (!xsrf && typeof document !== 'undefined') {
    var m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/);
    xsrf = m ? decodeURIComponent(m[1]) : '';
  }
  var collect = function (node, out, depth) {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) collect(node[i], out, depth + 1); return; }
    if (typeof node !== 'object') return;
    if ('pvLast28Day' in node || 'salesLast28d' in node) { out.push(node); return; }
    for (var k in node) collect(node[k], out, depth + 1);
  };
  var ENDPOINTS = [
    { url: '/tenants/seller-web/post-matching/search', extra: {} },
    { url: '/tenants/seller-web/pre-matching/search-v2', extra: { sortType: 'DEFAULT' } },
  ];
  var working = -1;
  var search = async function (keyword) {
    var order = working >= 0 ? [working] : [0, 1];
    var lastStatus = 0;
    for (var o = 0; o < order.length; o++) {
      var ep = ENDPOINTS[order[o]];
      var body = { keyword: keyword, excludedProductIds: [], searchPage: 0, searchOrder: 'DEFAULT' };
      for (var x in ep.extra) body[x] = ep.extra[x];
      var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (xsrf) headers['x-xsrf-token'] = xsrf;
      var res = await fetch(base + ep.url, { method: 'POST', credentials: 'include', headers: headers, body: JSON.stringify(body) });
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403 || res.status === 429) throw { blocked: true, status: res.status };
      if (!res.ok) continue;
      var json = null;
      try { json = await res.json(); } catch (e) { throw { notJson: true, status: res.status }; }
      working = order[o];
      var rows = [];
      collect(json, rows, 0);
      return rows;
    }
    throw { status: lastStatus };
  };
  var num = function (v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : null; };

  var out = [], miss = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (progressKey && typeof self !== 'undefined' && self[progressKey]) self[progressKey](i, items.length, out.length);
    var rows;
    try {
      rows = await search(String(it.itemId || it.productId));
    } catch (e) {
      if (e && (e.blocked || e.notJson)) return { rows: out, missed: miss, stopped: e.blocked ? 'blocked' : 'notJson', status: e.status };
      if (i === 0) return { rows: out, missed: miss, stopped: 'endpoint', status: e && e.status };
      miss++; await sleep(1500); continue;
    }
    var hit = null;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if ((it.itemId && String(row.itemId) === String(it.itemId)) || String(row.productId) === String(it.productId)) { hit = row; break; }
    }
    if (hit) {
      out.push({
        productId: String(it.productId), itemId: hit.itemId != null ? String(hit.itemId) : undefined,
        vendorItemId: hit.vendorItemId != null ? String(hit.vendorItemId) : undefined,
        pv28: num(hit.pvLast28Day), sales28: num(hit.salesLast28d), salePrice: num(hit.salePrice),
        category: typeof hit.category === 'string' ? hit.category.slice(0, 300) : undefined,
      });
    } else miss++;
    await sleep(1200 + Math.floor(Math.random() * 800));
  }
  return { rows: out, missed: miss, stopped: null };
}
