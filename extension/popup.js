chrome.cookies.getAll({ url: 'https://wing.coupang.com/' }, cs => {
  const el = document.getElementById('wing');
  if (cs && cs.length) { el.textContent = '로그인 쿠키 있음'; el.className = 'ok'; }
  else { el.textContent = '로그인 필요 (wing.coupang.com)'; el.className = 'no'; }
});
chrome.cookies.getAll({ url: 'https://advertising.coupang.com/' }, cs => {
  const el = document.getElementById('ads');
  if (cs && cs.length) { el.textContent = '로그인 쿠키 있음'; el.className = 'ok'; }
  else { el.textContent = '로그인 필요 (advertising.coupang.com)'; el.className = 'no'; }
});
