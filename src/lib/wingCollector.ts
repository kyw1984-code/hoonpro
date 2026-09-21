/**
 * 윙 판매분석 즐겨찾기 — 로켓그로스 취소를 한 번 클릭으로 가져온다.
 *
 * 로켓그로스 주문 API는 취소를 안 준다. 취소는 윙 > 비즈니스 인사이트 > 판매분석의
 * 옵션별 파일에만 있는데, 윙은 로그인이 HttpOnly 쿠키라 우리 서버가 대신 받을 수
 * 없다. 광고센터와 같은 방식으로 간다 — 코드를 판매자의 브라우저에 보내 윙 안에서
 * 돌린다. 쿠키는 브라우저가 알아서 붙이고 우리는 아무것도 보관하지 않는다.
 *
 * 윙 내부 주소는 공개돼 있지 않다. 그래서 주소를 미리 알 필요가 없게 만들었다:
 * 즐겨찾기를 누른 뒤 판매자가 평소처럼 날짜를 고르고 [다운로드]를 누르면, 페이지가
 * 받는 그 파일을 가로채 훈프로 창(window.open)에 postMessage로 넘긴다. 받는 쪽
 * (WingCancelReceiver)이 파일을 읽어 그 날짜 그로스 매출에서 취소를 뺀다.
 *
 * 함께, 페이지가 보낸 요청의 경로·상태·응답 종류를 훈프로에 보낸다(값은 안 보낸다).
 * 다음 판에서 다운로드 클릭 없이 바로 부를 수 있게 하기 위한 단서다.
 *
 * 아래 collector는 toString()으로 문자열이 되어 즐겨찾기에 실린다. 이 파일의 다른
 * 것을 참조하면 안 되고, 옵셔널 체이닝 같은 문법도 피한다.
 */

export const WING_ORIGIN = 'https://wing.coupang.com';
export const WING_COLLECT_QUERY = 'wing-collect';
export const WING_INSIGHT_PATH = '/tenants/business-insight';

function collector(origin: string) {
  var HOST = 'wing.coupang.com';
  if (location.host !== HOST) {
    alert('쿠팡 윙(' + HOST + ')의 판매분석 화면에서 이 즐겨찾기를 눌러주세요.');
    return;
  }
  if ((window as any).__hoonproWing) {
    alert('이미 켜져 있습니다. 판매분석에서 날짜를 고르고 [다운로드]를 누르세요.');
    return;
  }
  (window as any).__hoonproWing = true;

  // 사용자가 누른 그 순간에 창을 열어야 팝업 차단에 안 걸린다
  var win = window.open(origin + '/?wing-collect=1', 'hoonpro-wing-collect');
  if (!win) {
    alert('팝업이 차단됐습니다. 주소창 오른쪽의 팝업 차단 아이콘을 눌러 허용한 뒤 다시 눌러주세요.');
    (window as any).__hoonproWing = false;
    return;
  }

  var box = document.createElement('div');
  box.setAttribute(
    'style',
    'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:380px;padding:12px 16px;' +
      'border-radius:10px;background:#111827;color:#f9fafb;font:13px/1.5 -apple-system,system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
  );
  document.body.appendChild(box);
  var say = function (t: string) {
    box.textContent = '훈프로 취소 가져오기 — ' + t;
  };
  var send = function (msg: any, transfer?: any[]) {
    try {
      win.postMessage(msg, origin, transfer || []);
    } catch (e) {
      /* 창이 닫혔으면 알릴 곳이 없다 */
    }
  };

  // 값은 보내지 않는다. 경로와 질의 키, 긴 값(토큰일 수 있다)은 앞 8자만.
  var mask = function (u: string) {
    try {
      var x = new URL(u, location.href);
      var q: string[] = [];
      x.searchParams.forEach(function (v, k) {
        q.push(k + '=' + (v.length > 40 ? v.slice(0, 8) + '…' : v));
      });
      return x.pathname + (q.length ? '?' + q.join('&') : '');
    } catch (e) {
      return String(u).slice(0, 200);
    }
  };
  var bodyKeys = function (body: any) {
    try {
      if (typeof body !== 'string') return '';
      var j = JSON.parse(body);
      return j && typeof j === 'object' ? Object.keys(j).slice(0, 20).join(',') : '';
    } catch (e) {
      return '';
    }
  };
  var captured: any[] = [];
  var record = function (method: string, url: string, status: number, ctype: string, kind: string, body?: any) {
    if (captured.length >= 80) return;
    captured.push({ m: method, u: mask(url), s: status, c: String(ctype || '').slice(0, 60), k: kind, b: bodyKeys(body) });
  };
  var isFile = function (url: string, ctype: string) {
    if (/json|html|javascript|css|image|font/i.test(ctype || '')) return false;
    return /spreadsheet|excel|octet-stream|csv/i.test(ctype || '') || /xlsx|excel|download|export/i.test(url || '');
  };

  var sent = false;
  var timer: any = null;
  // 훈프로 창이 "받을 준비 됐다"(hoonpro-wing-ready)고 알려오기 전에는 보내지
  // 않는다. 창이 아직 뜨는 중이거나 로그인 화면이면 듣는 사람이 없어 파일이
  // 허공에 사라지고, 판매자는 "보냈습니다"만 보게 된다. 그때는 들고 있다가
  // 준비되면 보낸다.
  var ready = false;
  var pending: { buf: ArrayBuffer; url: string; ctype: string } | null = null;
  var finish = function (ok: boolean) {
    if (timer) clearTimeout(timer);
    send({ type: 'hoonpro-wing-capture', requests: captured, page: location.pathname, ok: ok });
    box.style.background = ok ? '#14532d' : '#7f1d1d';
    say(
      ok
        ? '보냈습니다. 훈프로 창에서 결과를 확인하세요.'
        : pending
          ? '파일은 받았지만 훈프로 창이 준비되지 않았습니다. 훈프로 창에 로그인한 뒤 이 즐겨찾기를 다시 눌러주세요.'
          : '3분 안에 파일을 받지 못했습니다. 판매분석 화면에서 [다운로드]를 눌렀는지 확인하고 다시 눌러주세요.',
    );
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
      (window as any).__hoonproWing = false;
    }, 8000);
  };
  var deliver = function (buf: ArrayBuffer, url: string, ctype: string) {
    sent = true;
    say('파일을 훈프로로 보내는 중...');
    send({ type: 'hoonpro-wing-report', buffer: buf, url: mask(url), contentType: ctype, page: location.pathname }, [buf]);
    finish(true);
  };
  var forward = function (buf: ArrayBuffer, url: string, ctype: string) {
    if (sent || pending) return;
    if (!ready) {
      pending = { buf: buf, url: url, ctype: ctype };
      say('파일을 받았습니다. 훈프로 창이 준비되면 보냅니다 — 훈프로 창에 로그인 화면이 떠 있으면 로그인해 주세요.');
      return;
    }
    deliver(buf, url, ctype);
  };
  window.addEventListener('message', function (ev: MessageEvent) {
    if (ev.origin !== origin || !ev.data || ev.data.type !== 'hoonpro-wing-ready') return;
    ready = true;
    if (pending && !sent) {
      var p = pending;
      pending = null;
      deliver(p.buf, p.url, p.ctype);
    }
  });

  // ① fetch로 받는 파일
  var origFetch = window.fetch;
  window.fetch = function (this: any, input: any, init?: any) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var body = init && init.body;
    return origFetch.apply(this, arguments as any).then(function (res: Response) {
      try {
        var ct = res.headers.get('content-type') || '';
        record(method, url, res.status, ct, 'fetch', body);
        if (res.ok && isFile(url, ct)) {
          res.clone().arrayBuffer().then(function (b) {
            forward(b, url, ct);
          });
        }
      } catch (e) {
        /* 기록은 실패해도 페이지는 계속 간다 */
      }
      return res;
    });
  };
  // ② XMLHttpRequest로 받는 파일
  var XO = XMLHttpRequest.prototype.open;
  var XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: any, m: string, u: string) {
    this.__hp = { m: m, u: String(u) };
    return XO.apply(this, arguments as any);
  };
  XMLHttpRequest.prototype.send = function (this: any, body?: any) {
    var x = this;
    x.addEventListener('loadend', function () {
      try {
        var ct = x.getResponseHeader('content-type') || '';
        var info = x.__hp || {};
        record(info.m || 'GET', info.u || '', x.status, ct, 'xhr', body);
        if (x.status >= 200 && x.status < 300 && isFile(info.u, ct)) {
          var r = x.response;
          if (r instanceof ArrayBuffer) forward(r, info.u, ct);
          else if (r instanceof Blob) r.arrayBuffer().then(function (b) { forward(b, info.u, ct); });
        }
      } catch (e) {
        /* 위와 같다 */
      }
    });
    return XS.apply(this, arguments as any);
  };
  // ③ 새 창이나 링크로 내려받는 파일 — 주소를 가로채 우리가 직접 받는다
  var origOpen = window.open;
  window.open = function (this: any, u?: any) {
    try {
      if (u && isFile(String(u), '')) {
        record('OPEN', String(u), 0, '', 'open');
        origFetch(String(u), { credentials: 'include' }).then(function (res) {
          var ct = res.headers.get('content-type') || '';
          if (res.ok) res.arrayBuffer().then(function (b) { forward(b, String(u), ct); });
        });
        return null;
      }
    } catch (e) {
      /* 실패하면 원래대로 연다 */
    }
    return origOpen.apply(this, arguments as any);
  };
  document.addEventListener(
    'click',
    function (ev: any) {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (!a) return;
      var h = a.getAttribute('href') || '';
      if (a.hasAttribute('download') || isFile(h, '')) {
        record('A', h, 0, '', 'anchor');
        ev.preventDefault();
        origFetch(h, { credentials: 'include' }).then(function (res) {
          var ct = res.headers.get('content-type') || '';
          if (res.ok) res.arrayBuffer().then(function (b) { forward(b, h, ct); });
        });
      }
    },
    true,
  );

  say('훈프로 창을 열었습니다. 이 화면에서 날짜를 고르고 [다운로드]를 누르세요 — 파일을 가로채 훈프로로 보냅니다. (3분 안에)');
  timer = setTimeout(function () {
    if (!sent) finish(false);
  }, 180000);
}

/** 즐겨찾기에 넣을 javascript: 주소. origin은 훈프로 주소(https://hoonproai.com) */
export function buildWingBookmarklet(origin: string): string {
  const src = `(${collector.toString()})(${JSON.stringify(origin)})`;
  return `javascript:${encodeURIComponent(src)}`;
}
