// 쇼크트리 화면 ↔ 확장 프로그램 다리.
// 이 파일은 쇼크트리 페이지(hoonproai.com)에만 들어간다. 페이지가 보낸 요청을
// 백그라운드로 넘기고, 진행 상황·결과를 페이지로 돌려준다. 같은 창·같은 출처의
// 메시지만 받는다 — 다른 사이트가 이 다리를 쓰지 못하게.
(function () {
  var VERSION = chrome.runtime.getManifest().version;
  var announce = function () {
    window.postMessage({ hoonproExtReady: true, version: VERSION }, location.origin);
  };
  try { document.documentElement.setAttribute('data-hoonpro-ext', VERSION); } catch (e) { /* 무시 */ }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window || ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.hoonproExt !== true) return;
    if (d.type === 'ping') { announce(); return; }
    if (d.type !== 'wing-stats' && d.type !== 'ad-report') return;

    var port = chrome.runtime.connect({ name: d.type });
    var reply = function (msg) {
      msg.hoonproExtReply = true; msg.requestId = d.requestId;
      window.postMessage(msg, location.origin);
    };
    port.onMessage.addListener(function (m) { reply(m); if (m.kind === 'done' || m.kind === 'error') port.disconnect(); });
    port.onDisconnect.addListener(function () {
      var err = chrome.runtime.lastError;
      if (err) reply({ kind: 'error', message: '확장 프로그램과 연결이 끊겼습니다. 페이지를 새로고침해 주세요.' });
    });
    if (d.type === 'wing-stats') port.postMessage({ items: Array.isArray(d.items) ? d.items.slice(0, 40) : [] });
    else port.postMessage({ days: Number(d.days) || 30 });
  });

  announce();
  document.addEventListener('DOMContentLoaded', announce);
})();
