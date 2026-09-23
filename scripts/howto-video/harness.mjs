// 자막 영상 녹화 도구. 로컬 미리보기(127.0.0.1:4173)를 열고 /api/* 를 가짜 응답으로
// 채운 뒤, 가짜 커서·강조 링·하단 자막을 화면에 얹어 가며 클릭해 webm으로 찍고
// H.264 mp4로 바꾼다.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
// H.264 mp4로 바꾸려면 ffmpeg가 필요하다. FFMPEG_PATH가 없으면 PATH의 ffmpeg를 쓴다.
// (ffmpeg-static을 devDependency로 넣지 않는 이유: 설치마다 70MB 바이너리를 받는다)
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

const BASE = process.env.HOWTO_BASE || 'http://127.0.0.1:4173';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, 'out');
const RAW = path.resolve(HERE, 'raw');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const OVERLAY_CSS = `
#hp-cur{position:fixed;z-index:2147483000;width:26px;height:26px;pointer-events:none;
  transition:transform .55s cubic-bezier(.2,.8,.2,1);transform:translate(-40px,-40px);}
#hp-cur svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.6));}
#hp-ring{position:fixed;z-index:2147482999;pointer-events:none;border:3px solid #22d3ee;border-radius:12px;
  box-shadow:0 0 0 4px rgba(34,211,238,.25),0 0 24px rgba(34,211,238,.55);opacity:0;transition:opacity .25s;}
#hp-ring.on{opacity:1;animation:hp-pulse 1.1s ease-in-out infinite;}
@keyframes hp-pulse{0%,100%{box-shadow:0 0 0 4px rgba(34,211,238,.25),0 0 24px rgba(34,211,238,.55)}50%{box-shadow:0 0 0 9px rgba(34,211,238,.12),0 0 36px rgba(34,211,238,.75)}}
#hp-cap{position:fixed;z-index:2147483001;left:50%;bottom:34px;transform:translateX(-50%);max-width:82%;
  background:rgba(8,12,24,.92);color:#fff;border:1px solid rgba(34,211,238,.45);border-radius:14px;
  padding:14px 24px;font:600 22px/1.45 Pretendard,"Pretendard Variable",sans-serif;letter-spacing:-.01em;
  text-align:center;word-break:keep-all;opacity:0;transition:opacity .25s;pointer-events:none;
  box-shadow:0 10px 40px rgba(0,0,0,.5);}
#hp-cap.on{opacity:1;}
#hp-cap b{color:#22d3ee;font-weight:800;}
#hp-step{position:fixed;z-index:2147483001;bottom:10px;right:14px;background:rgba(8,12,24,.85);color:#9fb3d1;
  border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:6px 14px;font:600 13px Pretendard,sans-serif;opacity:0;transition:opacity .25s;pointer-events:none;}
#hp-step.on{opacity:1;}
#hp-title{position:fixed;inset:0;z-index:2147483002;background:linear-gradient(160deg,#0b1220,#101a33 60%,#0b1220);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#fff;
  font-family:Pretendard,"Pretendard Variable",sans-serif;opacity:1;transition:opacity .5s;pointer-events:none;}
#hp-title .k{font-size:15px;font-weight:700;letter-spacing:.28em;color:#22d3ee;text-transform:uppercase}
#hp-title .t{font-size:44px;font-weight:800;letter-spacing:-.02em}
#hp-title .s{font-size:18px;color:#9fb3d1;font-weight:500}
#hp-title.off{opacity:0}
`;

const CURSOR_SVG = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l14 9-6 1.5L16 20l-3 1.3-4-7.5L4 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

async function installOverlay(page) {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate((svg) => {
    const mk = (id, html = '') => { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; el.innerHTML = html; document.body.appendChild(el); } return el; };
    mk('hp-ring'); mk('hp-cap'); mk('hp-step'); mk('hp-cur', svg);
  }, CURSOR_SVG);
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function record({ name, title, subtitle, token, tokenKey, mocks, viewport = { width: 1280, height: 800 }, run }) {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    recordVideo: { dir: RAW, size: viewport },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(4000);
  const t0 = Date.now();
  const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  // 외부(CDN·이미지)는 전부 끊는다. 이 환경은 밖으로 못 나가고, 기다리면 녹화만 길어진다.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const res = await mocks({ path: url.pathname, q: Object.fromEntries(url.searchParams), method: req.method(), body, url: url.toString() });
    if (res === undefined) { console.warn('[mock miss]', req.method(), url.pathname + url.search); return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'no mock' }) }); }
    const status = res && typeof res === 'object' && '__status' in res ? res.__status : 200;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(res) });
  });
  if (token) await page.addInitScript(([k, t]) => { localStorage.setItem(k, t); }, [tokenKey, token]);
  page.on('pageerror', e => console.warn('[pageerror]', e.message));

  const state = { step: 0, total: 0 };
  const h = {
    page,
    async goto(p = '/') { await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400); await installOverlay(page); },
    async overlay() { await installOverlay(page); },
    async titleCard(ms = 2200) {
      await page.evaluate(([t, s]) => { const el = document.createElement('div'); el.id = 'hp-title'; el.innerHTML = `<div class="k">훈프로 사용 방법</div><div class="t">${t}</div><div class="s">${s}</div>`; document.body.appendChild(el); }, [title, subtitle ?? '']);
      await sleep(ms);
      await page.evaluate(() => { const el = document.getElementById('hp-title'); if (el) { el.classList.add('off'); setTimeout(() => el.remove(), 600); } });
      await sleep(600);
    },
    async cap(text, ms = 700) {
      state.step += 1;
      log('step', state.step, text.replace(/<[^>]+>/g, '').slice(0, 40));
      await page.evaluate(([t, n, total]) => {
        const c = document.getElementById('hp-cap'); c.innerHTML = t; c.classList.add('on');
        const s = document.getElementById('hp-step'); s.textContent = total ? `${n} / ${total}` : `${n}`; s.classList.add('on');
      }, [text, state.step, state.total]);
      await sleep(ms);
    },
    async capOff() { await page.evaluate(() => document.getElementById('hp-cap')?.classList.remove('on')); },
    steps(n) { state.total = n; },
    async moveTo(selector, opts = {}) {
      const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.evaluate(el => { const r = el.getBoundingClientRect(); if (r.top < 120) window.scrollBy({ top: r.top - 140, behavior: 'smooth' }); }).catch(() => {});
      await sleep(450);
      const box = await loc.boundingBox().catch(() => null);
      if (!box) { log('  !! no box for', String(selector)); throw new Error('no box for ' + selector); }
      const x = box.x + (opts.dx ?? box.width / 2), y = box.y + (opts.dy ?? box.height / 2);
      await page.evaluate(([x, y, b, pad]) => {
        document.getElementById('hp-cur').style.transform = `translate(${x - 2}px, ${y - 2}px)`;
        const r = document.getElementById('hp-ring');
        r.style.left = (b.x - pad) + 'px'; r.style.top = (b.y - pad) + 'px'; r.style.width = (b.width + pad * 2) + 'px'; r.style.height = (b.height + pad * 2) + 'px';
        r.classList.add('on');
      }, [x, y, box, opts.pad ?? 6]);
      await sleep(opts.hold ?? 900);
      return { x, y, loc };
    },
    async ringOff() { await page.evaluate(() => document.getElementById('hp-ring')?.classList.remove('on')); },
    async click(selector, opts = {}) {
      const { x, y, loc } = await h.moveTo(selector, opts);
      await page.evaluate(() => { const c = document.getElementById('hp-cur'); c.style.transition = 'transform .12s'; c.style.transform += ' scale(.8)'; });
      await sleep(120);
      await page.evaluate(() => { const c = document.getElementById('hp-cur'); c.style.transform = c.style.transform.replace(' scale(.8)', ''); setTimeout(() => { c.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)'; }, 130); });
      if (opts.viaMouse === false) await loc.click({ force: true }); else await page.mouse.click(x, y);
      await sleep(opts.after ?? 700);
      await h.ringOff();
      // 클릭으로 화면이 바뀌면 오버레이가 사라질 수 있다
      await installOverlay(page);
    },
    async type(selector, text, opts = {}) {
      const { loc } = await h.moveTo(selector, opts);
      await loc.click({ force: true });
      await loc.fill('');
      await loc.pressSequentially(text, { delay: opts.delay ?? 70 });
      await sleep(opts.after ?? 500);
      await h.ringOff();
    },
    async scroll(selectorOrY, opts = {}) {
      if (typeof selectorOrY === 'number') { await page.mouse.wheel(0, selectorOrY); }
      else {
        // 고정 헤더(약 105px) 아래로 오도록 여유를 두고 스크롤한다. scrollIntoView만 쓰면 제목이 헤더 뒤에 숨는다
        const loc = page.locator(selectorOrY).first();
        const ok = await loc.evaluate((el, off) => {
          const top = el.getBoundingClientRect().top + window.scrollY - off;
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          return true;
        }, opts.offset ?? 130).catch(() => false);
        if (!ok) { log('  !! scroll miss', selectorOrY); throw new Error('scroll miss ' + selectorOrY); }
      }
      await sleep(opts.after ?? 600);
    },
    async spot(selector, ms = 1500, pad = 8) {
      await h.moveTo(selector, { pad, hold: ms });
      await h.ringOff();
    },
    sleep,
  };

  let err = null;
  try { await run(h); } catch (e) { err = e; console.error('[run error]', e); }
  await h.capOff().catch(() => {});
  await sleep(800);
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  await browser.close();
  if (err) throw err;

  const mp4 = path.join(OUT, `${name}.mp4`);
  const r = spawnSync(ffmpeg, ['-y', '-i', webm, '-vf', `scale=${viewport.width}:-2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'medium', '-r', '25', '-movflags', '+faststart', '-an', mp4], { stdio: 'pipe' });
  if (r.status !== 0) { console.error(r.stderr.toString().slice(-2000)); throw new Error('ffmpeg failed'); }
  const kb = Math.round(fs.statSync(mp4).size / 1024);
  console.log(`[done] ${mp4} (${kb} KB)`);
  return mp4;
}
