/**
 * 광고센터 광고비 수집 북마클릿.
 *
 * 쿠팡 광고센터(advertising.coupang.com)에는 공개 API가 없다. 화면이 쓰는 내부
 * GraphQL로만 보고서를 만들 수 있는데, 로그인 정보가 HttpOnly 쿠키에 있어 우리
 * 서버로 가져올 방법이 없다. 그래서 반대로 간다 — 코드를 판매자의 브라우저에
 * 보내 광고센터 안에서 돌린다. 쿠키는 브라우저가 알아서 붙이고, 우리는 아무것도
 * 보관하지 않는다. 봇 차단도 실제 브라우저라 걸리지 않는다.
 *
 * 흐름 (광고센터 화면이 [보고서 만들기]→[다운로드]에 쓰는 요청을 그대로 재현한다)
 *   ① getCampaignList         → 캠페인 ID 전부
 *   ② requestReport(일별)     → 보고서 id
 *   ③ reportList 로 상태 확인 → 완료까지 반복
 *   ④ GET api/excel-report    → 엑셀 파일
 *   ⑤ 파일을 훈프로 창(window.open)에 postMessage 로 넘긴다
 *
 * ⑤가 핵심이다. 광고센터 페이지의 CSP가 다른 도메인으로의 fetch를 막을 수 있지만
 * 열어 둔 창에 postMessage 하는 건 막지 못한다. 받는 쪽(AdReportReceiver)은
 * 판매자 본인의 훈프로 세션으로 저장하므로 별도 토큰도 필요 없다.
 *
 * 아래 collector는 toString()으로 문자열이 되어 북마클릿에 실린다. 그래서
 * 이 파일의 다른 것을 참조하면 안 되고, 옵셔널 체이닝 같은 문법도 피한다 —
 * 번들러가 어떻게 바꿔 놓을지 통제할 수 없다.
 */

export const AD_CENTER_ORIGIN = 'https://advertising.coupang.com';
export const AD_COLLECT_QUERY = 'ad-collect';
export const AD_COLLECT_DAYS = 30;

/** 광고센터 안에서 실행되는 본체. 인자 말고는 바깥을 아무것도 보지 않는다. */
function collector(origin: string, days: number) {
  var AD_HOST = 'advertising.coupang.com';
  var GQL = '/marketing-reporting/v2/graphql';
  var EXCEL = '/marketing-reporting/v2/api/excel-report?id=';

  if (location.host !== AD_HOST) {
    alert('쿠팡 광고센터(' + AD_HOST + ')에 로그인한 화면에서 이 즐겨찾기를 눌러주세요.');
    return;
  }

  // 사용자가 누른 그 순간에 창을 열어야 팝업 차단에 안 걸린다
  var win = window.open(origin + '/?ad-collect=1', 'hoonpro-ad-collect');
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
  var say = function (t: string) {
    box.textContent = '훈프로 광고비 가져오기 — ' + t;
  };
  var fail = function (t: string) {
    box.style.background = '#7f1d1d';
    say(t);
    try {
      win.postMessage({ type: 'hoonpro-ad-error', message: t }, origin);
    } catch (e) {
      /* 창이 닫혔으면 알릴 곳이 없다 */
    }
  };

  var ready = false;
  window.addEventListener('message', function (ev) {
    if (ev.origin === origin && ev.data && ev.data.type === 'hoonpro-ad-ready') ready = true;
  });

  var ymd = function (d: Date) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  };
  var end = new Date();
  var start = new Date(end.getTime());
  start.setDate(start.getDate() - (days - 1));
  var S = ymd(start);
  var E = ymd(end);

  var sleep = function (ms: number) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  };

  var gql = function (body: any): Promise<any> {
    return fetch(GQL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: '*/*' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('광고센터 로그인이 풀렸습니다. 다시 로그인한 뒤 눌러주세요.');
      return r.json();
    });
  };

  var run = async function () {
    say('캠페인 목록을 읽는 중...');
    var c = await gql({
      operationName: 'GetCampaignListInBillboard',
      variables: { startDate: S, endDate: E, reportType: 'pa', rbacReportType: 'AD_REPORT' },
      query:
        'query GetCampaignListInBillboard($startDate: Int!, $endDate: Int!, $reportType: ReportType!, $rbacReportType: String) {' +
        ' getCampaignList(startDate: $startDate, endDate: $endDate, reportType: $reportType, rbacReportType: $rbacReportType) { id name } }',
    });
    var list = (c && c.data && c.data.getCampaignList) || [];
    var ids: string[] = [];
    for (var i = 0; i < list.length; i++) ids.push(String(list[i].id));
    if (ids.length === 0) throw new Error('이 기간에 집행한 캠페인이 없습니다. 광고비가 0원이면 가져올 것도 없습니다.');

    // 일별 보고서를 요청한다. 화면이 '합계'로 보낼 때 dateGroup이 "total"이었으니
    // 일별 값도 소문자일 가능성이 높지만 정확한 이름은 모른다. 후보를 차례로
    // 넣어 보고 쿠팡이 거절하면 다음으로 넘어간다.
    say('일별 보고서를 요청하는 중...');
    var groups = ['daily', 'date', 'day', 'DAILY', 'DATE'];
    var report: any = null;
    var lastErr = '';
    for (var g = 0; g < groups.length; g++) {
      var m = await gql({
        variables: {
          reportType: 'pa',
          startDate: S,
          endDate: E,
          dateGroup: groups[g],
          granularity: null,
          excludeIfNoClickCount: true,
          campaignIds: ids,
        },
        query:
          'mutation ($startDate: Int!, $endDate: Int!, $campaignIds: [ID], $reportType: ReportType!, $dateGroup: DateGroup!, $granularity: Granularity, $excludeIfNoClickCount: Boolean) {' +
          ' requestReport(data: {startDate: $startDate, endDate: $endDate, campaignIds: $campaignIds, reportType: $reportType, dateGroup: $dateGroup, granularity: $granularity, excludeIfNoClickCount: $excludeIfNoClickCount})' +
          ' { id status dateGroup } }',
      });
      if (m && m.errors && m.errors.length) {
        lastErr = String(m.errors[0].message || '');
        if (/DateGroup|dateGroup|enum|Enum/.test(lastErr)) continue;
        throw new Error('보고서 요청 거절: ' + lastErr);
      }
      report = m && m.data && m.data.requestReport;
      if (report && report.id) break;
    }
    if (!report || !report.id) throw new Error('보고서를 만들지 못했습니다. ' + (lastErr || '응답에 id가 없습니다.'));
    var id = String(report.id);

    // 완료될 때까지 목록을 다시 읽는다. 화면도 같은 방식으로 기다린다.
    var done = false;
    var status = String(report.status || '');
    for (var t = 0; t < 60 && !done; t++) {
      if (/DONE|COMPLET|SUCCESS|FINISH|READY/i.test(status)) {
        done = true;
        break;
      }
      if (/FAIL|ERROR|CANCEL/i.test(status)) throw new Error('쿠팡이 보고서 생성에 실패했습니다 (' + status + ').');
      say('보고서가 만들어지길 기다리는 중... (' + (t + 1) + ')');
      await sleep(3000);
      var l = await gql({
        variables: { reportType: 'pa', page: 1, pageSize: 10, duration: 90, onlyScheduledReport: false },
        query:
          'query ($reportType: ReportType!, $page: Int!, $pageSize: Int!, $duration: Int!, $onlyScheduledReport: Boolean) {' +
          ' reportList(data: {reportType: $reportType, page: $page, pageSize: $pageSize, duration: $duration, onlyScheduledReport: $onlyScheduledReport})' +
          ' { reports { id status } } }',
      });
      var reports = (l && l.data && l.data.reportList && l.data.reportList.reports) || [];
      for (var k = 0; k < reports.length; k++) {
        if (String(reports[k].id) === id) status = String(reports[k].status || '');
      }
    }
    if (!done) throw new Error('3분이 지나도 보고서가 완료되지 않았습니다 (상태: ' + status + '). 잠시 후 다시 눌러주세요.');

    say('보고서 파일을 받는 중...');
    var res = await fetch(EXCEL + encodeURIComponent(id), {
      credentials: 'include',
      headers: { accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) throw new Error('파일을 받지 못했습니다 (HTTP ' + res.status + ').');
    var ctype = String(res.headers.get('content-type') || '');
    var buf: ArrayBuffer;
    if (/json/i.test(ctype)) {
      // 파일 대신 주소를 주는 경우 — 그 주소에서 한 번 더 받는다
      var j = await res.json();
      var url = '';
      var stack: any[] = [j];
      while (stack.length && !url) {
        var cur = stack.pop();
        if (typeof cur === 'string' && /^https?:\/\//.test(cur)) url = cur;
        else if (cur && typeof cur === 'object') for (var key in cur) stack.push(cur[key]);
      }
      if (!url) throw new Error('파일 주소를 찾지 못했습니다: ' + JSON.stringify(j).slice(0, 200));
      var r2 = await fetch(url, { credentials: 'include' });
      if (!r2.ok) throw new Error('파일 주소에서 받지 못했습니다 (HTTP ' + r2.status + ').');
      buf = await r2.arrayBuffer();
    } else {
      buf = await res.arrayBuffer();
    }

    say('훈프로로 보내는 중...');
    for (var w = 0; w < 90 && !ready; w++) {
      if (win.closed) throw new Error('훈프로 창이 닫혔습니다. 다시 눌러주세요.');
      await sleep(1000);
    }
    if (!ready) throw new Error('훈프로 창이 응답하지 않습니다. 훈프로에 로그인돼 있는지 확인하고 다시 눌러주세요.');
    win.postMessage({ type: 'hoonpro-ad-report', buffer: buf, from: S, to: E, contentType: ctype }, origin, [buf]);
    box.style.background = '#14532d';
    say('보냈습니다. 훈프로 창에서 결과를 확인하세요.');
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 6000);
    try {
      win.focus();
    } catch (e) {
      /* 포커스는 실패해도 된다 */
    }
  };

  run().catch(function (e) {
    fail((e && e.message) || String(e));
  });
}

/** 즐겨찾기에 넣을 javascript: 주소. origin은 훈프로 주소(https://hoonproai.com) */
export function buildAdBookmarklet(origin: string, days = AD_COLLECT_DAYS): string {
  const src = `(${collector.toString()})(${JSON.stringify(origin)},${days})`;
  return `javascript:${encodeURIComponent(src)}`;
}

/** 북마클릿이 넘겨준 날짜(yyyyMMdd 숫자) → YYYY-MM-DD */
export function ymdToIso(n: number | string): string {
  const s = String(n);
  if (!/^\d{8}$/.test(s)) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
