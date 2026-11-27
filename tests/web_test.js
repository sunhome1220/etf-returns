// 網頁冒煙測試（不連網：資料代理的請求一律回 500，只用頁面內的排程資料）。
// 執行：node tests/web_test.js（需要 playwright；會自己在 8799 埠起本機伺服器）
// 檢查各頁載入沒有錯誤、Python 與瀏覽器的計算一致（fixtures/calc_cases.json）、多類別篩選、全選、主動型比較名單。
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..'), PORT = 8799, BASE = `http://localhost:${PORT}/`;
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'calc_cases.json'), 'utf8'));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {cwd:ROOT, stdio:'ignore'});
  await new Promise(r => setTimeout(r, 1000));
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const ctx = await browser.newContext({viewport:{width:1400, height:900}, serviceWorkers:'block'});
    await ctx.route(/\/(chart|mis|twname)\/|\/etfnav/, r => r.fulfill({status:500, body:'offline'}));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    // ---- 報酬率頁 ----
    await page.goto(BASE + 'returns.html');
    await page.waitForFunction(() => typeof LIVE !== 'undefined' && LIVE.state !== 'loading', null, {timeout:20000});
    const nRows = await page.evaluate(() => DATA.rows.length);
    check(await page.$$eval('#t tbody tr', a => a.length) === nRows, `報酬率頁顯示全部 ${nRows} 檔`);

    // Python 與瀏覽器計算一致
    const diff = await page.evaluate(cases => {
      const out = [];
      const cmp = (got, want, p) => {
        if (want && typeof want === 'object') { for (const k of new Set([...Object.keys(want), ...Object.keys(got || {})])) cmp(got && got[k], want[k], `${p}.${k}`); return; }
        if (typeof want === 'number' ? Math.abs(got - want) > 1e-9 : got !== want) out.push(`${p}: ${got} ≠ ${want}`);
      };
      for (const [k, c] of Object.entries(cases)) {
        const pts = c.pts.map(([day, cl, a]) => ({y:+day.slice(0, 4), m:+day.slice(5, 7), day, c:cl, a}));
        const divs = c.divs.map(([day, v]) => ({y:+day.slice(0, 4), day, v}));
        cmp(riskStats(pts, divs), c.expect.risk, `${k}.risk`);
        cmp(recentReturns(pts, divs), c.expect.recent, `${k}.recent`);
      }
      return out;
    }, CASES);
    check(!diff.length, `Python 與網頁的風險指標、近期報酬率一致${diff.length ? '：' + diff.slice(0, 3).join('；') : ''}`);

    // 多類別篩選：聯集、交集（預期值由資料算出）
    const expect = await page.evaluate(() => {
      const t = r => String(r.類).split('、');
      return {or:DATA.rows.filter(r => t(r).includes('主動') || t(r).includes('高息')).length,
              and:DATA.rows.filter(r => t(r).includes('主動') && t(r).includes('高息')).length};
    });
    const shown = () => page.$$eval('#t tbody tr', a => a.length);
    await page.evaluate(() => { S.filters.類 = {vals:['主動', '高息']}; render(); });
    check(await shown() === expect.or, `類別篩選任一符合（主動、高息）＝ ${expect.or} 檔`);
    await page.evaluate(() => { S.filters.類 = {vals:['主動', '高息'], and:true}; render(); });
    check(await shown() === expect.and, `類別篩選都要符合（主動且高息）＝ ${expect.and} 檔`);
    await page.evaluate(() => { delete S.filters.類; render(); });

    // 表頭全選：點一下全選、再點一下全部取消
    await page.click('#pickAll');
    check(await page.evaluate(n => S.picked.length === n && document.getElementById('pickAll').checked, nRows), '全選後全部勾選且打勾');
    await page.click('#pickAll');
    check(await page.evaluate(() => S.picked.length === 0 && !document.getElementById('pickAll').checked), '再點一次全部取消');

    // 匯出圖片
    const [dl] = await Promise.all([page.waitForEvent('download', {timeout:15000}), page.click('#expBtn')]);
    check(/^etf-returns-\d{8}.*\.png$/.test(dl.suggestedFilename()), `匯出圖片（${dl.suggestedFilename()}）`);

    // ---- 主動型比較頁 ----
    await page.goto(BASE + 'compare.html');
    await page.waitForSelector('#t tbody tr');
    const cmp = await page.evaluate(() => ({active, info:document.getElementById('info').textContent,
      want:D.funds.filter(f => String(f.類).split('、').includes('主動')).length}));
    check(cmp.active.length === cmp.want && cmp.want > 0, `主動型比較：${cmp.want} 檔（${cmp.info}）`);
    check(await page.$eval('#svg', s => s.querySelectorAll('path.ln').length > 0), '主動型比較：走勢圖有畫線');
    const [dl2] = await Promise.all([page.waitForEvent('download', {timeout:15000}), page.click('#expBtn')]);
    check(/^active-compare-\d{8}-.*\.png$/.test(dl2.suggestedFilename()), `主動型比較：匯出圖片（${dl2.suggestedFilename()}）`);

    // ---- 其他頁 ----
    for (const p of ['index.html', 'watchlist.html']) { await page.goto(BASE + p); await page.waitForTimeout(500); }
    check(await page.$$eval('#list tbody tr, table tbody tr', a => a.length) > 0, '追蹤清單頁有列出清單');

    check(!errs.length, `所有頁面沒有 JS 錯誤${errs.length ? '：' + errs.join('；') : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failed ? `\n${failed} 項失敗` : '\n全部通過');
  process.exit(failed ? 1 : 0);
})();
