// 훈프로 도우미 — 백그라운드.
// 1) 윙 쿠키가 있으면 여기서 바로 윙 검색을 부른다 (탭을 열 필요 없음).
// 2) 윙이 이 방식의 요청을 받아 주지 않으면(로그인 화면으로 돌리거나 거절),
//    열려 있는 윙 탭(없으면 뒤에서 하나 열어)에 같은 코드를 넣어 돌린다.
importScripts('wingSearch.js', 'adCollect.js');

const WING = 'https://wing.coupang.com';

async function wingCookie(name) {
  try { const c = await chrome.cookies.get({ url: WING, name }); return c ? c.value : ''; } catch { return ''; }
}

async function hasWingSession() {
  try { const all = await chrome.cookies.getAll({ domain: 'coupang.com' }); return all.length > 0; } catch { return false; }
}

async function runInWingTab(items) {
  let tabs = await chrome.tabs.query({ url: WING + '/*' });
  let tab = tabs.find(t => t.status === 'complete') || tabs[0];
  let opened = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: WING + '/', active: false });
    opened = true;
    await new Promise(resolve => {
      const done = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(resolve, 20000);
    });
  }
  try {
    const t = await chrome.tabs.get(tab.id);
    if (!t.url || !t.url.startsWith(WING)) return { rows: [], missed: 0, stopped: 'login' };
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: hoonproWingSearchAll, args: [items, '', '', null],
    });
    return res && res.result ? res.result : { rows: [], missed: 0, stopped: 'endpoint' };
  } finally {
    if (opened) { try { await chrome.tabs.remove(tab.id); } catch { /* 무시 */ } }
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'wing-stats') return;
  port.onMessage.addListener(async msg => {
    const items = Array.isArray(msg.items) ? msg.items.slice(0, 40) : [];
    const send = m => { try { port.postMessage(m); } catch { /* 페이지가 닫혔다 */ } };
    if (items.length === 0) return send({ kind: 'error', message: '조회할 상품이 없습니다.' });
    if (!(await hasWingSession())) return send({ kind: 'error', message: '쿠팡 윙에 로그인돼 있지 않습니다. 같은 브라우저에서 wing.coupang.com에 로그인한 뒤 다시 눌러주세요.' });

    self.__hoonproProgress = (i, total, found) => send({ kind: 'progress', done: i, total, found });
    send({ kind: 'progress', done: 0, total: items.length, found: 0, mode: 'direct' });
    let result = await hoonproWingSearchAll(items, WING, await wingCookie('XSRF-TOKEN'), '__hoonproProgress');

    // 직접 호출이 처음부터 막혔으면 윙 탭 안에서 다시 시도
    if (result.rows.length === 0 && result.stopped) {
      send({ kind: 'progress', done: 0, total: items.length, found: 0, mode: 'tab' });
      result = await runInWingTab(items);
    }
    if (result.stopped === 'login') return send({ kind: 'error', message: '윙 로그인이 풀려 있습니다. wing.coupang.com에 다시 로그인한 뒤 눌러주세요.' });
    if (result.rows.length === 0 && result.stopped === 'blocked') return send({ kind: 'error', message: `윙이 요청을 거절했습니다 (HTTP ${result.status}). 로그인이 풀렸거나 일시 차단입니다. 잠시 뒤 다시 시도해 주세요.` });
    if (result.rows.length === 0 && result.stopped) return send({ kind: 'error', message: `윙 검색이 응답하지 않습니다 (HTTP ${result.status ?? '?'}). 쿠팡이 화면을 바꿨을 수 있습니다.` });
    send({ kind: 'done', rows: result.rows, missed: result.missed, partial: Boolean(result.stopped) });
  });
});

// ── 광고센터 광고비 보고서 ──
const ADS = 'https://advertising.coupang.com';

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'ad-report') return;
  port.onMessage.addListener(async msg => {
    const send = m => { try { port.postMessage(m); } catch { /* 페이지가 닫혔다 */ } };
    const days = [30, 90, 180, 365].includes(Number(msg.days)) ? Number(msg.days) : 30;
    let tabs = await chrome.tabs.query({ url: ADS + '/*' });
    let tab = tabs.find(t => t.status === 'complete') || tabs[0];
    let opened = false;
    try {
      if (!tab) {
        send({ kind: 'progress', step: '광고센터를 여는 중' });
        tab = await chrome.tabs.create({ url: ADS + '/', active: false });
        opened = true;
        await new Promise(resolve => {
          const done = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } };
          chrome.tabs.onUpdated.addListener(done);
          setTimeout(resolve, 25000);
        });
        await new Promise(r => setTimeout(r, 1500)); // 로그인 화면으로 튕기는지 볼 시간
      }
      const t = await chrome.tabs.get(tab.id);
      if (!t.url || !t.url.startsWith(ADS)) return send({ kind: 'error', message: '광고센터에 로그인돼 있지 않습니다. 같은 크롬에서 advertising.coupang.com에 로그인한 뒤 다시 눌러주세요.' });
      send({ kind: 'progress', step: '광고센터에서 보고서를 만드는 중 (최대 3분)' });
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: hoonproAdCollect, args: [days] });
      const r = res && res.result;
      if (!r) return send({ kind: 'error', message: '광고센터에서 응답을 받지 못했습니다.' });
      if (r.error) return send({ kind: 'error', message: r.error });
      send({ kind: 'done', ...r });
    } catch (e) {
      send({ kind: 'error', message: '광고센터 작업 중 오류: ' + (e && e.message ? e.message : String(e)) });
    } finally {
      if (opened && tab) { try { await chrome.tabs.remove(tab.id); } catch { /* 무시 */ } }
    }
  });
});
