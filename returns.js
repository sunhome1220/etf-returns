// 「各年度含息報酬率」頁（template.html／returns.html）的程式。
// DATA（排程資料）與 PROXY（資料代理網址）由頁面內嵌的 <script> 先定義；
// 共用的證交所即時報價、ETF 淨值、日期推算在 market.js。
const years = DATA.years;
// 數字一律顯示 S.dec 位小數（1 或 2），整欄小數點對齊
const fmtNum = v => v >= 10000 ? v.toLocaleString('en-US', {minimumFractionDigits:S.dec, maximumFractionDigits:S.dec}) : v.toFixed(S.dec);
const fmtPct = v => v.toFixed(S.dec) + '%';

// 類別可以有多個（最多 3 個，以「、」分隔），第一個是主要類別（顏色、排序依它）
const tagsOf = r => String(r.類 || '').split(/[、,，/／]/).map(s => s.trim()).filter(Boolean);
const pickV = x => S.calc === 'simple' && x.s != null ? x.s : x.v;   // 指數等沒有 s 的沿用 v
// 成立前的年度：前一年寫「2025年成立」、更早寫「尚未成立」（舊格式「25年5月成立」「-未成立」一併轉換）
const noteText = n => n === '-未成立' ? '尚未成立' : n.replace(/^(\d{2})年\d+月成立$/, '20$1年成立');
function yearValue(r, y) {
  const x = r.returns && r.returns[y];
  if (!x) return {sort:null, text:'(空白)'};
  if (x.note) return {sort:null, text:noteText(x.note)};
  const v = pickV(x);
  return {sort:v, text:fmtPct(v), partial:x.partial};
}
const PERIODS = [['w1', '近一週'], ['m1', '近一月'], ['m3', '近三月'], ['m6', '近半年'], ['y1', '近一年'],
  ['y3', '近三年<br>累積'], ['y3a', '近三年<br>年化', 3], ['y5', '近五年<br>累積'], ['y5a', '近五年<br>年化', 5]];
const RISK = [['hi52', '距52週<br>高點'], ['lo52', '距52週<br>低點'], ['mdd1', '近一年<br>最大回撤'], ['mdd3', '近三年<br>最大回撤'], ['vol', '年化<br>波動度']];
// 每個欄位：sort = 排序值，text = 顯示/篩選文字
const cols = [
  {k:'區', label:'區域', get:r => ({sort:r.區, text:r.區})},
  {k:'類', label:'類別', tags:true, get:r => ({sort:r.類, text:tagsOf(r).join('、')})},
  {k:'除息', label:'除息', get:r => ({sort:r.除息 || '', text:r.除息 || '(空白)'})},
  // 今年已除息：今年除息日已過的每股股息合計（元），與 build.py 相同
  {k:'divYtd', label:'今年<br>已除息', num:true, get:r => r.divYtd == null ? {sort:null, text:'(空白)'} : {sort:r.divYtd, text:String(+r.divYtd.toFixed(3))}},
  {k:'代碼', label:'代碼', get:r => ({sort:r.代碼, text:r.代碼})},
  {k:'名稱', label:'名稱', get:r => ({sort:r.名稱, text:r.名稱})},
  // 成立年度：Yahoo 該檔最早交易日（firstTradeDate）的年份
  {k:'since', label:'成立<br>年度', num:true, get:r => r.since ? {sort:+r.since.slice(0, 4), text:r.since.slice(0, 4)} : {sort:null, text:'(空白)'}},
  {k:'price', label:'現價', num:true, get:r => r.error ? {sort:null, text:'(無資料)'} : {sort:r.price, text:fmtNum(r.price)}},
  // 淨值：台股 ETF（證交所預估淨值，盤中即時）；折溢價＝現價 ÷ 淨值 − 1
  {k:'nav', label:'淨值', num:true, get:r => r.nav ? {sort:r.nav.v, text:fmtNum(r.nav.v)} : {sort:null, text:'(空白)'}},
  {k:'prem', label:'折溢價', num:true, get:r => r.nav && r.price ? {sort:(r.price / r.nav.v - 1) * 100, text:fmtPct((r.price / r.nav.v - 1) * 100)} : {sort:null, text:'(空白)'}},
  {k:'chg', label:'最後交易<br>日漲跌', num:true, get:r => r.chg == null ? {sort:null, text:'(無資料)'} : {sort:r.chg, text:fmtPct(r.chg)}},
  ...years.map(y => ({k:'y' + y, year:y, label:String(y), num:true, get:r => yearValue(r, y)})),
  // 近期模式的「今年」＝今年年度報酬率（年初至今），勾選才顯示
  {k:'pytd', period:true, multi:'ytd', label:'今年', num:true, get:r => yearValue(r, years[0])},
  // 近期報酬率；n = 年化的年數
  // multi：近三年／近五年的累積（cum）、年化（ann），由查詢選項決定是否顯示
  ...PERIODS.map(([k, label, n]) => ({k:'p' + k, period:true, multi:n ? 'ann' : /^y[35]$/.test(k) ? 'cum' : null, label, num:true, get:r => {
    const x = r.recent && r.recent[n ? k.slice(0, 2) : k];
    if (!x) return {sort:null, text:'(空白)'};
    if (x.note) return {sort:null, text:x.note};
    let v = pickV(x);
    if (v == null) return {sort:null, text:'(空白)'};
    if (n) v = (Math.pow(1 + v / 100, 1 / n) - 1) * 100;
    return {sort:v, text:fmtPct(v)};
  }})),
  // 風險指標（排在報酬率後面，兩種模式都顯示）
  ...RISK.map(([k, label]) => ({k, risk:true, label, num:true, get:r => {
    const x = r.risk && r.risk[k];
    if (!x) return {sort:null, text:'(空白)'};
    if (x.note) return {sort:null, text:x.note};
    const v = pickV(x);
    return {sort:v, text:fmtPct(v)};
  }})),
];
const colByKey = Object.fromEntries(cols.map(c => [c.k, c]));

// 狀態（存在瀏覽器，每天重新產生網頁後仍保留）
const S = load() || {};
S.sortKey = S.sortKey || 'y' + years[0];
S.sortDir = S.sortDir || -1;
S.filters = S.filters || {};      // k -> {vals:[允許的文字] | null, min, max}；類別另有 and（true＝都要符合）
if (S.filters.類 && S.filters.類.vals) S.filters.類.vals = [...new Set(S.filters.類.vals.map(t => t === '指數' ? '市值' : t))];   // 「指數」已併入「市值」
S.picked = S.picked || [];        // 勾選的代碼
delete S.mode;                    // 「只看／隱藏勾選」已移除
S.hiddenCols = S.hiddenCols || [];
// 手機預設隱藏區域、類別、除息（可從「欄位」叫回）；只在使用者沒自訂過欄位時套用一次
const MOBILE_HIDDEN = ['區', '類', '除息', 'divYtd', 'since', 'nav', 'prem', ...RISK.map(x => x[0])];
const defaultHidden = () => innerWidth < 600 ? [...MOBILE_HIDDEN] : [];
if (!S.colsV) { if (!S.hiddenCols.length) S.hiddenCols = defaultHidden(); S.colsV = 4; }
if (S.colsV === 2) { if (innerWidth < 600 && !S.hiddenCols.includes('since')) S.hiddenCols.push('since'); S.colsV = 3; }   // 新增的成立年度欄，手機預設也隱藏
if (S.colsV === 3) { if (innerWidth < 600 && !S.hiddenCols.includes('divYtd')) S.hiddenCols.push('divYtd'); S.colsV = 4; }   // 新增的今年已除息欄，手機預設也隱藏
if (S.colsV === 4) { if (innerWidth < 600) RISK.forEach(([k]) => S.hiddenCols.includes(k) || S.hiddenCols.push(k)); S.colsV = 5; }   // 新增的風險指標欄，手機預設也隱藏
if (S.colsV === 5) { if (innerWidth < 600 && !S.hiddenCols.includes('lo52')) S.hiddenCols.push('lo52'); S.colsV = 6; }   // 新增的距52週低點欄，手機預設也隱藏
if (S.colsV === 6) { if (innerWidth < 600) ['nav', 'prem'].forEach(k => S.hiddenCols.includes(k) || S.hiddenCols.push(k)); S.colsV = 7; }   // 新增的淨值、折溢價欄，手機預設也隱藏
delete S.method;                    // 舊版欄位（當時預設再投入）
S.calc = S.calc || 'simple';        // 'simple' 股息不再投入（預設）| 'tr' 股息再投入
S.dec = S.dec === 2 ? 2 : 1;        // 小數位數，預設 1 位
S.view = S.view === 'recent' ? 'recent' : 'year';   // 'year' 各年度 | 'recent' 近期
S.cum = !!S.cum; S.ann = !!S.ann;    // 近期是否顯示近三年／近五年的累積、年化（預設不顯示，避免太寬）
S.ytd = !!S.ytd;                     // 近期是否顯示「今年」（預設不顯示）
const needLong = () => S.view === 'recent' && (S.cum || S.ann);   // 要近五年的資料
const methodName = () => S.calc === 'simple' ? '股息不再投入' : '股息再投入';
const MAX_SPAN = Math.min(10, years.length);
S.span = Math.min(S.span || 3, MAX_SPAN);   // 報酬率年度範圍，預設近三年
if (S.collapsed == null) S.collapsed = innerWidth < 600;   // 查詢選項區收合，手機預設收合
function load() { try { return JSON.parse(localStorage.getItem('etf-state')); } catch (e) { return null; } }
function save() { try { localStorage.setItem('etf-state', JSON.stringify(S)); } catch (e) {} }

const inView = c => c.year ? S.view === 'year' && c.year > years[0] - S.span
  : c.period ? S.view === 'recent' && (!c.multi || S[c.multi]) : true;
const defaultSort = () => S.view === 'recent' ? 'py1' : 'y' + years[0];
// 欄位順序：S.colOrder＝使用者調整後的順序（單位）；報酬率欄（各年度或近期）算一個單位，整組移動
const unitOf = c => c.year || c.period ? 'RET' : c.k;
const UNIT_NAME = {get RET() { return S.view === 'recent' ? '近期報酬率' : '各年度報酬率'; }};
function units() {
  const def = [...new Set(cols.map(unitOf))];
  const order = (S.colOrder || []).filter(u => def.includes(u));
  def.forEach((u, i) => {   // 新增的欄位（或新的年度）放在預設順序的前一個單位後面
    if (order.includes(u)) return;
    const prev = def.slice(0, i).reverse().find(p => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, u);
  });
  return order;
}
const orderedCols = () => { const us = units(); return [...cols].sort((a, b) => us.indexOf(unitOf(a)) - us.indexOf(unitOf(b))); };
const visCols = () => orderedCols().filter(c => inView(c) && !S.hiddenCols.includes(c.k));
const picked = () => new Set(S.picked);

// 匯出圖片副標題用：目前的查詢篩選條件（文字說明）
function filterDesc() {
  const parts = [];
  const q = document.getElementById('q').value.trim();
  if (q) parts.push(`搜尋「${q}」`);
  for (const [k, f] of Object.entries(S.filters)) {
    const c = colByKey[k];
    if (!c || !inView(c)) continue;
    const label = c.label.replace(/<br>/g, '');
    if (f.vals) parts.push(`${label} ${f.vals.length > 5 ? f.vals.slice(0, 5).join('、') + ` 等 ${f.vals.length} 項` : f.vals.join('、')}${c.tags && f.and && f.vals.length > 1 ? '（都要符合）' : ''}`);
    if (f.min != null) parts.push(`${label} ≥ ${f.min}`);
    if (f.max != null) parts.push(`${label} ≤ ${f.max}`);
  }
  return parts.length ? '篩選：' + parts.join('；') : '';
}
// 匯出圖片檔名用：目前的查詢篩選條件（例：_類別-高息+主動_2026≥10_搜尋-00）
function filterTag() {
  const parts = [];
  const q = document.getElementById('q').value.trim();
  if (q) parts.push(`搜尋-${q}`);
  for (const [k, f] of Object.entries(S.filters)) {
    const c = colByKey[k];
    if (!c || !inView(c)) continue;
    const label = c.label.replace(/<br>/g, '');
    if (f.vals) parts.push(`${label}-${f.vals.length > 3 ? f.vals.slice(0, 3).join(c.tags && f.and ? '且' : '+') + `等${f.vals.length}項` : f.vals.join(c.tags && f.and ? '且' : '+')}`);
    if (f.min != null) parts.push(`${label}≥${f.min}`);
    if (f.max != null) parts.push(`${label}≤${f.max}`);
  }
  const tag = parts.join('_').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 80);   // 去掉檔名不能用的字元
  return tag ? '_' + tag : '';
}
function passFilter(r, c, f) {
  const v = c.get(r);
  if (f.vals && c.tags) {   // 類別：預設任一符合（聯集），and＝勾選的都要有（交集）
    const ts = tagsOf(r);
    if (f.and ? !f.vals.every(t => ts.includes(t)) : !ts.some(t => f.vals.includes(t))) return false;
  } else if (f.vals && !f.vals.includes(v.text)) return false;
  if (f.min != null && (v.sort == null || v.sort < f.min)) return false;
  if (f.max != null && (v.sort == null || v.sort > f.max)) return false;
  return true;
}
function filtered(exceptKey) {
  const q = document.getElementById('q').value.trim().toLowerCase();
  return DATA.rows.filter(r =>
    Object.entries(S.filters).every(([k, f]) => k === exceptKey || !colByKey[k] || !inView(colByKey[k]) || passFilter(r, colByKey[k], f)) &&
    (!q || (r.代碼 + r.名稱).toLowerCase().includes(q)));
}
function cmp(c, dir) {
  return (a, b) => {
    const x = c.get(a).sort, y = c.get(b).sort;
    if (x == null || x === '') return 1; if (y == null || y === '') return -1;
    return (c.num ? x - y : String(x).localeCompare(String(y), 'zh-Hant')) * dir;
  };
}

function head() {
  const vc = visCols();
  const nYear = vc.filter(c => c.year || c.period).length;
  // 群組列：連續的報酬率欄、風險指標欄各一格標題，其餘留白（欄位順序可調整，所以逐段組）
  const grpOf = c => c.year || c.period ? 'ret' : c.risk ? 'risk' : '';
  const runs = [];
  for (const c of vc) { const g = grpOf(c), last = runs[runs.length - 1]; if (last && last.g === g) last.n++; else runs.push({g, n:1}); }
  const retTitle = nYear <= 2 ? `${S.view === 'recent' ? '近期' : ''}報酬率<br><span class="gm">${S.calc === 'simple' ? '不再投入' : '再投入'}</span>`   // 欄位少時用短標題
    : `${S.view === 'recent' ? '近期' : '各年度'}含息報酬率<span class="gm">（${methodName()}）</span>`;
  const th = vc.map(c => {
    const s = S.sortKey === c.k ? (S.sortDir < 0 ? '▼' : '▲') : '⇅';
    return `<th${c.year || c.risk ? ' class="yr"' : c.period ? ' class="yr pd"' : c.k === '名稱' ? ' class="stk"' : ''}><div class="h"><span class="tools"><span class="s" data-sort="${c.k}">${s}</span>` +
      `<button class="f${S.filters[c.k] ? ' on' : ''}" data-f="${c.k}" title="篩選">▾</button></span>` +
      `<span class="lbl" data-sort="${c.k}">${c.label}</span></div></th>`;
  }).join('');
  document.querySelector('#t thead').innerHTML =
    `<tr class="group"><th style="border:none"></th>` +
    runs.map(r => r.g ? `<th colspan="${r.n}" class="grp">${r.g === 'ret' ? retTitle : '風險指標'}</th>` : `<th colspan="${r.n}" style="border:none"></th>`).join('') + `</tr>` +
    `<tr class="cols"><th><input type="checkbox" id="pickAll" title="全選／全不選（目前畫面上的列）"></th>${th}</tr>`;
  // 欄名列固定在群組列下方；群組列高度隨字級改變
  const gh = document.querySelector('#t thead tr.group').offsetHeight;
  document.querySelectorAll('#t thead tr.cols th').forEach(th => th.style.top = gh + 'px');
}

// 名稱是否放得進 9 個中文字的寬度（依實際字型量測，結果快取）
const nameCtx = document.createElement('canvas').getContext('2d'), nameFit = {};
function nameFits(t) {
  if (!(t in nameFit)) {
    const cs = getComputedStyle(document.body);
    nameCtx.font = `${cs.fontSize} ${cs.fontFamily}`;
    nameFit[t] = nameCtx.measureText(t).width <= nameCtx.measureText('國'.repeat(9)).width + 0.5;
  }
  return nameFit[t];
}
function cell(c, r) {
  const v = c.get(r);
  switch (c.k) {
    case '區': return `<td class="c r-${r.區}">${r.區}</td>`;
    case '類': { const ts = tagsOf(r); return `<td class="c t-${ts[0] || ''}${ts.join('、').length > 2 ? ' tsm' : ''}">${esc(ts[0] || '')}${ts.slice(1).map(t => `<span class="tg2">、${esc(t)}</span>`).join('')}</td>`; }   // 匯出圖片以主要類別的顏色畫整格
    case '除息': return `<td class="c div">${r.除息 || ''}</td>`;
    case '代碼': return `<td>${esc(v.text)}</td>`;
    case 'divYtd': return `<td class="r div">${v.sort == null ? '' : v.text}</td>`;
    case 'vol': return `<td class="r yr">${v.sort == null ? (v.text === '(空白)' ? '' : `<span class="note">${v.text}</span>`) : v.text}</td>`;   // 波動度不是報酬，不上色
    case 'since': return `<td class="c"${r.since ? ` title="${r.since}"` : ''}>${r.since ? v.text : ''}</td>`;
    case '名稱': return `<td class="stk" title="${esc(v.text)}"><span class="nm${nameFits(v.text) ? '' : ' sm'}">${esc(v.text)}</span>` +
      `${r.custom ? '<span class="tag">自訂</span>' : ''}</td>`;
    case 'nav': return `<td class="r"${r.nav ? ` title="${r.nav.d ? `${r.nav.d.replace(/(\d{4})(\d\d)(\d\d)/, '$1/$2/$3')} ${r.nav.t} ` : ''}預估淨值${r.nav.prev ? `；前一營業日淨值 ${fmtNum(r.nav.prev)}` : ''}"` : ''}>${r.nav ? v.text : ''}</td>`;
    case 'prem': return v.sort == null ? '<td></td>' : `<td class="r ${v.sort < 0 ? 'neg' : 'pos'}" title="正＝溢價（市價高於淨值），負＝折價">${v.text}</td>`;
    case 'price': return r._est ? `<td class="r" title="依加權指數即時漲跌估算">≈${v.text}</td>` : `<td class="r">${r.error ? '' : v.text}</td>`;
    case 'chg': return `<td class="r ${r.chg < 0 ? 'neg' : 'pos'}">${r.chg == null ? '' : v.text}</td>`;
  }
  if (v.sort == null) return `<td class="r yr note">${v.text === '(空白)' ? '' : v.text}</td>`;
  const cl = v.sort < 0 ? 'neg' : v.sort < 10 ? 'lowpos' : 'pos';
  return `<td class="r yr ${cl}${v.partial ? ' partial' : ''}"${v.partial ? ` title="${r.listed} 上市起算"` : ''}>${v.text}</td>`;
}

// 目前排序的欄位（排序欄不在畫面上時用預設排序）
const sortCol = () => colByKey[S.sortKey] && inView(colByKey[S.sortKey]) ? colByKey[S.sortKey] : colByKey[defaultSort()];
function body() {
  const sc = sortCol();
  const rows = filtered().sort(cmp(sc, S.sortDir));
  document.getElementById('spanN').textContent = S.span;
  document.getElementById('spanR').textContent = S.span > 1 ? `(${years[0] - S.span + 1}–${years[0]})` : `(${years[0]})`;
  const sf = S.filters.since || {};
  for (const [id, k] of [['sinceMin', 'min'], ['sinceMax', 'max']]) {
    const el = document.getElementById(id);
    if (document.activeElement !== el) el.value = sf[k] ?? '';
  }
  const pk = picked(), vc = visCols();
  // 表頭勾選框：依目前畫面上（篩選後）的列——全部勾選＝打勾，部分勾選＝「−」
  const pa = document.getElementById('pickAll'), nPk = rows.filter(r => pk.has(r.代碼)).length;
  if (pa) { pa.checked = rows.length > 0 && nPk === rows.length; pa.indeterminate = nPk > 0 && nPk < rows.length; }
  document.querySelector('#t tbody').innerHTML = rows.map(r =>
    `<tr class="${tagsOf(r)[0] || ''}${r.custom ? ' custom' : ''}${pk.has(r.代碼) ? ' picked' : ''}"><td class="c"><input type="checkbox" data-pick="${r.代碼}" ${pk.has(r.代碼) ? 'checked' : ''}>` +
    `<button class="rm" data-rm="${r.代碼}" title="從我的清單移除">✕</button></td>` +
    vc.map(c => cell(c, r)).join('') + `</tr>`).join('');
  const si = vc.indexOf(sc) + 1;   // 排序欄（第 0 欄是勾選）
  if (si) document.querySelectorAll('#t thead tr.cols, #t tbody tr').forEach(tr => tr.cells[si] && tr.cells[si].classList.add('sorted'));
  document.getElementById('info').textContent =
    `顯示 ${rows.length} / ${DATA.rows.length} 檔 · 勾選 ${pk.size} · ` +
    (S.view === 'recent' ? '近期＝最新收盤日往回推算，年化＝換算成平均每年' : '今年為年初至今，斜體＝上市當年');
  document.querySelector('.span').style.display = S.view === 'recent' ? 'none' : '';
  document.querySelector('.multi').style.display = S.view === 'recent' ? '' : 'none';
  document.querySelector('#t tfoot').innerHTML =
    `<tr><td colspan="${vc.length + 1}"><div><b>資料時間</b>　${marketText(rows)}` +
    `<span class="gen">${genText()}</span></div></td></tr>`;
  save();
}
const render = () => { head(); body(); };

// 只列出目前表格中有出現的市場
function marketText(rows) {
  const m = DATA.markets || {}, order = DATA.marketOrder || [];
  const present = new Set(rows.map(r => r.mkt).filter(Boolean));
  const names = order.concat(Object.keys(m).filter(k => !order.includes(k)));
  return names.filter(k => present.has(k) && m[k]).map(k => m[k].text).join('　｜　') || '—';
}

function popAt(btn, html) {
  closePop();
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = html;
  document.body.appendChild(pop);
  const rc = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(rc.left + scrollX, scrollX + innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (rc.bottom + scrollY + 4) + 'px';
  pop.addEventListener('click', e => e.stopPropagation());
  return pop;
}
function closePop() { document.querySelectorAll('.pop').forEach(p => p.remove()); }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function openFilter(k, btn) {
  const c = colByKey[k];
  // 選項來自「其他欄位篩選後」的資料，與 Excel 相同
  const base = filtered(k);
  const seen = new Map();
  const opts = r => c.tags ? tagsOf(r) : [c.get(r).text];   // 類別的選項是單一類別
  base.slice().sort(cmp(c, 1)).forEach(r => opts(r).forEach(t => { if (!seen.has(t)) seen.set(t, true); }));
  const f = S.filters[k] || {};
  const allowed = f.vals ? new Set(f.vals) : null;
  const pop = popAt(btn, `
    <div class="ttl">${c.label.replace('<br>', '')}</div>
    <div class="row"><button data-a="asc">${c.num ? '小→大' : 'A→Z'}</button><button data-a="desc">${c.num ? '大→小' : 'Z→A'}</button></div>
    ${c.num ? (() => {   // 數字欄：≥／≤ 範圍；提示依欄位（成立年度填年份、報酬率填 %）
      const hint = c.k === 'since' ? '年份' : c.k === 'price' || c.k === 'divYtd' ? '元' : '%';
      return `<div class="row rng"><label>≥<input type="number" step="any" id="fmin" placeholder="${hint}" value="${f.min ?? ''}"></label>` +
        `<label>≤<input type="number" step="any" id="fmax" placeholder="${hint}" value="${f.max ?? ''}"></label></div>`;
    })() : ''}
    ${c.tags ? `<div class="row mode"><label><input type="radio" name="fmode" value="or" ${f.and ? '' : 'checked'}>任一符合</label><label><input type="radio" name="fmode" value="and" ${f.and ? 'checked' : ''}>都要符合</label></div>` : ''}
    <div class="row"><input type="search" id="fq" placeholder="搜尋選項"></div>
    <div class="row"><button data-a="all">全選</button><button data-a="none">全不選</button></div>
    <div class="list">${[...seen.keys()].map(t =>
      `<label><input type="checkbox" value="${esc(t)}" ${!allowed || allowed.has(t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div>
    <div class="row"><button data-a="clear">清除此篩選</button><button data-a="ok"><b>確定</b></button></div>`);
  const boxes = () => [...pop.querySelectorAll('.list input')];
  pop.querySelector('#fq').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    boxes().forEach(b => b.parentElement.style.display = b.value.toLowerCase().includes(q) ? '' : 'none');
  });
  pop.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const shown = boxes().filter(b => b.parentElement.style.display !== 'none');
    if (a === 'all') shown.forEach(b => b.checked = true);
    if (a === 'none') shown.forEach(b => b.checked = false);
    if (a === 'asc' || a === 'desc') { S.sortKey = k; S.sortDir = a === 'asc' ? 1 : -1; closePop(); render(); }
    if (a === 'clear') { delete S.filters[k]; closePop(); render(); }
    if (a === 'ok') {
      const nf = {};
      // 只更新清單中出現的項目；被其他篩選隱藏的項目維持原狀
      const every = new Set(DATA.rows.flatMap(opts));
      const next = new Set(allowed || every);
      boxes().forEach(b => b.checked ? next.add(b.value) : next.delete(b.value));
      if (next.size < every.size) nf.vals = [...next];
      if (nf.vals && c.tags && pop.querySelector('input[name=fmode]:checked').value === 'and') nf.and = true;
      if (c.num) {
        const mn = pop.querySelector('#fmin').value, mx = pop.querySelector('#fmax').value;
        if (mn !== '') nf.min = +mn;
        if (mx !== '') nf.max = +mx;
      }
      if (Object.keys(nf).length) S.filters[k] = nf; else delete S.filters[k];
      closePop(); render();
    }
  });
}

function openCols(btn) {
  // 勾選＝顯示；↑↓＝調整順序（報酬率欄整組移動）
  const listHtml = () => {
    const us = units(), vis = orderedCols().filter(inView);
    return us.filter(u => vis.some(c => unitOf(c) === u)).map((u, i, arr) => {
      const mv = `<span class="mv"><button data-mv="${u}" data-d="-1" ${i ? '' : 'disabled'} title="往前（左）移">↑</button><button data-mv="${u}" data-d="1" ${i < arr.length - 1 ? '' : 'disabled'} title="往後（右）移">↓</button></span>`;
      const box = c => `<label><input type="checkbox" value="${c.k}" ${S.hiddenCols.includes(c.k) ? '' : 'checked'}>${c.label.replace(/<br>/g, '')}</label>`;
      const cs = vis.filter(c => unitOf(c) === u);
      return UNIT_NAME[u] ? `<div class="it grp"><span class="gname">${UNIT_NAME[u]}</span>${mv}</div><div class="sub">${cs.map(box).join('')}</div>`
        : `<div class="it">${box(cs[0])}${mv}</div>`;
    }).join('');
  };
  const pop = popAt(btn, `<div class="ttl">顯示欄位與順序</div>
    <div class="row"><button data-a="all">全選</button><button data-a="none">全不選</button><button data-a="order">預設順序</button></div>
    <div class="list">${listHtml()}</div>`);
  pop.style.width = '250px';
  const sync = () => { S.hiddenCols = [...pop.querySelectorAll('.list input')].filter(b => !b.checked).map(b => b.value); render(); };
  pop.addEventListener('change', sync);
  pop.addEventListener('click', e => {
    const m = e.target.closest('[data-mv]');
    if (m) {   // 和前／後一個（目前模式看得到的）單位交換
      const us = units(), vis = new Set(orderedCols().filter(inView).map(unitOf)), shown = us.filter(u => vis.has(u));
      const i = shown.indexOf(m.dataset.mv), j = i + +m.dataset.d;
      if (j < 0 || j >= shown.length) return;
      const a = us.indexOf(shown[i]), b = us.indexOf(shown[j]);
      [us[a], us[b]] = [us[b], us[a]];
      S.colOrder = us; render();
      const list = pop.querySelector('.list'), top = list.scrollTop;
      list.innerHTML = listHtml(); list.scrollTop = top;
      return;
    }
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'order') { delete S.colOrder; render(); pop.querySelector('.list').innerHTML = listHtml(); return; }
    pop.querySelectorAll('.list input').forEach(b => b.checked = a === 'all');
    sync();
  });
}

document.querySelector('#t thead').addEventListener('click', e => {
  const fb = e.target.closest('[data-f]');
  if (fb) { e.stopPropagation(); openFilter(fb.dataset.f, fb); return; }
  const sb = e.target.closest('[data-sort]');
  if (sb) {
    const k = sb.dataset.sort;
    if (S.sortKey === k) S.sortDir = -S.sortDir; else { S.sortKey = k; S.sortDir = colByKey[k].num ? -1 : 1; }
    render();
  }
});
document.querySelector('#t thead').addEventListener('change', e => {
  if (e.target.id !== 'pickAll') return;
  const vis = filtered().map(r => r.代碼), pk = picked();
  vis.forEach(c => e.target.checked ? pk.add(c) : pk.delete(c));
  S.picked = [...pk]; render();
});
document.querySelector('#t tbody').addEventListener('change', e => {
  const code = e.target.dataset.pick; if (!code) return;
  const pk = picked();
  e.target.checked ? pk.add(code) : pk.delete(code);
  S.picked = [...pk]; render();
});
const optBtn = document.getElementById('optBtn');
function applyCollapsed() {
  document.body.classList.toggle('collapsed', S.collapsed);
  optBtn.textContent = S.collapsed ? '顯示查詢選項 ▾' : '隱藏查詢選項 ▴';
}
optBtn.onclick = () => { S.collapsed = !S.collapsed; applyCollapsed(); save(); };
applyCollapsed();
// 表格字級：0 為預設，每級 1px，範圍 −3～+5
const FZ_MIN = -3, FZ_MAX = 5;
function applyFz() {
  document.documentElement.style.setProperty('--fz', S.fz + 'px');
  document.getElementById('fzDown').disabled = S.fz <= FZ_MIN;
  document.getElementById('fzUp').disabled = S.fz >= FZ_MAX;
}
S.fz = Math.max(FZ_MIN, Math.min(FZ_MAX, +S.fz || 0));
applyFz();
document.getElementById('fzDown').onclick = () => { S.fz--; applyFz(); render(); };
document.getElementById('fzUp').onclick = () => { S.fz++; applyFz(); render(); };
document.getElementById('colBtn').onclick = e => { e.stopPropagation(); openCols(e.currentTarget); };
// ---- 匯出圖片：依目前畫面（篩選、排序、欄位）把表格畫成 PNG，方便分享 ----
async function exportImage() {
  // 副標題：期間、算法、排序、資料日期與篩選條件；表格下方：目前算法說明
  const sc = sortCol();
  const sortTxt = `依「${sc.label.replace(/<br>/g, '')}」${sc.num ? (S.sortDir < 0 ? '由高到低' : '由低到高') : (S.sortDir < 0 ? 'Z→A' : 'A→Z')}排序`;
  const sub = [S.view === 'recent' ? '近期報酬率' : `各年度報酬率（${years[0] - S.span + 1}–${years[0]}）`,
    methodName(), sortTxt, `資料日期 ${DATA.updated.slice(0, 10)}`, filterDesc()].filter(Boolean).join('・');
  const how = S.calc === 'simple'
    ? '算法：股息不再投入＝（該年最後收盤價＋當年除息合計−前一年最後收盤價）÷ 前一年最後收盤價；股息領了不再買回，以除息日歸年。'
    : '算法：股息再投入＝該年最後還原收盤價 ÷ 前一年最後還原收盤價 − 1；假設股息於除息日以當日價格買回（同報酬指數，實際入帳會晚數週）。';
  await TableImage.exportTable({
    table:document.getElementById('t'), skipCols:1, sortDir:S.sortDir, title:'ETF 含息報酬率', sub,
    note:how + (S.view === 'recent'
      ? '近期：以最新收盤日往回推 7 天、1／3／6／12／36／60 個月，起點取該日或之前最後一個交易日收盤；年化＝(1＋累積)^(1/年數)−1。'
      : '今年為年初至今；斜體＝上市當年，從上市首日收盤起算。'),
    foot:document.querySelector('#t tfoot td').textContent.replace(genText(), '').trim() + '　' + genText(),
    filename:`etf-returns-${DATA.updated.slice(0, 10).replace(/\//g, '')}${filterTag()}.png`,
  });
}
document.getElementById('expBtn').onclick = () => exportImage().catch(e => alert('匯出失敗：' + e.message));
// ---- 個人追蹤清單（watchlist.js，與「我的追蹤清單」頁同步）----
WL.setProxy(PROXY); MK.setProxy(PROXY);
const BASE = DATA.rows;
const baseByCode = Object.fromEntries(BASE.map(r => [r.代碼, r]));
const amsg = (t, cls) => { const el = document.getElementById('amsg'); el.textContent = t; el.className = cls || ''; };

const pad = n => String(n).padStart(2, '0');
function fmtTs(ts, off) {
  const d = new Date((ts + off) * 1000);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function marketTime(meta) {  // 與 build.py market_time 相同：已收盤以收盤時間為準
  const tz = meta.exchangeTimezoneName || '';
  const [market, city] = WL.MK[tz] || [meta.fullExchangeName || tz, tz];
  const off = meta.gmtoffset || 0, rmt = meta.regularMarketTime;
  const reg = (meta.currentTradingPeriod || {}).regular;
  const now = Date.now() / 1000;
  if (!rmt || !reg) return {market, city, ts:rmt, closed:true, off};
  const open = reg.start <= now && now < reg.end;
  let ts = rmt;
  if (!open) {
    const tod = ((reg.end + off) % 86400 + 86400) % 86400;
    ts = Math.floor((rmt + off) / 86400) * 86400 + tod - off;
    if (ts > rmt + 43200) ts = rmt;
  }
  return {market, city, ts, closed:!open, off};
}
function marketTextOf(m) {
  let t = `${m.market} ${fmtTs(m.ts, m.off)} ${m.closed ? '收盤' : '盤中'}`;
  if (m.off !== 28800) t += `（${m.city}時間，台北 ${fmtTs(m.ts, 28800)}）`;
  return t;
}

function histGet() { try { return JSON.parse(localStorage.getItem('etf-hist')) || {}; } catch (e) { return {}; } }
function histSet(h) { try { localStorage.setItem('etf-hist', JSON.stringify(h)); } catch (e) {} }

// 近期報酬率（與 build.py recent_returns 相同）：以最新收盤日往回推日曆日，起點取該日或之前最後一個交易日收盤
const PERIOD_DEF = {w1:[0, 7], m1:[1, 0], m3:[3, 0], m6:[6, 0], y1:[12, 0], y3:[36, 0], y5:[60, 0]};
function recentReturns(pts, divs, keys = Object.keys(PERIOD_DEF)) {
  const end = pts[pts.length - 1], out = {};
  for (const k of keys) {
    const t = MK.periodTarget(end.day, ...PERIOD_DEF[k]);
    let start = null;
    for (const p of pts) { if (p.day > t) break; start = p; }
    if (!start) { out[k] = {note:'上市未滿'}; continue; }
    const div = divs.reduce((s, dv) => dv.day > start.day && dv.day <= end.day ? s + dv.v : s, 0);
    out[k] = {v:(end.a / start.a - 1) * 100, s:((end.c + div) / start.c - 1) * 100};
  }
  return out;
}
// 風險指標（與 build.py risk_stats 相同）：距 52 週高點、近一年／三年最大回撤、近一年年化波動度（%）
// 再投入用還原價；不再投入從 i 到 j 的跌幅＝（j 收盤＋i 之後的除息合計）÷ i 收盤 − 1；波動度兩種相同
const RISK_WIN = {hi52:12, lo52:12, mdd1:12, mdd3:36, vol:12};
function riskStats(pts, divs, keys = Object.keys(RISK_WIN)) {
  const end = pts[pts.length - 1], out = {}, cd = [];
  const ds = [...divs].sort((x, y) => x.day < y.day ? -1 : 1);
  let acc = 0, k = 0;
  for (const p of pts) {
    while (k < ds.length && ds[k].day <= p.day) { if (ds[k].day > pts[0].day) acc += ds[k].v; k++; }
    cd.push(acc);
  }
  const ddS = (i, j) => (pts[j].c + cd[j] - cd[i]) / pts[i].c - 1;
  for (const key of keys) {
    const t = MK.periodTarget(end.day, RISK_WIN[key], 0);
    let si = -1;
    for (let i = 0; i < pts.length && pts[i].day <= t; i++) si = i;
    if (si < 0) { out[key] = {note:'上市未滿'}; continue; }
    const n = pts.length - 1;
    if (key === 'vol') {
      const rs = [];
      for (let i = si + 1; i <= n; i++) rs.push(pts[i].a / pts[i - 1].a - 1);
      const m = rs.reduce((s, x) => s + x, 0) / rs.length;
      const sd = Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (rs.length - 1) * 252) * 100;
      out[key] = {v:sd, s:sd};
    } else if (key === 'hi52') {
      let hi = 0, ms = 0;
      for (let i = si; i <= n; i++) { hi = Math.max(hi, pts[i].a); ms = Math.min(ms, ddS(i, n)); }
      out[key] = {v:(pts[n].a / hi - 1) * 100, s:ms * 100};
    } else if (key === 'lo52') {   // 從近一年任一天到現在的漲幅取最大（＝離最低點多遠）
      let lo = Infinity, ms = -Infinity;
      for (let i = si; i <= n; i++) { lo = Math.min(lo, pts[i].a); ms = Math.max(ms, ddS(i, n)); }
      out[key] = {v:(pts[n].a / lo - 1) * 100, s:ms * 100};
    } else {
      let peak = 0, mv = 0, ms = 0;
      for (let j = si; j <= n; j++) {
        peak = Math.max(peak, pts[j].a); mv = Math.min(mv, pts[j].a / peak - 1);
        for (let i = si; i <= j; i++) ms = Math.min(ms, ddS(i, j));
      }
      out[key] = {v:mv * 100, s:ms * 100};
    }
  }
  return out;
}
// 解析 Yahoo 日K：補上漏掉的分割調整、缺的最後一根日K（與 build.py analyze 相同）
function parseChart(data) {
  const meta = data.meta, off = meta.gmtoffset ?? 28800;
  const q = data.indicators.quote[0].close, a = data.indicators.adjclose[0].adjclose;
  const pts = [];
  data.timestamp.forEach((t, i) => {
    if (q[i] == null || a[i] == null) return;
    const d = new Date((t + off) * 1000);
    pts.push({y:d.getUTCFullYear(), m:d.getUTCMonth() + 1, day:d.toISOString().slice(0, 10), c:q[i], a:a[i]});
  });
  const divs = Object.values((data.events || {}).dividends || {}).map(ev => {
    const d = new Date((ev.date + off) * 1000);
    return {y:d.getUTCFullYear(), day:d.toISOString().slice(0, 10), v:ev.amount};
  });
  if (!pts.length) return {meta, off, pts, divs};
  // Yahoo 漏掉的分割調整（收盤價與當時的配息金額同樣調整）
  const splitN = r => { const n = r > 1 ? Math.round(r) : 1 / Math.round(1 / r); return (r > 1.6 || r < 0.6) && Math.abs(r / n - 1) < 0.12 ? n : 0; };
  for (let i = pts.length - 1; i > 0; i--) {
    let n = splitN(pts[i - 1].a / pts[i].a);
    if (n) for (let j = 0; j < i; j++) pts[j].a /= n;
    n = splitN(pts[i - 1].c / pts[i].c);
    if (n) { for (let j = 0; j < i; j++) pts[j].c /= n; divs.forEach(dv => { if (dv.day < pts[i].day) dv.v /= n; }); }
  }
  // Yahoo 有時缺最後一根日K（例如除息日當天）：用最新成交價補上，期間除息一併計入還原價
  const rmt = meta.regularMarketTime, lastPx = meta.regularMarketPrice;
  if (rmt && lastPx) {
    const dn = new Date((rmt + off) * 1000), dayNow = dn.toISOString().slice(0, 10), lp = pts[pts.length - 1];
    if (dayNow > lp.day) {
      const div = Object.values((data.events || {}).dividends || {}).reduce((s, ev) => {
        const dd = new Date((ev.date + off) * 1000).toISOString().slice(0, 10);
        return dd > lp.day && dd <= dayNow ? s + ev.amount : s;
      }, 0);
      pts.push({y:dn.getUTCFullYear(), m:dn.getUTCMonth() + 1, day:dayNow, c:lastPx, a:lp.a * (lastPx + div) / lp.c});
    }
  }
  return {meta, off, pts, divs};
}

// 近一年的除息日 → 「每月」或月份清單（與 build.py div_months 相同）。
// young＝上市未滿一年：依間隔推算（約 1 個月＝每月；固定 3／6 個月＝季配／半年配，補齊整年的月份）
function divMonths(days, young) {
  const months = [...new Set(days.map(d => +d.slice(5, 7)))].sort((a, b) => a - b);
  if (months.length >= 9) return '每月';
  const idx = [...new Set(days.map(d => +d.slice(0, 4) * 12 + +d.slice(5, 7) - 1))].sort((a, b) => a - b);
  if (young && idx.length >= 2) {
    const gaps = new Set(idx.slice(1).map((v, i) => v - idx[i])), span = idx[idx.length - 1] - idx[0] + 1;
    if (idx.length >= 3 && Math.max(...gaps) <= 2 && idx.length >= span * 0.75) return '每月';
    const step = idx[1] - idx[0];
    if (gaps.size === 1 && (step === 3 || step === 6))
      return [...new Set(Array.from({length:12 / step}, (_, k) => (idx[0] + k * step) % 12 + 1))].sort((a, b) => a - b).join(',');
  }
  return months.length ? months.join(',') : '無';
}
// 與 build.py analyze 相同的計算
async function analyzeJS(it) {
  // 已結束年度的報酬率記在瀏覽器（etf-hist），有缺的年度才抓長期資料
  const key = it.代碼 + (it.Yahoo代號 ? '|' + it.Yahoo代號 : '');
  const cached = histGet()[key] || {}, done = cached.returns || {};
  // 舊記錄沒有「股息不再投入」報酬率（s）的年度也要重算
  const missing = years.slice(1).filter(y => !done[y] || (done[y].v != null && done[y].s == null));
  const recent = Math.floor(Date.now() / 1000) - (5 * 366 + 20) * 86400;   // 近期報酬率最長五年
  const p1 = missing.length ? Math.min(Math.floor(new Date(Math.min(...missing) - 1, 11, 1) / 1000), recent) : recent;
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  let data = null, sym = null;
  for (const s of WL.symbolsFor(it)) {
    data = await WL.chart(s, `period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`).catch(() => null);
    if (data) { sym = s; break; }
  }
  const out = {...it, custom:true};
  if (!data) return {...out, error:'查無資料'};
  const {meta, off, pts, divs} = parseChart(data);
  if (!pts.length) return {...out, error:'查無資料'};
  const mt = marketTime(meta);
  out.symbol = sym;
  out._m = mt;
  if (meta.firstTradeDate) out.since = new Date((meta.firstTradeDate + (meta.gmtoffset ?? 28800)) * 1000).toISOString().slice(0, 10);
  out.mkt = mt.market;
  out.price = meta.regularMarketPrice ?? pts[pts.length - 1].c;
  const prev = await WL.chart(sym, 'range=1d&interval=1d').then(d => d && d.meta.chartPreviousClose).catch(() => null);
  out.chg = prev ? (out.price / prev - 1) * 100 : null;
  out.date = pts[pts.length - 1].day;
  const first = pts[0];
  let listed, frm;
  if (!cached.returns || (missing.length && Math.min(...missing) < (cached.from ?? 9999))) {
    listed = first.day > `${years[years.length - 1] - 1}-12-31` ? first : null;
    frm = years[years.length - 1];
  } else {
    listed = cached.listed ? {day:cached.listed, y:+cached.listed.slice(0, 4), m:+cached.listed.slice(5, 7)} : null;
    frm = cached.from;
  }
  out.listed = listed ? listed.day : null;
  const lastAdj = y => { let v = null; for (const p of pts) if (p.y === y) v = p.a; return v; };
  const lastClose = y => { let v = null; for (const p of pts) if (p.y === y) v = p.c; return v; };
  const lastDay = pts[pts.length - 1].day;
  const divSum = y => divs.reduce((s, dv) => dv.y === y && dv.day > first.day && dv.day <= lastDay ? s + dv.v : s, 0);
  const fresh = {};
  out.returns = fresh;
  for (const y of [years[0], ...missing]) {
    const end = lastAdj(y), prv = lastAdj(y - 1);
    if (end == null) {
      if (listed && listed.y === y + 1) out.returns[y] = {note:`${listed.y}年成立`};
      else if (listed && listed.y > y) out.returns[y] = {note:'尚未成立'};
      continue;
    }
    out.returns[y] = prv == null ? {v:(end / first.a - 1) * 100, partial:true} : {v:(end / prv - 1) * 100};
    out.returns[y].s = ((lastClose(y) + divSum(y)) / (prv == null ? first.c : lastClose(y - 1)) - 1) * 100;
  }
  out.returns = {};
  for (const y of years) { const v = fresh[y] || done[y]; if (v) out.returns[y] = v; }
  // 只記錄已結束、且資料已跨到下一年的年度；寫入前重新讀取，避免多檔同時載入互相覆蓋
  const settled = Object.fromEntries(Object.entries(fresh).filter(([y]) => +y < years[0] && out.date > `${y}-12-31`));
  out.recent = recentReturns(pts, divs);
  out.risk = riskStats(pts, divs);
  out.divYtd = divYtd(divs, lastDay);
  const H = histGet();
  H[key] = {listed:out.listed, from:frm, returns:{...done, ...settled}};
  histSet(H);
  if (!it.除息) {
    const cutoff = new Date(new Date(out.date) - 380 * 864e5).toISOString().slice(0, 10);
    out.除息 = divMonths(divs.filter(dv => dv.day >= cutoff).map(dv => dv.day), first.day > cutoff);
  }
  return out;
}

function mergeMarket(m) {
  if (!m || !m.ts) return;
  DATA.markets = DATA.markets || {};
  const cur = DATA.markets[m.market];
  if (!cur || m.ts >= cur.ts) DATA.markets[m.market] = {ts:m.ts, text:marketTextOf(m)};
}

// ---- 即時更新：打開網頁時抓預設項目的最新價格，重算現價、漲跌與今年報酬率；歷年報酬率沿用排程資料 ----
const LIVE = {state:'loading', at:0, ok:0, fail:0, lastFail:false};
const nowTPE = () => fmtTs(Math.floor(Date.now() / 1000), 28800);
function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? '剛剛' : m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時 ${m % 60} 分鐘前`;
}
// 表格下方：最後一次成功取得即時資料的時間（含幾分鐘前），抓不到時仍顯示上次成功的時間
function genText() {
  const sched = `排程更新於 ${DATA.updated}（台北時間）`;
  if (!LIVE.at) return LIVE.state === 'loading' ? `${sched}　即時價格載入中…` : `${sched}　即時價格無法取得，全部沿用排程資料`;
  // 各市場都已收盤：資料就是收盤價（時間見「資料時間」），不再顯示「幾分鐘前」
  const o = marketsOpen();
  if (!o.tw && !o.other) return `現價與報酬率為收盤資料　歷年報酬率${sched}` +
    (LIVE.fail ? `　${LIVE.fail} 檔即時更新失敗，沿用排程資料` : '');
  return `現價與報酬率更新於 ${fmtTs(Math.floor(LIVE.at / 1000), 28800).slice(11)}（${ago(LIVE.at)}）` +
    (LIVE.lastFail ? '，最近一次更新失敗' : '') + `　歷年報酬率${sched}` +
    (LIVE.fail ? `　${LIVE.fail} 檔即時更新失敗，沿用排程資料` : '');
}
function refreshGenText() {
  const el = document.querySelector('#t tfoot .gen');
  if (el) el.textContent = genText();
}

const isTW = r => /\.TWO?$/.test(r.symbol || '');
// 用即時報價補上／取代最後一根日K（同日：同比例調整還原價；新的一天：期間除息一併計入）
function patchPts(pts, divs, q) {
  const last = pts[pts.length - 1];
  if (q.day < last.day) return;
  if (q.day === last.day) { last.a *= q.price / last.c; last.c = q.price; return; }
  const div = divs.reduce((s, dv) => dv.day > last.day && dv.day <= q.day ? s + dv.v : s, 0);
  pts.push({y:+q.day.slice(0, 4), m:+q.day.slice(5, 7), day:q.day, c:q.price, a:last.a * (q.price + div) / last.c});
}
// 今年已除息：今年除息日已過的每股股息合計（與 build.py 相同）
const divYtd = (divs, lastDay) => divs.reduce((s, dv) => dv.y === years[0] && dv.day <= lastDay ? s + dv.v : s, 0);
// 由日K重算現價、漲跌、今年與近期報酬率
function computeLive(r, src, q) {
  const y = years[0], long = src.long;
  const pts = src.pts.map(p => ({...p})), divs = src.divs;
  if (q) patchPts(pts, divs, q);
  const cur = pts.filter(p => p.y === y), prev = pts.filter(p => p.y === y - 1);
  if (!cur.length || pts.length < 2) throw new Error('今年尚無資料');
  const end = cur[cur.length - 1], base = prev.length ? prev[prev.length - 1] : cur[0];
  const div = divs.reduce((s, dv) => dv.y === y && dv.day > base.day && dv.day <= end.day ? s + dv.v : s, 0);
  const ret = {v:(end.a / base.a - 1) * 100, s:((end.c + div) / base.c - 1) * 100};
  if (!prev.length) ret.partial = true;   // 今年上市
  r.returns = {...r.returns, [y]:ret};
  r.recent = {...r.recent, ...recentReturns(pts, divs, long ? undefined : ['w1', 'm1', 'm3', 'm6', 'y1'])};
  r.risk = {...r.risk, ...riskStats(pts, divs, long ? undefined : ['hi52', 'lo52', 'mdd1', 'vol'])};   // 一般只抓近兩年，近三年回撤沿用排程
  r.divYtd = divYtd(divs, end.day);
  if (q) {
    r.price = q.price;
    r.chg = q.prev ? (q.price / q.prev - 1) * 100 : (q.price / pts[pts.length - 2].c - 1) * 100;
    mergeMarket({market:'台股', city:'台北', ts:q.ts, closed:q.closed, off:28800});
    r.mkt = '台股';
    r._final = q.closed ? q.day : '';   // 已是收盤價（記交易日）：收盤後不用再更新
  } else {
    r.price = src.meta.regularMarketPrice ?? end.c;
    r.chg = (r.price / pts[pts.length - 2].c - 1) * 100;
    const mt = marketTime(src.meta);
    r.mkt = mt.market;
    mergeMarket(mt);
  }
  r.date = end.day;
}
// 改用證交所歷史資料的標的（Yahoo 缺歷史）：以排程時的價格為基準，依即時價格等比例調整報酬率
function scaleTwse(r, q) {
  const b = r._base || (r._base = {price:r.price, date:r.date, returns:JSON.parse(JSON.stringify(r.returns || {})), recent:JSON.parse(JSON.stringify(r.recent || {})), risk:r.risk});
  if (!b.price || !q) return;
  const k = q.price / b.price, sc = x => x == null ? x : ((1 + x / 100) * k - 1) * 100;
  const adj = o => o && o.note == null ? {...o, v:sc(o.v), s:sc(o.s)} : o;
  const y = years[0];
  r.returns = {...b.returns, [y]:adj(b.returns[y])};
  r.recent = Object.fromEntries(Object.entries(b.recent).map(([k2, o]) => [k2, adj(o)]));
  if (b.risk) {   // 距 52 週高低點跟著現價等比例調整（超過高點＝0%、跌破低點＝0%）；回撤、波動度沿用排程
    const cl = (o, f) => o && o.note == null ? {v:f(sc(o.v)), s:f(sc(o.s))} : o;
    r.risk = {...b.risk, hi52:cl(b.risk.hi52, x => Math.min(0, x)), lo52:cl(b.risk.lo52, x => Math.max(0, x))};
  }
  r.price = q.price;
  r.chg = q.prev ? (q.price / q.prev - 1) * 100 : r.chg;
  r.date = q.day;
  r._final = q.closed ? q.day : '';
  mergeMarket({market:'台股', city:'台北', ts:q.ts, closed:q.closed, off:28800});
}
// 證交所指數：加權指數用證交所即時報價（代碼 t00，需新版資料代理）；
// 報酬指數有即時值就用，沒有就以加權指數漲跌估算（除息日當天會略低於實際）
const isIdx = r => /^TWSE:/i.test(r.Yahoo代號 || '');
const IX0 = (({price, date}) => ({price, date}))(BASE.find(r => r.代碼 === 'IX0001') || {});   // 排程時的加權指數
function idxQuote(r, iq) {
  const t = iq.t00;
  if (r.代碼 === 'IX0001') return t;
  if (iq[r.代碼]) { r._est = false; return iq[r.代碼]; }
  const b = r._base || r;
  // 排程已有當天正式收盤值就不估算
  if (r.代碼 !== 'IR0001' || !t || !IX0.price || IX0.date !== b.date || b.date >= t.day) return null;
  const k = t.price / IX0.price, price = b.price * k;
  r._est = true;
  return {...t, price, prev:t.prev ? price * t.prev / t.price : null};
}
// 台股 ETF 淨值：證交所預估淨值（market.js），舊版資料代理沒有時沿用排程資料
async function navRefresh() {
  const navs = await MK.etfNav();
  for (const r of [...BASE, ...Object.values(customRows)]) if (isTW(r) && navs[r.代碼]) r.nav = navs[r.代碼];
}
async function idxRefresh(rows) {
  if (!rows.length) return 0;
  const iq = await MK.mis(['t00', 'IR0001']);   // 舊版資料代理不認得 t00，整批失敗就沿用排程資料
  let n = 0;
  for (const r of rows) { const q = idxQuote(r, iq); if (q) { scaleTwse(r, q); n++; } }
  return n;
}
async function liveQuote(r, long, q) {
  const y = years[0];
  // 起訖固定到「日」，讓 Worker 快取可以共用（約 5 分鐘）。
  // 一般從前年 12/15 起（涵蓋去年底與近一年）；近期模式要近五年，從六年前 12/15 起
  const p1 = Date.UTC(y - (long ? 6 : 2), 11, 15) / 1000, p2 = (Math.floor(Date.now() / 864e5) + 1) * 86400;
  const data = await WL.chart(r.symbol, `period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`);
  if (!data) throw new Error('查無資料');
  const {meta, pts, divs} = parseChart(data);
  r._live = {meta, pts, divs, long};   // 留著給每分鐘的台股即時報價重算
  computeLive(r, r._live, q);
}
// 完整更新：Yahoo 日K（全部）＋證交所即時報價（台股）
async function liveRefresh() {
  if (!await WL.proxy()) { LIVE.state = 'off'; return body(); }
  const long = needLong();
  // 台股收盤後已取得收盤價的不再重抓；證交所指數另外處理
  const twOpen = marketsOpen().tw, done = r => (isTW(r) || isIdx(r)) && r._final && !twOpen;
  const todo = BASE.filter(r => r.symbol && !r.error && !isIdx(r) && !done(r));
  const idx = BASE.filter(r => isIdx(r) && !r.error && !done(r));
  if (!todo.length && !idx.length) return refreshGenText();
  Object.assign(LIVE, {state:'loading', ok:0, fail:0});
  refreshGenText();
  LIVE.ok += await idxRefresh(idx);
  if (todo.some(isTW)) await navRefresh();
  const quotes = await MK.mis(todo.filter(isTW).map(r => r.代碼));
  let i = 0;
  const worker = async () => {   // 同時最多 8 個請求
    while (i < todo.length) {
      const r = todo[i++];
      if (r.src === 'twse') { quotes[r.代碼] ? (scaleTwse(r, quotes[r.代碼]), LIVE.ok++) : null; continue; }
      await liveQuote(r, long, quotes[r.代碼]).then(() => LIVE.ok++, () => LIVE.fail++);
    }
  };
  await Promise.all(Array.from({length:8}, worker));
  LIVE.state = 'done'; LIVE.long = long;
  LIVE.lastFail = !LIVE.ok;
  if (LIVE.ok) LIVE.at = Date.now();
  rebuildRows();
}
// 台股盤中每分鐘：只抓證交所即時報價（一兩個請求），用先前的日K重算
async function twTick() {
  const today = nowTPE().slice(0, 10).replace(/\//g, '-');   // 今天已收盤的不再抓
  const rows = BASE.filter(r => isTW(r) && (r._live || r.src === 'twse') && r._final !== today);
  const idx = BASE.filter(r => isIdx(r) && !r.error && r._final !== today);
  if (!rows.length && !idx.length) return;
  let n = await idxRefresh(idx);
  if (rows.length) await navRefresh();
  const quotes = rows.length ? await MK.mis(rows.map(r => r.代碼)) : {};
  for (const r of rows) {
    const q = quotes[r.代碼];
    if (!q) continue;
    try { r.src === 'twse' ? scaleTwse(r, q) : computeLive(r, r._live, q); n++; } catch (e) {}
  }
  LIVE.lastFail = !n;
  if (n) { LIVE.at = Date.now(); rebuildRows(); } else refreshGenText();
}
// 開盤時間自動更新（台北時間）：台股 9:00–13:35 每分鐘；美股、英股開盤時每 5 分鐘完整更新一次
function marketsOpen() {
  const d = new Date(Date.now() + 8 * 3600e3), wd = d.getUTCDay(), hm = d.getUTCHours() * 60 + d.getUTCMinutes();
  const tw = wd >= 1 && wd <= 5 && hm >= 540 && hm <= 815;
  const us = (wd >= 1 && wd <= 5 && hm >= 1290) || (wd >= 2 && wd <= 6 && hm <= 330);   // 約 21:30–05:30
  const uk = (wd >= 1 && wd <= 5 && hm >= 900) || (wd >= 2 && wd <= 6 && hm <= 30);     // 約 15:00–00:30
  return {tw, other:us || uk};
}
let tickN = 0;
setInterval(() => {
  refreshGenText();   // 更新「幾分鐘前」
  if (document.hidden || LIVE.state === 'loading' || LIVE.state === 'off') return;
  tickN++;
  const o = marketsOpen();
  if (o.other && tickN % 5 === 0) liveRefresh();
  else if (o.tw) twTick();
}, 60000);
const customRows = {};   // 代碼 → 計算好的自訂項目
// 依個人清單組出表格資料：預設項目用預先算好的資料，自訂項目用瀏覽器算的資料
function rebuildRows() {
  DATA.rows = WL.items(BASE).map(it => {
    const src = it.source === 'default' ? baseByCode[it.代碼] : customRows[it.代碼];
    const row = src ? {...src} : {...it, custom:true, error:'載入中…'};
    return Object.assign(row, {名稱:it.名稱, 區:it.區, 類:it.類});
  });
  const n = WL.state().removed.length, rs = document.getElementById('restore');
  rs.style.display = n ? '' : 'none';
  rs.textContent = `還原已移除（${n}）`;
  render();
}
// 計算尚未載入的自訂項目
async function loadCustom() {
  rebuildRows();
  const todo = WL.items(BASE).filter(it => it.source === 'custom' && !customRows[it.代碼]);
  if (!todo.length) return;
  if (!await WL.proxy()) return amsg('尚未設定資料代理，自訂代碼無法載入', 'bad');
  amsg(`載入自訂代碼 ${todo.length} 檔…`);
  await Promise.all(todo.map(async it => {
    const r = await analyzeJS(it).catch(() => ({...it, custom:true, error:'查無資料'}));
    mergeMarket(r._m); delete r._m;
    customRows[it.代碼] = r;
  }));
  rebuildRows();
  amsg('');
}
WL.onChange(loadCustom);   // 「我的追蹤清單」頁修改後即時同步

document.getElementById('restore').onclick = () => { WL.restoreAll(); rebuildRows(); amsg('已還原預設清單', 'ok'); };
document.querySelector('#t tbody').addEventListener('click', e => {
  const code = e.target.dataset.rm; if (!code) return;
  const r = DATA.rows.find(x => x.代碼 === code);
  if (!confirm(`從你的清單移除 ${code} ${r ? r.名稱 : ''}？`)) return;
  WL.remove(code);
  S.picked = S.picked.filter(x => x !== code);
  rebuildRows(); amsg(`已移除 ${code}`, 'ok');
});

const spanEl = document.getElementById('span');
spanEl.max = MAX_SPAN; spanEl.value = S.span;
spanEl.addEventListener('input', () => { S.span = +spanEl.value; render(); });
const methodEl = document.getElementById('method');
methodEl.value = S.calc;
methodEl.addEventListener('change', () => { S.calc = methodEl.value; render(); });
const viewEl = document.getElementById('view');
viewEl.value = S.view;
viewEl.addEventListener('change', () => {
  S.view = viewEl.value; render();
  if (needLong() && LIVE.state === 'done' && !LIVE.long) liveRefresh();   // 近三年、近五年需要較長的資料
});
const cumEl = document.getElementById('optCum'), annEl = document.getElementById('optAnn'), ytdEl = document.getElementById('optYtd');
cumEl.checked = S.cum; annEl.checked = S.ann; ytdEl.checked = S.ytd;
[cumEl, annEl, ytdEl].forEach(el => el.addEventListener('change', () => {
  S.cum = cumEl.checked; S.ann = annEl.checked; S.ytd = ytdEl.checked; render();
  if (needLong() && LIVE.state === 'done' && !LIVE.long) liveRefresh();
}));
const decEl = document.getElementById('dec');
decEl.value = S.dec;
decEl.addEventListener('change', () => {
  S.dec = +decEl.value;
  // 數字欄勾選的值是依顯示文字比對，位數改變後失效，只保留最小／最大值條件
  for (const [k, f] of Object.entries(S.filters)) if (colByKey[k] && colByKey[k].num) delete f.vals;
  render();
});
document.addEventListener('click', closePop);
document.getElementById('q').addEventListener('input', body);
// 查詢選項的成立年度：寫入表頭「成立年度」欄的 ≥／≤ 篩選（兩處同步）
for (const [id, k] of [['sinceMin', 'min'], ['sinceMax', 'max']]) document.getElementById(id).addEventListener('input', e => {
  const v = e.target.value.trim(), f = {...(S.filters.since || {})};
  if (v === '' || isNaN(+v)) delete f[k]; else f[k] = +v;
  if (Object.keys(f).length) S.filters.since = f; else delete S.filters.since;
  render();
});
loadCustom();
liveRefresh();
// 手機 App 常放在背景：回到前景時若已超過 10 分鐘，重新抓最新價格
let hiddenSince = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenSince = Date.now();
  else if (hiddenSince && Date.now() - hiddenSince > 600000 && LIVE.state !== 'loading') liveRefresh();
});
