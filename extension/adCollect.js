// 광고센터 광고 보고서 받기 — 광고센터 탭 안에 넣어서 돈다 (그 화면의 로그인 쿠키를 쓴다).
// src/lib/adCollector.ts 즐겨찾기와 같은 순서다:
//   캠페인 목록 → 일별 보고서 요청 → 완료까지 기다림 → 파일(또는 파일 주소) 받기
// 결과는 탭 밖으로 넘겨야 해서 파일은 base64 문자열로 바꾼다.
async function hoonproAdCollect(days) {
  var GQL = '/marketing-reporting/v2/graphql';
  var EXCEL = '/marketing-reporting/v2/api/excel-report?id=';
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var ymd = function (d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  var end = new Date(); var start = new Date(end.getTime()); start.setDate(start.getDate() - (days - 1));
  var S = ymd(start), E = ymd(end);

  var gqlOnce = function (body) {
    return fetch(GQL, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: '*/*' }, body: JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('광고센터 로그인이 풀렸습니다. advertising.coupang.com에 다시 로그인한 뒤 눌러주세요.');
        return r.json();
      });
  };
  var gql = function (body) {
    return gqlOnce(body).catch(function (e) {
      var msg = String((e && e.message) || e);
      if (!/Failed to fetch|NetworkError|Load failed/i.test(msg)) throw e;
      return sleep(1500).then(function () {
        return gqlOnce(body).catch(function (e2) {
          throw new Error('광고센터에 요청을 보내지 못했습니다. 광고 차단 확장(uBlock·AdGuard 등)이 광고센터 주소를 막거나 로그인이 풀린 경우입니다.');
        });
      });
    });
  };

  var step = '시작';
  try {
    step = '캠페인 목록';
    var c = await gql({
      operationName: 'GetCampaignListInBillboard',
      variables: { startDate: S, endDate: E, reportType: 'pa', rbacReportType: 'AD_REPORT' },
      query: 'query GetCampaignListInBillboard($startDate: Int!, $endDate: Int!, $reportType: ReportType!, $rbacReportType: String) { getCampaignList(startDate: $startDate, endDate: $endDate, reportType: $reportType, rbacReportType: $rbacReportType) { id name } }',
    });
    var list = (c && c.data && c.data.getCampaignList) || [];
    var ids = []; for (var i = 0; i < list.length; i++) ids.push(String(list[i].id));
    if (ids.length === 0) return { error: '이 기간에 집행한 캠페인이 없습니다. 광고비가 0원이면 가져올 것도 없습니다.' };

    step = '보고서 요청';
    var groups = ['daily', 'date', 'day', 'DAILY', 'DATE'];
    var report = null, lastErr = '', g = 0;
    for (g = 0; g < groups.length; g++) {
      var m = await gql({
        variables: { reportType: 'pa', startDate: S, endDate: E, dateGroup: groups[g], granularity: null, excludeIfNoClickCount: true, campaignIds: ids },
        query: 'mutation ($startDate: Int!, $endDate: Int!, $campaignIds: [ID], $reportType: ReportType!, $dateGroup: DateGroup!, $granularity: Granularity, $excludeIfNoClickCount: Boolean) { requestReport(data: {startDate: $startDate, endDate: $endDate, campaignIds: $campaignIds, reportType: $reportType, dateGroup: $dateGroup, granularity: $granularity, excludeIfNoClickCount: $excludeIfNoClickCount}) { id status dateGroup } }',
      });
      if (m && m.errors && m.errors.length) {
        lastErr = String(m.errors[0].message || '');
        if (/DateGroup|dateGroup|enum|Enum/.test(lastErr)) continue;
        return { error: '보고서 요청 거절: ' + lastErr };
      }
      report = m && m.data && m.data.requestReport;
      if (report && report.id) break;
    }
    if (!report || !report.id) return { error: '보고서를 만들지 못했습니다. ' + (lastErr || '응답에 id가 없습니다.') };
    var id = String(report.id);
    var dateGroup = String(report.dateGroup || groups[g] || '');

    step = '완료 확인';
    var status = String(report.status || ''), done = false;
    for (var t = 0; t < 60 && !done; t++) {
      if (/DONE|COMPLET|SUCCESS|FINISH|READY/i.test(status)) { done = true; break; }
      if (/FAIL|ERROR|CANCEL/i.test(status)) return { error: '쿠팡이 보고서 생성에 실패했습니다 (' + status + ').' };
      await sleep(3000);
      var l = await gql({
        variables: { reportType: 'pa', page: 1, pageSize: 10, duration: 90, onlyScheduledReport: false },
        query: 'query ($reportType: ReportType!, $page: Int!, $pageSize: Int!, $duration: Int!, $onlyScheduledReport: Boolean) { reportList(data: {reportType: $reportType, page: $page, pageSize: $pageSize, duration: $duration, onlyScheduledReport: $onlyScheduledReport}) { reports { id status } } }',
      });
      var reports = (l && l.data && l.data.reportList && l.data.reportList.reports) || [];
      for (var k = 0; k < reports.length; k++) if (String(reports[k].id) === id) status = String(reports[k].status || '');
    }
    if (!done) return { error: '3분이 지나도 보고서가 완료되지 않았습니다 (상태: ' + status + '). 잠시 후 다시 눌러주세요.' };

    step = '파일 받기';
    var res = await fetch(EXCEL + encodeURIComponent(id), { credentials: 'include', headers: { accept: 'application/json, text/plain, */*' } });
    if (!res.ok) return { error: '보고서 파일을 받지 못했습니다 (HTTP ' + res.status + ').' };
    var ctype = String(res.headers.get('content-type') || '');
    if (/json/i.test(ctype)) {
      var j = await res.json(); var url = ''; var stack = [j];
      while (stack.length && !url) {
        var cur = stack.pop();
        if (typeof cur === 'string' && /^https?:\/\//.test(cur)) url = cur;
        else if (cur && typeof cur === 'object') for (var key in cur) stack.push(cur[key]);
      }
      if (!url) return { error: '보고서 파일 주소를 찾지 못했습니다.' };
      return { url: url, from: S, to: E, contentType: ctype, dateGroup: dateGroup };
    }
    var bytes = new Uint8Array(await res.arrayBuffer());
    var bin = ''; var CH = 0x8000;
    for (var p = 0; p < bytes.length; p += CH) bin += String.fromCharCode.apply(null, bytes.subarray(p, p + CH));
    return { base64: btoa(bin), from: S, to: E, contentType: ctype, dateGroup: dateGroup };
  } catch (e) {
    return { error: '[' + step + '] ' + ((e && e.message) || String(e)) };
  }
}
