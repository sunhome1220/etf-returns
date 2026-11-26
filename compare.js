// 主動型比較頁：讀取排程產生的 compare.json（主動型 ETF、0050、台灣報酬指數的每日資料），
// 以同一段期間計算報酬、超額報酬、最大回撤、波動度並畫走勢圖；台股盤中以證交所即時報價更新最新價。
'use strict';
const ST_KEY = 'etf-compare';
const S = (() => { try { return JSON.parse(localStorage.getItem(ST_KEY)) || {}; } catch (e) { return {}; } })();
const save = () => { try { localStorage.setItem(ST_KEY, JSON.stringify(S)); } catch (e) {} };
const MAIN = (() => { try { return JSON.parse(localStorage.getItem('etf-state')) || {}; } catch (e) { return {}; } })();
S.per = S.per || 'ytd';
S.method = S.method || (MAIN.calc === 'tr' ? 'v' : 's');   // 預設跟主頁的算法
S.bench = S.bench || 'IR0001';
S.sort = S.sort || 'ex'; S.dir = S.dir || -1;
S.slots = S.slots || {};   // 代碼 → 圖上顏色（固定跟著標的，不因排序改變）
const DEC = MAIN.dec === 2 ? 2 : 1;
const MAX_LINES = 8, SLOTS = 8;

let D = null, dates = [], funds = [], active = [], IR = null, F0050 = null;
let LIVE = {at:0, irEst:false, closed:true};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---- 資料 ----
function prep(f) {   // 除息累計 cd[i - o]：o 到 i（含）的除息合計
  const cd = [], at = {};
  for (const [i, v] of f.d) at[i] = (at[i] || 0) + v;
  let acc = 0;
  for (let i = f.o; i < f.o + f.c.length; i++) { acc += at[i] || 0; cd.push(acc); }
  f.cd = cd;
}
const C = (f, i) => f.c[i - f.o], A = (f, i) => f.a[i - f.o], CD = (f, i) => f.cd[i - f.o];
const listedIn = f => f.since && f.since.length >= 10 && f.since >= dates[0];   // 上市日在資料範圍內
// 期間報酬（小數）：i 收盤 → j
function ret(f, i, j, m = S.method) {
  return m === 'v' ? A(f, j) / A(f, i) - 1 : (C(f, j) + CD(f, j) - CD(f, i)) / C(f, i) - 1;
}
function irRet(i, j) { return IR && i >= IR.o ? IR.v[j - IR.o] / IR.v[i - IR.o] - 1 : null; }
function benchRet(i, j) {
  if (S.bench === 'IR0001') return irRet(i, j);
  return F0050 && i >= F0050.o ? ret(F0050, i, j) : null;
}
// 最大回撤、波動度（與主頁風險指標同一套算法）
function mdd(f, s, n, m = S.method) {
  let worst = 0;
  if (m === 'v' || !f) {
    let peak = 0;
    for (let j = s; j <= n; j++) { const x = f ? A(f, j) : IR.v[j - IR.o]; peak = Math.max(peak, x); worst = Math.min(worst, x / peak - 1); }
  } else {
    for (let j = s; j <= n; j++) for (let i = s; i <= j; i++) worst = Math.min(worst, ret(f, i, j, 's'));
  }
  return worst;
}
function vol(f, s, n) {
  const rs = [];
  for (let i = s + 1; i <= n; i++) rs.push(f ? A(f, i) / A(f, i - 1) - 1 : IR.v[i - IR.o] / IR.v[i - 1 - IR.o] - 1);
  if (rs.length < 20) return null;
  const mu = rs.reduce((a, x) => a + x, 0) / rs.length;
  return Math.sqrt(rs.reduce((a, x) => a + (x - mu) ** 2, 0) / (rs.length - 1) * 252);
}
// 距 52 週高點／低點（與主頁相同，不隨上方期間變動）：近一年起點前已上市才算，否則「上市未滿」
function hilo(f, n) {
  const si = idxOnOrBefore(monthsBack(dates[n], 12));
  if (si < 0 || (f ? si < f.o : !IR || si < IR.o)) return {note:'上市未滿'};
  // 各天到現在的漲跌：最小值＝距高點（從高點跌了多少），最大值＝距低點（從低點漲了多少）
  let hi = Infinity, lo = -Infinity;
  for (let i = si; i <= n; i++) {
    const x = !f ? IR.v[n - IR.o] / IR.v[i - IR.o] - 1 : ret(f, i, n);
    hi = Math.min(hi, x); lo = Math.max(lo, x);
  }
  return {hi, lo};
}
// 起點：目標日或之前最後一個交易日（與主頁近期報酬率相同）
function idxOnOrBefore(t) { let lo = 0, hi = dates.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; }
function monthsBack(day, n) {
  const [y, m, d] = day.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 - n, 1));
  t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.toISOString().slice(0, 10);
}
function startIdx() {   // 共同起點；-1＝各自上市以來
  const end = dates[dates.length - 1];
  const t = S.per === 'ytd' ? `${+end.slice(0, 4) - 1}-12-31` : S.per === 'custom' ? (S.from || end)
    : S.per === 'list' ? null : monthsBack(end, {m1:1, m3:3, m6:6, y1:12}[S.per]);
  if (t == null) return -1;
  return Math.max(0, idxOnOrBefore(t));
}

// 淨值與折溢價（現價 ÷ 淨值 − 1）：排程時的證交所預估淨值，盤中經資料代理 /etfnav 更新
function navOf(f) {
  const price = f.c[f.c.length - 1], nav = f.nav;
  return {nav, price, PREM:nav && nav.v && price ? price / nav.v - 1 : null};
}
function parseNav(j) {   // 與 build.py parse_etf_nav 相同：逐層找有 a（代碼）與 f（預估淨值）的物件
  const out = {}, num = x => { const v = parseFloat(String(x ?? '').replace(/,/g, '')); return v > 0 ? v : null; };
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if ('a' in o && 'f' in o && typeof o.a !== 'object') {
      const nav = num(o.f), prev = num(o.h);
      if (nav || prev) out[String(o.a).trim()] = {v:nav || prev, prev, d:o.i || '', t:o.j || ''};
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(j);
  return out;
}

// ---- 計算每一列 ----
function rows() {
  const n = dates.length - 1, s0 = startIdx(), out = [];
  for (const f of active) {
    const lateList = listedIn(f) || f.o > 0 ? f.o : null;   // 上市日在資料範圍內才有「上市以來」
    let s = s0 < 0 ? lateList : Math.max(s0, f.o), late = s0 >= 0 && f.o > s0;
    const r = {f, code:f.代碼, name:f.名稱, since:f.since, s, late, ...navOf(f)};
    if (s == null || s >= n) { r.na = s == null ? '資料不足' : '上市未滿'; out.push(r); continue; }
    r.R = ret(f, s, n); r.B = benchRet(s, n); r.EX = r.B == null ? null : r.R - r.B;
    r.MDD = mdd(f, s, n); r.VOL = vol(f, s, n); r.RD = r.MDD < -0.005 ? r.R / -r.MDD : null;
    r.HL = hilo(f, n);
    if (lateList != null && lateList < n) {
      r.L = ret(f, lateList, n);
      const yrs = (Date.parse(dates[n]) - Date.parse(dates[lateList])) / 864e5 / 365.25;
      r.LA = yrs >= 1 ? Math.pow(1 + r.L, 1 / yrs) - 1 : null; r.LAnote = yrs >= 1 ? '' : '未滿一年';
    }
    out.push(r);
  }
  return {list:out, s0, n};
}
function benchRows(s0, n) {   // 表格最上方的基準列（從共同起點起算；各自上市以來時從資料第一天）
  const s = Math.max(0, s0), out = [];
  if (F0050 && s >= F0050.o && s < n) {
    const R = ret(F0050, s, n), M = mdd(F0050, s, n);
    out.push({bench:true, code:'0050', name:F0050.名稱, ...navOf(F0050), s, R, MDD:M, VOL:vol(F0050, s, n), RD:M < -0.005 ? R / -M : null, HL:hilo(F0050, n)});
  }
  if (IR && s >= IR.o && s < n) {
    const R = irRet(s, n), M = mdd(null, s, n, 'v');
    out.push({bench:true, code:'IR0001', name:IR.名稱 + (LIVE.irEst ? '≈' : ''), s, R, MDD:M, VOL:vol(null, s, n), RD:M < -0.005 ? R / -M : null, HL:hilo(null, n)});
  }
  return out;
}

// ---- 表格 ----
const pct = x => x == null ? '' : `<span class="${x < 0 ? 'neg' : 'pos'}">${(x * 100).toFixed(DEC)}%</span>`;
const plain = x => x == null ? '' : (x * 100).toFixed(DEC) + '%';
const COLS = [
  {k:'name', label:'名稱', cls:'stk', val:r => r.code},
  {k:'nav', label:'淨值', mh:true, val:r => r.nav && r.nav.v},
  {k:'prem', label:'折溢價', val:r => r.PREM},
  {k:'since', label:'上市日', mh:true, val:r => r.since || ''},
  {k:'s', label:'起點', mh:true, val:r => r.s ?? -1},
  {k:'R', label:'期間<br>報酬', val:r => r.R},
  {k:'B', label:'基準<br>同期', val:r => r.B},
  {k:'ex', label:'超額<br>報酬', val:r => r.EX},
  {k:'MDD', label:'最大<br>回撤', val:r => r.MDD},
  {k:'VOL', label:'波動度<br>(年化)', mh:true, val:r => r.VOL},
  {k:'RD', label:'報酬<br>回撤比', val:r => r.RD},
  {k:'hi52', label:'距52週<br>高點', val:r => r.HL && r.HL.hi},
  {k:'lo52', label:'距52週<br>低點', val:r => r.HL && r.HL.lo},
  {k:'L', label:'上市<br>以來', val:r => r.L},
  {k:'LA', label:'上市以來<br>年化', mh:true, val:r => r.LA},
];
function cell(c, r) {
  const mh = c.mh ? ' mh' : '', srt = S.sort === c.k ? ' sorted' : '';
  switch (c.k) {
    case 'name': {
      const on = (S.chart || []).includes(r.code);
      const sw = r.bench ? '' : `<input type="checkbox" data-chart="${esc(r.code)}" ${on ? 'checked' : ''} title="顯示在走勢圖">` +
        `<span class="sw" style="background:${on ? colorOf(r.code) : 'transparent'}"></span> `;
      return `<td class="stk${srt}">${sw}<span class="code">${esc(r.code)}</span>${esc(r.name)}</td>`;
    }
    case 'nav': {
      const t = r.nav ? `${r.nav.d ? r.nav.d.replace(/(\d{4})(\d\d)(\d\d)/, '$1/$2/$3') + ' ' + r.nav.t + ' ' : ''}預估淨值；現價 ${r.price}${r.nav.prev ? `；前一營業日淨值 ${r.nav.prev}` : ''}` : '';
      return `<td class="r${mh}${srt}"${t ? ` title="${esc(t)}"` : ''}>${r.nav ? r.nav.v.toFixed(2) : ''}</td>`;
    }
    case 'prem': return `<td class="r${srt}"${r.PREM == null ? '' : ' title="正＝溢價（市價高於淨值），負＝折價"'}>${pct(r.PREM)}</td>`;
    case 'since': return `<td class="c${mh}${srt}">${r.bench ? '' : esc((r.since || '').slice(0, 10))}</td>`;
    case 's': return `<td class="c${mh}${srt}">${r.s == null ? '' : r.late ? `<span title="比起點晚上市，從上市首日起算">${dates[r.s].slice(5)}*</span>` : dates[r.s].slice(5)}</td>`;
    case 'R': return `<td class="r${srt}">${r.na ? `<span class="note">${r.na}</span>` : pct(r.R)}</td>`;
    case 'B': return `<td class="r${srt}">${r.bench ? '<span class="note">基準</span>' : pct(r.B)}</td>`;
    case 'ex': return `<td class="r${srt}">${r.bench ? '' : pct(r.EX)}</td>`;
    case 'MDD': return `<td class="r${srt}">${pct(r.MDD)}</td>`;
    case 'VOL': return `<td class="r${mh}${srt}">${plain(r.VOL)}</td>`;
    case 'hi52': case 'lo52': {
      const x = r.HL && (c.k === 'hi52' ? r.HL.hi : r.HL.lo);
      return `<td class="r${srt}">${r.HL && r.HL.note ? `<span class="note">${r.HL.note}</span>` : pct(x)}</td>`;
    }
    case 'RD': return `<td class="r${srt}">${r.RD == null ? '' : r.RD.toFixed(2)}</td>`;
    case 'L': return `<td class="r${srt}">${r.bench ? '' : pct(r.L)}</td>`;
    case 'LA': return `<td class="r${mh}${srt}">${r.bench ? '' : r.LAnote ? `<span class="note">${r.LAnote}</span>` : pct(r.LA)}</td>`;
  }
}
function renderTable(list, brs) {
  const c = COLS.find(x => x.k === S.sort) || COLS[5];
  const sorted = [...list].sort((a, b) => {
    const x = c.val(a), y = c.val(b);
    if (x == null || x === '') return 1; if (y == null || y === '') return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * S.dir;
  });
  $('t').tHead.innerHTML = '<tr>' + COLS.map(x => `<th class="${x.cls || ''}${x.mh ? ' mh' : ''}${S.sort === x.k ? ' on' : ''}" data-k="${x.k}">${x.label}` +
    `<span class="s">${S.sort === x.k ? (S.dir < 0 ? '▼' : '▲') : '⇅'}</span></th>`).join('') + '</tr>';
  $('t').tBodies[0].innerHTML = [...brs, ...sorted].map(r => `<tr class="${r.bench ? 'bench' : ''}">${COLS.map(x => cell(x, r)).join('')}</tr>`).join('');
}

// ---- 走勢圖 ----
function colorOf(code) { return `var(--s${(S.slots[code] ?? 0) + 1})`; }
function assignSlots() {
  const used = new Set();
  for (const k of Object.keys(S.slots)) if (!S.chart.includes(k)) delete S.slots[k]; else used.add(S.slots[k]);
  for (const k of S.chart) if (S.slots[k] == null) { let i = 0; while (used.has(i)) i++; S.slots[k] = i; used.add(i); }
}
function renderChart(list, s0, n) {
  const svg = $('svg'), W = svg.clientWidth || 600, H = svg.clientHeight || 300;
  const ML = 44, MR = 10, MT = 8, MB = 22;
  const byCode = Object.fromEntries(list.map(r => [r.code, r]));
  const sel = S.chart.map(k => byCode[k]).filter(r => r && !r.na && r.s != null);
  const bs = s0 >= 0 ? s0 : Math.min(...sel.map(r => r.s), n - 1);
  const series = sel.map(r => ({code:r.code, name:r.name, color:colorOf(r.code), s:r.s, ys:[]}));
  const bn = S.bench === 'IR0001' ? (IR ? IR.名稱 : '') : '0050';
  const bench = {code:'bench', name:bn + '（基準）', color:'var(--bench)', s:bs, ys:[], bench:true};
  for (let j = bs; j <= n; j++) { const b = benchRet(bs, j); bench.ys.push(b == null ? null : 100 * (1 + b)); }
  // 比起點晚上市的：從上市當天基準線的高度起畫，線在基準上方＝上市以來贏過基準
  for (const sr of series) {
    const f = byCode[sr.code].f, b0 = sr.s > bs ? bench.ys[sr.s - bs] ?? 100 : 100;
    for (let j = sr.s; j <= n; j++) sr.ys.push(b0 * (1 + ret(f, sr.s, j)));
  }
  const all = [...series, ...(bench.ys.some(v => v != null) ? [bench] : [])];
  const vals = all.flatMap(sr => sr.ys).filter(v => v != null);
  if (!vals.length || n - bs < 1) { svg.innerHTML = ''; $('legend').innerHTML = ''; return; }
  let lo = Math.min(...vals, 100), hi = Math.max(...vals, 100);
  const span = hi - lo || 1, raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const X = i => ML + (i - bs) / (n - bs) * (W - ML - MR), Y = v => MT + (hi - v) / (hi - lo) * (H - MT - MB);
  let g = '<g class="grid">';
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${ML}" x2="${W - MR}" y1="${Y(v)}" y2="${Y(v)}"/>`;
  g += '</g><g class="ax">';
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<text x="${ML - 6}" y="${Y(v) + 4}" text-anchor="end">${+v.toFixed(2)}</text>`;
  // x 軸：每月第一個交易日；和前一個標籤太近就略過（第一個標籤寫年份）
  let lastX = -1e9, first = true;
  for (let i = bs + 1; i <= n; i++) {
    if (dates[i].slice(0, 7) === dates[i - 1].slice(0, 7) || X(i) - lastX < 52 || X(i) > W - MR - 16) continue;
    const [y, m] = dates[i].split('-').map(Number);
    g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${first || m === 1 ? `${y}/${m}` : `${m}月`}</text>`;
    lastX = X(i); first = false;
  }
  g += `</g><line class="base" x1="${ML}" x2="${W - MR}" y1="${Y(100)}" y2="${Y(100)}"/>`;
  const path = sr => { let d = '', pen = false; sr.ys.forEach((v, k) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(sr.s + k).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }); return d; };
  // 基準先畫（在下層），各檔依序畫上
  g += [...all].reverse().map(sr => `<path class="ln${sr.bench ? ' bench' : ''}" d="${path(sr)}" style="stroke:${sr.color}"/>`).join('');
  g += '<g id="hover" style="display:none"><line class="cross" id="cross" y1="' + MT + '" y2="' + (H - MB) + '"/><g id="dots"></g></g>';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;
  $('legend').innerHTML = all.map(sr => {
    const last = sr.ys[sr.ys.length - 1];
    return `<span class="it" data-rm="${sr.bench ? '' : esc(sr.code)}" title="${sr.bench ? '' : '點一下從圖上移除'}"><span class="sw${sr.bench ? ' dash' : ''}" style="background:${sr.color}"></span>${esc(sr.name)} ${last == null ? '' : plain(last / sr.ys[0] - 1)}</span>`;
  }).join('');
  $('chartSub').textContent = `（起點設為 100，${s0 >= 0 ? dates[s0] + ' 收盤起' : '各自上市首日起'}）`;
  // 滑鼠／手指移動：十字線與各線數值
  const hover = $('hover'), tip = $('tip');
  const move = e => {
    const rc = svg.getBoundingClientRect(), px = (e.clientX - rc.left) * W / rc.width;
    const i = Math.round(bs + (px - ML) / (W - ML - MR) * (n - bs));
    if (i < bs || i > n) { hover.style.display = 'none'; tip.style.display = 'none'; return; }
    const x = X(i), pts = all.map(sr => ({sr, v:i >= sr.s ? sr.ys[i - sr.s] : null})).filter(p => p.v != null).sort((a, b) => b.v - a.v);
    $('cross').setAttribute('x1', x); $('cross').setAttribute('x2', x);
    $('dots').innerHTML = pts.map(p => `<circle class="dot" cx="${x}" cy="${Y(p.v)}" r="4" style="fill:${p.sr.color}"/>`).join('');
    hover.style.display = '';
    tip.innerHTML = `<b>${dates[i]}</b>` + pts.map(p => `<div><span class="sw${p.sr.bench ? ' dash' : ''}" style="background:${p.sr.color}"></span>${esc(p.sr.name)}<span class="v">${plain(p.v / p.sr.ys[0] - 1)}</span></div>`).join('');
    tip.style.display = 'block';
    const box = svg.parentElement.getBoundingClientRect(), tw = tip.offsetWidth, cx = e.clientX - box.left;
    tip.style.left = (cx + 14 + tw > box.width ? Math.max(4, cx - 14 - tw) : cx + 14) + 'px';
    tip.style.top = (svg.offsetTop + 8) + 'px';
  };
  svg.onpointermove = svg.onpointerdown = move;
  svg.onpointerleave = () => { hover.style.display = 'none'; tip.style.display = 'none'; };
}

// ---- 畫面 ----
function render() {
  if (!D) return;
  $('per').value = S.per; $('method').value = S.method; $('bench').value = S.bench;
  $('from').style.display = S.per === 'custom' ? '' : 'none';
  $('from').min = dates[0]; $('from').max = dates[dates.length - 1];
  if (S.per === 'custom' && !S.from) S.from = dates[Math.max(0, dates.length - 61)];
  $('from').value = S.from || '';
  const {list, s0, n} = rows();
  if (!S.chart) S.chart = list.filter(r => r.EX != null).sort((a, b) => b.EX - a.EX).slice(0, 5).map(r => r.code);   // 預設：超額報酬前 5 名
  assignSlots();
  renderTable(list, benchRows(s0, n));
  renderChart(list, s0, n);
  $('info').textContent = (s0 >= 0 ? `${dates[s0]} 收盤 → ${dates[n]}（${n - s0} 個交易日）` : `各自上市首日 → ${dates[n]}`) +
    `・${active.length} 檔主動型` + (S.per === 'custom' && S.from < dates[0] ? `・資料從 ${dates[0]} 起` : '');
  const tm = LIVE.at ? `　即時價格更新於 ${new Date(LIVE.at + 8 * 3600e3).toISOString().slice(11, 16)}` : '';
  $('foot').textContent = `資料時間：台股 ${dates[n]}${LIVE.at ? (LIVE.closed ? ' 收盤' : ' 盤中') : ''}　排程更新於 ${D.updated}（台北時間）${tm}` +
    (LIVE.irEst ? '　報酬指數為依加權指數漲跌估算（≈）' : '');
  save();
}

// ---- 即時報價（證交所，經資料代理 /mis/）----
async function proxy() {
  const t = await fetch('proxy.txt', {cache:'no-cache'}).then(r => r.ok ? r.text() : '').catch(() => '');
  return t.trim().replace(/\/$/, '');
}
async function mis(px, codes) {
  const out = {};
  for (let i = 0; i < codes.length; i += 30) {
    const j = await fetch(`${px}/mis/${codes.slice(i, i + 30).join(',')}`).then(r => r.ok ? r.json() : null).catch(() => null);
    for (const q of (j && j.msgArray) || []) {
      const num = v => { const x = parseFloat(v); return x > 0 ? x : null; };
      const price = num(q.z) ?? num((q.b || '').split('_')[0]);
      if (!price || !q.d) continue;
      out[q.c] = {price, prev:num(q.y), day:`${q.d.slice(0, 4)}-${q.d.slice(4, 6)}-${q.d.slice(6, 8)}`, closed:(q.t || '') >= '13:30'};
    }
  }
  return out;
}
async function live() {
  const px = await proxy();
  if (!px || !D) return;
  const [q, tq, nj] = await Promise.all([mis(px, funds.map(f => f.代碼)), mis(px, ['t00']),
    fetch(`${px}/etfnav`).then(r => r.ok ? r.text() : '').then(x => x ? JSON.parse(x.replace(/^\uFEFF/, '')) : null).catch(() => null)]);
  const t = tq.t00, navs = parseNav(nj);
  for (const f of funds) if (navs[f.代碼]) f.nav = navs[f.代碼];
  const qs = Object.values(q);
  if (!qs.length) { if (Object.keys(navs).length) render(); return; }
  const day = qs.map(x => x.day).sort().pop();
  if (day > dates[dates.length - 1]) {   // 新的一天：每檔先沿用前一天，有報價的再換成最新價
    dates.push(day);
    for (const f of funds) { f.c.push(f.c[f.c.length - 1]); f.a.push(f.a[f.a.length - 1]); f.cd.push(f.cd[f.cd.length - 1]); f.isNew = true; }
    if (IR) { const v = IR.v[IR.v.length - 1]; IR.v.push(t && t.prev && t.day === day ? v * t.price / t.prev : v); LIVE.irEst = !!(t && t.prev && t.day === day); }
  }
  const last = dates.length - 1;
  for (const f of funds) {
    const x = q[f.代碼];
    if (!x || x.day !== dates[last] || last < f.o) continue;
    const k = last - f.o;
    if (f.isNew && k > 0) { f.a[k] = f.a[k - 1] * x.price / f.c[k - 1]; f.c[k] = x.price; }
    else { f.a[k] *= x.price / f.c[k]; f.c[k] = x.price; }
  }
  for (const f of funds) delete f.isNew;
  if (IR && LIVE.irEst && t && t.day === dates[last]) {   // 盤中更新估算的報酬指數
    const k = last - IR.o; if (k > 0) IR.v[k] = IR.v[k - 1] * t.price / t.prev;
  }
  LIVE.at = Date.now(); LIVE.closed = qs.every(x => x.closed);
  render();
}
function twOpen() {
  const d = new Date(Date.now() + 8 * 3600e3), wd = d.getUTCDay(), hm = d.getUTCHours() * 60 + d.getUTCMinutes();
  return wd >= 1 && wd <= 5 && hm >= 540 && hm <= 815;
}

// ---- 事件 ----
$('per').onchange = e => { S.per = e.target.value; render(); };
$('from').onchange = e => { S.from = e.target.value; render(); };
$('method').onchange = e => { S.method = e.target.value; render(); };
$('bench').onchange = e => { S.bench = e.target.value; render(); };
$('t').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (!th) return;
  const k = th.dataset.k;
  if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = ['name', 'since', 's'].includes(k) ? 1 : -1; }
  render();
});
$('t').addEventListener('change', e => {
  const k = e.target.dataset.chart; if (!k) return;
  if (e.target.checked) {
    if (S.chart.length >= MAX_LINES) { e.target.checked = false; alert(`走勢圖最多 ${MAX_LINES} 檔，請先取消其他檔`); return; }
    S.chart.push(k);
  } else S.chart = S.chart.filter(x => x !== k);
  render();
});
$('legend').addEventListener('click', e => {
  const it = e.target.closest('[data-rm]'); if (!it || !it.dataset.rm) return;
  S.chart = S.chart.filter(x => x !== it.dataset.rm); render();
});
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });

(async () => {
  D = await fetch('compare.json', {cache:'no-cache'}).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!D) { $('info').textContent = '資料尚未產生，請稍後再試'; return; }
  dates = D.dates; funds = D.funds; funds.forEach(prep);
  active = funds.filter(f => f.類 === '主動');
  F0050 = funds.find(f => f.代碼 === '0050') || null;
  IR = D.bench && D.bench.IR0001 || null;
  if (S.chart) S.chart = S.chart.filter(k => active.some(f => f.代碼 === k));
  render();
  live();
  setInterval(() => { if (!document.hidden && twOpen()) live(); }, 60000);
})();
