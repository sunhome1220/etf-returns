// 各頁共用：手機 App（加入主畫面）、更新內容通知。
// 新增功能時，在 CHANGELOG 最前面加一筆（id 遞增）；使用者下次打開會看到上次之後的更新內容。
const CHANGELOG = [
  {id:17, date:'2026-10-29', items:[
    '預設清單加入 22 檔投資台股的主動式 ETF（00982A、00984A、00986A、00987A、00992A～00996A、00998A、00999A、00400A～00408A、00410A、00411A、00415A）',
  ]},
  {id:16, date:'2026-10-28', items:[
    '新增「成立年度」欄（手機預設隱藏，可從「欄位」叫出）',
    '成立前的年度改寫為「2025年成立」（成立前一年）與「尚未成立」（更早）',
    '預設清單加入元大MSCI金融（0055）',
  ]},
  {id:14, date:'2026-10-28', items:[
    '預設清單加入台積電（2330）',
  ]},
  {id:13, date:'2026-10-28', items:[
    '近期報酬率可勾選「今年」，在最前面多一欄今年初至今的報酬率',
  ]},
  {id:12, date:'2026-10-28', items:[
    '「名稱」欄固定在左側，左右捲動時仍看得到是哪一檔',
    '手機預設隱藏「區域、類別、除息」，一打開就看得到報酬率（可從「欄位」叫回）',
  ]},
  {id:11, date:'2026-10-28', items:[
    '表格預設字體縮小一級；標題旁新增「A−／A＋」可自行調整字體大小',
    '近期報酬率的欄名（近一週、近一月…）字體小一級',
  ]},
  {id:10, date:'2026-10-28', items:[
    '名稱欄最寬 9 個字：較長的名稱字體縮小一級，再放不下以「…」結尾（滑鼠移上去可看全名）',
  ]},
  {id:9, date:'2026-10-28', items:[
    '頁面最下方的說明改成分段收合，預設全部收起，點標題展開',
  ]},
  {id:8, date:'2026-10-28', items:[
    '手機也會顯示「安裝 App」按鈕：iPhone、LINE 內開啟等無法直接安裝時，點了會顯示加入主畫面的步驟',
  ]},
  {id:7, date:'2026-10-28', items:[
    '手機最上方狀態列改為和頁面相同的白色，不再出現綠色毛玻璃',
  ]},
  {id:6, date:'2026-10-28', items:[
    '表格下方的資料時間字體再縮小；手機上不再自動放大表格裡的小字',
  ]},
  {id:5, date:'2026-10-28', items:[
    '近期報酬率的近三年、近五年「累積」「年化」改成查詢選項，預設不顯示，畫面不會太寬',
  ]},
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
    .app-dlg ul, .app-dlg ol { margin:0; padding-left:1.3em; }
    .app-dlg p { margin:0 0 8px; }
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

  // 「安裝 App」按鈕：瀏覽器支援就直接跳出安裝（Android／電腦 Chrome），
  // 不支援的（iPhone 所有瀏覽器、LINE 等 App 內建瀏覽器）點了顯示加入主畫面的步驟
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua);
  const isMobile = isIOS || /Android/i.test(ua);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let deferred = null;

  function guide() {
    let steps;
    if (inApp) {
      const ext = location.href.split('#')[0] + (location.search ? '&' : '?') + 'openExternalBrowser=1';
      steps = `<p>目前是在 LINE／Facebook 等 App 裡開啟，無法加入主畫面，請先改用${isIOS ? ' Safari' : ' Chrome'} 開啟：</p>
        <p><a class="ok" style="display:inline-block;text-decoration:none" href="${ext}">用瀏覽器開啟</a></p>
        <p>若沒有反應，請點右上角「⋯」選單 →「以其他應用程式開啟」或「在瀏覽器中開啟」，再照下面步驟加入主畫面。</p>`;
    } else steps = '';
    steps += isIOS
      ? `<ol><li>點 Safari 的<b>分享按鈕</b>（方框加向上箭頭；新版 Safari 在網址列旁的「⋯」裡）</li>
          <li>往下找到<b>「加入主畫面」</b></li><li>按右上角<b>「加入」</b>，主畫面就會出現「ETF報酬率」</li></ol>`
      : `<ol><li>點瀏覽器右上角的<b>「⋮」選單</b></li><li>選<b>「安裝應用程式」</b>或<b>「加到主畫面」</b></li>
          <li>按<b>「安裝」</b>，主畫面就會出現「ETF報酬率」</li></ol>`;
    const m = document.createElement('div');
    m.className = 'app-mask';
    m.innerHTML = `<div class="app-dlg"><h2>加入主畫面</h2>${steps}<button class="ok">知道了</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.tagName === 'BUTTON') m.remove(); });
    document.body.appendChild(m);
  }
  function addButton() {
    const slot = document.querySelector('[data-install]');
    if (!slot || standalone || slot.querySelector('.app-btn')) return;
    const b = document.createElement('button');
    b.className = 'app-btn';
    b.textContent = '安裝 App';
    b.onclick = async () => {
      if (!deferred) return guide();
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      if (r.outcome === 'accepted') b.remove();
    };
    slot.appendChild(b);
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; addButton(); });
  window.addEventListener('appinstalled', () => document.querySelectorAll('.app-btn').forEach(b => b.remove()));
  if (isMobile) addButton();   // 手機一律顯示；不支援直接安裝的點了看步驟
})();
