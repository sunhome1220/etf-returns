// 各頁共用：手機 App（加入主畫面）、更新內容通知。
// 新增功能時，在 CHANGELOG 最前面加一筆（id 遞增）；使用者下次打開會看到上次之後的更新內容。
const CHANGELOG = [
  {id:4, date:'2026-10-28', items:[
    '新增「近期」報酬率：近一週、近一月、近三月、近半年、近一年，以及近三年、近五年的累積與年化，可和「各年度」切換',
    '可以加入手機主畫面當成 App 使用；網站有更新時會顯示更新內容',
    '新的「股市小樹苗」App 圖示',
  ]},
  {id:3, date:'2026-10-28', items:[
    '打開網頁時即時抓最新價格，重算現價、漲跌與今年報酬率；表格下方註明即時與排程的更新時間',
    '新增小數位數切換（1 位／2 位），所有數字一起變動、對齊',
    '表頭「區」「類」改為「區域」「類別」；00983A 改列全球',
  ]},
  {id:2, date:'2026-10-17', items:[
    '報酬率算法可切換：股息不再投入（預設）／股息再投入，頁面最下方有兩種算法的說明',
    '新增「匯出圖片」，可把目前的表格存成圖片分享',
  ]},
  {id:1, date:'2026-10-17', items:[
    '表格斑馬紋、篩選鈕縮小移到欄名上方、各年度欄寬一致',
    '查詢選項區可以隱藏（手機預設隱藏）',
  ]},
];

(function () {
  const SEEN = 'etf-seen-version', latest = CHANGELOG[0].id;
  const get = () => { try { return +localStorage.getItem(SEEN) || 0; } catch (e) { return 0; } };
  const set = v => { try { localStorage.setItem(SEEN, String(v)); } catch (e) {} };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const css = document.createElement('style');
  css.textContent = `
    .app-mask { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:100; display:flex; align-items:center; justify-content:center; padding:16px; }
    .app-dlg { background:#fff; border-radius:8px; max-width:440px; width:100%; max-height:80vh; overflow:auto; padding:16px 18px; box-shadow:0 8px 24px rgba(0,0,0,.25); font-size:14px; line-height:1.6; color:#222; }
    .app-dlg h2 { font-size:16px; margin:0 0 8px; color:#2c7a3f; }
    .app-dlg h3 { font-size:13px; margin:10px 0 2px; color:#666; font-weight:normal; }
    .app-dlg ul { margin:0; padding-left:1.3em; }
    .app-dlg .ok { display:block; margin:14px 0 0 auto; padding:5px 16px; border:none; border-radius:4px; background:#2c7a3f; color:#fff; font:inherit; cursor:pointer; }
    .app-bar { position:fixed; left:50%; bottom:16px; transform:translateX(-50%); z-index:90; background:#2c7a3f; color:#fff; border-radius:20px; padding:8px 16px; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,.2); cursor:pointer; white-space:nowrap; }
    .app-btn { padding:1px 8px; border:1px solid #2c7a3f; border-radius:4px; background:#fff; color:#2c7a3f; font:inherit; font-size:12px; font-weight:normal; cursor:pointer; vertical-align:middle; margin-left:8px; }
  `;
  document.head.appendChild(css);

  function showLog(entries, title) {
    const m = document.createElement('div');
    m.className = 'app-mask';
    m.innerHTML = `<div class="app-dlg"><h2>${title}</h2>` +
      entries.map(e => `<h3>${e.date}</h3><ul>${e.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('') +
      `<button class="ok">知道了</button></div>`;
    const close = () => { m.remove(); set(latest); };
    m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('ok')) close(); });
    document.body.appendChild(m);
  }
  window.showChangelog = () => showLog(CHANGELOG, '更新紀錄');

  // 有新版本：上次看過之後的更新內容。第一次來的人不跳出，只記下目前版本
  const seen = get();
  if (!seen) set(latest);
  else if (seen < latest) showLog(CHANGELOG.filter(e => e.id > seen), '網站更新了');

  // App 開著時網站更新了（回到前景時檢查）：提示重新載入，載入後會顯示更新內容
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt < 60000 || document.querySelector('.app-bar')) return;
    const txt = await fetch('app.js', {cache:'no-cache'}).then(r => r.ok ? r.text() : '').catch(() => '');
    const m = txt.match(/\{id:(\d+)/);
    if (m && +m[1] > latest) {
      const bar = document.createElement('div');
      bar.className = 'app-bar';
      bar.textContent = '網站有新版本，點這裡更新';
      bar.onclick = () => location.reload();
      document.body.appendChild(bar);
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Android／電腦 Chrome：顯示「安裝 App」按鈕（iPhone 請用 Safari 分享 → 加入主畫面）
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    const slot = document.querySelector('[data-install]');
    if (!slot || slot.querySelector('.app-btn')) return;
    const b = document.createElement('button');
    b.className = 'app-btn';
    b.textContent = '安裝 App';
    b.onclick = async () => { e.prompt(); await e.userChoice.catch(() => {}); b.remove(); };
    slot.appendChild(b);
  });
})();
