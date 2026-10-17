'use strict';
// 拼接大螢幕：多支手機/平板組成一個大畫面。
// 連線方式：PeerJS（WebRTC），房間代碼即管理者的 peer id。第一個搶到該 id 的人就是管理者。
// 同步後：每台裝置都保有內容、自己在大畫面中的位置與時鐘差，因此斷網後仍能依時間各自算出畫面，跑馬燈保持接續。

const PREFIX = 'pwall-v1-';
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- 共用狀態 ----------
let role = null;           // 'manager' | 'client'
let room = '';
let peer = null;
let content = null;        // 顯示內容（含 t0：管理者時鐘的起始時間）
let view = null;           // 本機在大畫面中的位置 {slot:{x,y,w,h}, box:{x,y,w,h}, index, total, identify}
let offset = 0;            // 管理者時鐘 - 本機時鐘（毫秒）
let connected = false;
let img = null, imgSrc = null;

const deviceId = (() => {
  let id = store.get('pwall-dev');
  if (!id) { id = Math.random().toString(36).slice(2, 10); store.set('pwall-dev', id); }
  return id;
})();

function deviceName() {
  const ua = navigator.userAgent;
  const short = Math.min(screen.width, screen.height);
  const tablet = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || short >= 600;
  let brand = /iPhone|iPad|Macintosh/.test(ua) ? 'Apple' : /Android/.test(ua) ? 'Android' : '電腦';
  if (brand === '電腦' && navigator.maxTouchPoints > 1) brand = '';
  return (brand + ' ' + (tablet ? '平板' : '手機')).trim();
}
function mySize() { return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 }; }

// ---------- 繪圖 ----------
const canvas = $('wall');
const ctx = canvas.getContext('2d');
let fontStack = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';

function loadImage(src) {
  if (src === imgSrc) return;
  imgSrc = src; img = null;
  if (!src) return;
  const im = new Image();
  im.onload = () => { if (imgSrc === src) img = im; };
  im.src = src;
}

// 在虛擬座標（整個大畫面）中繪製內容；B = 大畫面範圍，now = 管理者時鐘
function drawContent(c, B, now, g, image) {
  g.fillStyle = c.bg || '#000';
  g.fillRect(B.x, B.y, B.w, B.h);
  if (c.type === 'image') {
    if (!image) return;
    let w = image.naturalWidth, h = image.naturalHeight, dw, dh;
    if (c.fit === 'fill') { dw = B.w; dh = B.h; }
    else {
      const s = c.fit === 'cover' ? Math.max(B.w / w, B.h / h) : Math.min(B.w / w, B.h / h);
      dw = w * s; dh = h * s;
    }
    g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
    g.drawImage(image, B.x + (B.w - dw) / 2, B.y + (B.h - dh) / 2, dw, dh);
    g.restore();
    return;
  }
  const weight = c.bold ? '700 ' : '400 ';
  const sizeK = (c.size || 100) / 100;
  g.fillStyle = c.color || '#fff';
  g.textBaseline = 'middle';
  g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
  if (c.mode === 'marquee') {
    const txt = (c.text || '').replace(/\s*\n\s*/g, '   ');
    const fs = B.h * 0.78 * sizeK;
    g.font = weight + fs + 'px ' + fontStack;
    g.textAlign = 'left';
    const tw = g.measureText(txt).width;
    const v = (c.speed || 6) * fs * 0.12;               // 每秒移動的虛擬像素
    const span = B.w + tw;
    const d = (((now - c.t0) / 1000 * v) % span + span) % span;
    g.fillText(txt, B.x + B.w - d, B.y + B.h / 2);
  } else {
    const lines = (c.text || '').split('\n');
    g.font = weight + '100px ' + fontStack;
    let maxW = 1;
    for (const l of lines) maxW = Math.max(maxW, g.measureText(l).width);
    const fs = Math.min(B.h * 0.85 / lines.length / 1.15, B.w * 0.92 / maxW * 100) * sizeK;
    g.font = weight + fs + 'px ' + fontStack;
    g.textAlign = 'center';
    const lh = fs * 1.15, y0 = B.y + B.h / 2 - lh * (lines.length - 1) / 2;
    lines.forEach((l, i) => g.fillText(l, B.x + B.w / 2, y0 + i * lh));
  }
  g.restore();
}

function drawIdentify(g, v, k) {
  const s = v.slot;
  g.strokeStyle = '#2f6fd6'; g.lineWidth = 6 / k;
  g.strokeRect(s.x + 3 / k, s.y + 3 / k, s.w - 6 / k, s.h - 6 / k);
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(s.x, s.y + s.h / 2 - s.h * 0.22, s.w, s.h * 0.44);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const fs = Math.min(s.w, s.h) * 0.4;
  g.font = '700 ' + fs + 'px ' + fontStack;
  g.fillText(String(v.index + 1), s.x + s.w / 2, s.y + s.h / 2 - fs * 0.12);
  g.font = '400 ' + fs * 0.18 + 'px ' + fontStack;
  g.fillText('第 ' + (v.index + 1) + ' / ' + v.total + ' 台', s.x + s.w / 2, s.y + s.h / 2 + fs * 0.42);
}

let wallVisible = false;
function frame() {
  requestAnimationFrame(frame);
  if (!wallVisible) return;
  const cw = window.innerWidth, ch = window.innerHeight, dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = (content && content.bg) || '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!content || !view) return;
  const s = view.slot;
  const k = Math.min(cw / s.w, ch / s.h);   // 本機 CSS px / 虛擬 px
  ctx.setTransform(dpr * k, 0, 0, dpr * k, -s.x * dpr * k, -s.y * dpr * k);
  drawContent(content, view.box, Date.now() + offset, ctx, img);
  if (view.identify) drawIdentify(ctx, view, k);
}
requestAnimationFrame(frame);

function showWall(on) {
  wallVisible = on;
  updateWait();
}
function updateWait() {
  const w = $('waitMsg');
  if (!wallVisible || (content && view)) { w.classList.add('hidden'); return; }
  w.classList.remove('hidden');
  w.innerHTML = '房間 <b>' + room + '</b><br>' + (connected ? '已連線，等待管理者送出內容…' : '連線中…') +
    '<br><br><span style="font-size:13px">點一下畫面可進入全螢幕</span>';
}

let statusTimer = 0;
function setStatus(text, sticky) {
  const el = $('status');
  el.textContent = text;
  el.classList.remove('hidden', 'fade');
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => el.classList.add('fade'), 3000);
}

// 全螢幕 + 螢幕常亮
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wallVisible) keepAwake(); });
canvas.addEventListener('click', () => {
  keepAwake();
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else if (!document.webkitFullscreenElement && el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  if (content && view) setStatus(statusText());
});

// ---------- 進入 ----------
const params = new URLSearchParams(location.search);
$('roomInput').value = (params.get('room') || store.get('pwall-room') || randomRoom()).toUpperCase();
function randomRoom() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

$('joinBtn').onclick = () => {
  const r = $('roomInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r) { $('joinMsg').textContent = '請輸入房間代碼'; return; }
  room = r;
  store.set('pwall-room', room);
  history.replaceState(null, '', location.pathname + '?room=' + room);
  $('joinBtn').disabled = true;
  $('joinMsg').textContent = '連線中…';
  keepAwake();
  tryClaim(0);
};

const peerOpts = { debug: 0 };

// 先嘗試取得房間 id → 成功即為管理者；已被占用 → 以一般裝置身分連入
function tryClaim(attempt) {
  if (!navigator.onLine) return startOffline();
  const p = new Peer(PREFIX + room, peerOpts);
  let done = false;
  p.on('open', () => { done = true; peer = p; startManager(); });
  p.on('error', e => {
    if (done) return;
    done = true;
    p.destroy();
    if (e.type === 'unavailable-id') startClient();
    else if (attempt < 2) setTimeout(() => tryClaim(attempt + 1), 1500);
    else startOffline();
  });
}

// 網路不通但先前同步過 → 直接依存檔播放
function startOffline() {
  const saved = store.get('pwall-client');
  if (saved && saved.room === room && saved.content && saved.view) {
    role = 'client';
    enterClientUI(saved);
    setStatus('離線運作中', false);
    retryLater();
  } else {
    $('joinBtn').disabled = false;
    $('joinMsg').textContent = '無法連線，請確認網路後再試。';
  }
}
function retryLater() { setTimeout(() => { if (!peer || peer.destroyed) startClient(); }, 8000); }

// ---------- 顯示端 ----------
let mConn = null, pingTimer = 0, samples = [], everSynced = false, reconnectTimer = 0;

function enterClientUI(saved) {
  $('join').classList.add('hidden');
  if (saved) {
    content = saved.content; view = saved.view; offset = saved.offset || 0;
    if (content.type === 'image') loadImage(content.image);
    everSynced = true;
  }
  showWall(true);
}

function saveClient() {
  if (role !== 'client') return;
  store.set('pwall-client', { room, content, view, offset });
}

function statusText() {
  return connected ? '● 已同步（第 ' + (view ? view.index + 1 : '?') + ' 台）' : '○ 離線運作中';
}

function startClient() {
  role = 'client';
  if (!wallVisible) {
    const saved = store.get('pwall-client');
    enterClientUI(saved && saved.room === room && saved.content && saved.view ? saved : null);
  }
  if (peer && !peer.destroyed) peer.destroy();
  peer = new Peer(peerOpts);
  peer.on('open', connectManager);
  peer.on('disconnected', () => { setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 3000); });
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') {
      // 房間沒有管理者：從未同步過的話自己來當管理者
      if (!everSynced) { peer.destroy(); peer = null; setTimeout(() => tryClaim(0), 1500); return; }
      scheduleReconnect();
    } else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') {
      scheduleReconnect();
    }
  });
  updateWait();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (connected) return;
    if (!peer || peer.destroyed) return startClient();
    if (peer.disconnected) { peer.reconnect(); scheduleReconnect(); return; }
    connectManager();
  }, 5000);
}

function connectManager() {
  if (mConn) { try { mConn.close(); } catch (e) {} }
  const c = peer.connect(PREFIX + room, { reliable: true });
  mConn = c;
  c.on('open', () => {
    connected = true;
    samples = []; lastPong = Date.now();
    c.send({ t: 'hello', dev: deviceId, name: deviceName(), ...mySize() });
    ping(); setTimeout(ping, 300); setTimeout(ping, 700); setTimeout(ping, 1200);
    clearInterval(pingTimer); pingTimer = setInterval(ping, 20000);
    setStatus(statusText());
    updateWait();
  });
  c.on('data', onManagerData);
  c.on('close', lost);
  c.on('error', lost);
  function lost() {
    if (mConn !== c) return;
    connected = false;
    clearInterval(pingTimer);
    setStatus(statusText(), false);
    updateWait();
    scheduleReconnect();
  }
}

let lastPong = 0;
function ping() {
  if (!mConn || !mConn.open) return;
  if (connected && lastPong && Date.now() - lastPong > 50000) { try { mConn.close(); } catch (e) {} return; }
  mConn.send({ t: 'ping', a: Date.now() });
}

function onManagerData(m) {
  if (m.t === 'pong') {
    const now = Date.now(), rtt = now - m.a;
    lastPong = now;
    samples.push({ rtt, off: m.m - (m.a + now) / 2 });
    if (samples.length > 12) samples.shift();
    offset = samples.reduce((b, s) => (s.rtt < b.rtt ? s : b)).off;
    saveClient();
  } else if (m.t === 'content') {
    content = m.c;
    if (content.type === 'image') loadImage(content.image);
    everSynced = !!view;
    saveClient(); updateWait();
  } else if (m.t === 'view') {
    view = m.v;
    everSynced = !!content;
    saveClient(); updateWait();
    if (content) setStatus(statusText());
  }
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (role === 'client' && mConn && mConn.open) mConn.send({ t: 'size', ...mySize() });
    if (role === 'manager' && selfShow) relayout();
  }, 400);
});

// ---------- 管理者 ----------
const devices = new Map();   // dev -> {dev, name, w, h, scale, conn}
let order = [];              // 裝置順序（dev id）
let selfShow = false;
let layoutResult = null;
let draft = null;            // 面板上目前設定（尚未送出時也能預覽）
let identify = false;

function startManager() {
  role = 'manager';
  showWall(false);
  $('join').classList.add('hidden');
  $('panel').classList.remove('hidden');
  $('roomLabel').textContent = room;
  const link = location.origin + location.pathname + '?room=' + room;
  $('link').value = link;
  if (navigator.share) $('shareBtn').classList.remove('hidden');
  $('netState').textContent = '● 已連線';

  const saved = store.get('pwall-manager');
  if (saved && saved.content) {
    content = saved.content; content.t0 = Date.now();
    applyToForm(content);
  } else {
    content = readForm();
  }
  if (saved && saved.layout) {
    $('rows').value = '0';
    $('autoSort').checked = saved.layout.autoSort !== false;
    $('gap').value = saved.layout.gap || 0;
  }
  loadImage(content.image);
  draft = readForm();

  peer.on('connection', conn => {
    conn.on('data', m => onClientData(conn, m));
    conn.on('close', () => dropConn(conn));
    conn.on('error', () => dropConn(conn));
  });
  peer.on('disconnected', () => {
    $('netState').textContent = '○ 與伺服器斷線，重新連線中…（已連線的裝置不受影響）';
    const retry = () => { if (peer.destroyed) return; if (peer.disconnected) { peer.reconnect(); setTimeout(retry, 5000); } };
    setTimeout(retry, 2000);
  });
  peer.on('open', () => { $('netState').textContent = '● 已連線'; });
  peer.on('error', () => {});
  relayout();
  requestAnimationFrame(previewLoop);
}

function onClientData(conn, m) {
  if (m.t === 'ping') { conn.send({ t: 'pong', a: m.a, m: Date.now() }); return; }
  if (m.t === 'hello') {
    let d = devices.get(m.dev);
    if (!d) {
      const prevScale = (store.get('pwall-scales') || {})[m.dev];
      d = { dev: m.dev, scale: prevScale || 100 };
      devices.set(m.dev, d);
    }
    if (d.conn && d.conn !== conn) { try { d.conn.close(); } catch (e) {} }
    Object.assign(d, { name: m.name, w: m.w, h: m.h, dpr: m.dpr, conn });
    conn._dev = m.dev;
    if (!order.includes(m.dev)) order.push(m.dev);
    conn.send({ t: 'content', c: content });
    relayout();
  } else if (m.t === 'size') {
    const d = devices.get(conn._dev);
    if (d) { Object.assign(d, { w: m.w, h: m.h, dpr: m.dpr }); relayout(); }
  }
}

function dropConn(conn) {
  const d = devices.get(conn._dev);
  if (!d || d.conn !== conn) return;
  devices.delete(d.dev);
  order = order.filter(x => x !== d.dev);
  relayout();
}

// 版面計算：每台裝置以 (畫面寬, 高) × 校正% 為虛擬尺寸，分成數列排成接近矩形的大畫面
function computeLayout(list, forcedRows, gap, autoSort) {
  const n = list.length;
  if (!n) return null;
  const items = list.map(d => ({ id: d.id, w: d.w * d.scale / 100, h: d.h * d.scale / 100 }));
  const sorted = autoSort ? [...items].sort((a, b) => b.h - a.h || b.w - a.w) : items;
  const totalW = items.reduce((s, d) => s + d.w, 0);
  const candidates = [];
  const rowRange = forcedRows ? [Math.min(forcedRows, n)] : Array.from({ length: n }, (_, i) => i + 1);
  for (const r of rowRange) {
    // 依序切成 r 列，每列寬度盡量接近平均
    const rows = [];
    let cur = [], acc = 0;
    const target = totalW / r;
    sorted.forEach((d, i) => {
      const left = n - i, rowsLeft = r - rows.length - 1;   // 含本台尚未放的數量、本列之後還要開的列數
      if (cur.length && rowsLeft > 0 && (acc + d.w / 2 > target || left <= rowsLeft)) {
        rows.push(cur); cur = []; acc = 0;
      }
      cur.push(d); acc += d.w;
    });
    if (cur.length) rows.push(cur);
    candidates.push(rows);
    if (autoSort && r > 1) {
      // 另一種：每台放到目前最窄的列
      const rs = Array.from({ length: r }, () => ({ list: [], w: 0 }));
      for (const d of sorted) { const t = rs.reduce((a, b) => (b.w < a.w ? b : a)); t.list.push(d); t.w += d.w; }
      if (rs.every(x => x.list.length)) candidates.push(rs.map(x => x.list));
    }
  }
  let best = null;
  for (const rows of candidates) {
    const placed = [];
    const rowW = rows.map(row => row.reduce((s, d) => s + d.w, 0) + gap * (row.length - 1));
    const maxW = Math.max(...rowW);
    let y = 0;
    rows.forEach((row, ri) => {
      const H = Math.max(...row.map(d => d.h));
      let x = (maxW - rowW[ri]) / 2;
      for (const d of row) { placed.push({ id: d.id, x, y: y + (H - d.h) / 2, w: d.w, h: d.h }); x += d.w + gap; }
      y += H + gap;
    });
    const box = { x: 0, y: 0, w: maxW, h: y - gap };
    const area = items.reduce((s, d) => s + d.w * d.h, 0);
    const fill = area / (box.w * box.h);
    const aspect = box.w / box.h;
    const score = fill - 0.06 * Math.abs(Math.log(aspect / 2.5));
    if (!best || score > best.score + 1e-9) best = { score, placed, box, rows: rows.length, fill };
  }
  return best;
}

function screensList() {
  const list = [];
  if (selfShow) {
    const s = mySize();
    list.push({ id: 'self', w: s.w, h: s.h, scale: selfScale });
  }
  for (const id of order) { const d = devices.get(id); if (d) list.push({ id, w: d.w, h: d.h, scale: d.scale }); }
  return list;
}
let selfScale = 100;

function relayout() {
  if (role !== 'manager') return;
  const list = screensList();
  const forced = +$('rows').value;
  layoutResult = computeLayout(list, forced, +$('gap').value || 0, $('autoSort').checked);
  // 列數選單
  const sel = $('rows'), keep = sel.value;
  sel.innerHTML = '<option value="0">自動</option>' + list.map((_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + ' 列</option>').join('');
  sel.value = +keep <= list.length ? keep : '0';
  sendViews();
  renderDevList();
  store.set('pwall-manager', { content, layout: { autoSort: $('autoSort').checked, gap: +$('gap').value || 0 } });
}

function viewFor(id) {
  if (!layoutResult) return null;
  const idx = layoutResult.placed.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const p = layoutResult.placed[idx];
  return { slot: { x: p.x, y: p.y, w: p.w, h: p.h }, box: layoutResult.box, index: idx, total: layoutResult.placed.length, identify };
}

function sendViews() {
  for (const d of devices.values()) {
    const v = viewFor(d.dev);
    if (v && d.conn && d.conn.open) d.conn.send({ t: 'view', v });
  }
  view = selfShow ? viewFor('self') : null;
  const n = layoutResult ? layoutResult.placed.length : 0;
  $('devCount').textContent = devices.size + (selfShow ? ' + 本機' : '');
  $('layoutInfo').textContent = n
    ? n + ' 台組成 ' + layoutResult.rows + ' 列，大畫面約 ' + Math.round(layoutResult.box.w) + ' × ' + Math.round(layoutResult.box.h) + '（填滿率 ' + Math.round(layoutResult.fill * 100) + '%）。灰色編號依序對應各裝置畫面上顯示的編號。'
    : '尚無裝置。請讓其他手機、平板開啟上方連結。';
}

function renderDevList() {
  const tb = $('devList');
  const rows = [];
  const list = screensList();
  list.forEach(item => {
    const v = viewFor(item.id);
    const num = v ? v.index + 1 : '-';
    const d = item.id === 'self' ? { name: '本機（管理者）' } : devices.get(item.id);
    const canMove = item.id !== 'self';
    rows.push('<tr><td><b>' + num + '</b></td><td>' + esc(d.name || '') + '</td><td>' + Math.round(item.w) + '×' + Math.round(item.h) +
      '</td><td><input type="number" min="30" max="300" step="5" value="' + item.scale + '" data-scale="' + item.id + '"></td><td>' +
      (canMove ? '<button class="sec" data-up="' + item.id + '">↑</button> <button class="sec" data-down="' + item.id + '">↓</button>' : '') + '</td></tr>');
  });
  tb.innerHTML = rows.join('') || '<tr><td colspan="5" class="muted">尚無裝置連入</td></tr>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('devList').addEventListener('change', e => {
  const id = e.target.dataset.scale;
  if (!id) return;
  const v = Math.max(30, Math.min(300, +e.target.value || 100));
  if (id === 'self') selfScale = v;
  else {
    const d = devices.get(id); if (!d) return; d.scale = v;
    const sc = store.get('pwall-scales') || {}; sc[id] = v; store.set('pwall-scales', sc);
  }
  relayout();
});
$('devList').addEventListener('click', e => {
  const up = e.target.dataset.up, down = e.target.dataset.down;
  const id = up || down;
  if (!id) return;
  const i = order.indexOf(id), j = up ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  $('autoSort').checked = false;   // 手動調整順序時改為依清單順序
  relayout();
});

// 預覽：把整個大畫面縮小畫出，並標示每台裝置
function previewLoop() {
  requestAnimationFrame(previewLoop);
  if (role !== 'manager' || $('panel').classList.contains('hidden')) return;
  const cv = $('preview'), g = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth;
  const B = layoutResult ? layoutResult.box : { x: 0, y: 0, w: 16, h: 9 };
  const H = Math.max(120, Math.min(360, W * B.h / B.w));
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const k = Math.min((W - 10) / B.w, (H - 10) / B.h);
  const ox = (W - B.w * k) / 2, oy = (H - B.h * k) / 2;
  g.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
  const c = draft || content;
  if (layoutResult) {
    // 只在各裝置範圍內顯示內容（縫隙留黑）
    g.save(); g.beginPath();
    for (const p of layoutResult.placed) g.rect(p.x, p.y, p.w, p.h);
    g.clip();
    drawContent(c, B, Date.now(), g, c.type === 'image' ? (draftImg || img) : null);
    g.restore();
    layoutResult.placed.forEach((p, i) => {
      g.strokeStyle = '#6aa0ff'; g.lineWidth = 2 / k; g.strokeRect(p.x, p.y, p.w, p.h);
      const fs = Math.min(p.w, p.h) * 0.3;
      g.font = '700 ' + fs + 'px ' + fontStack; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(160,160,160,.75)';
      g.fillText(String(i + 1), p.x + p.w / 2, p.y + p.h / 2);
    });
  } else {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#666'; g.font = '14px ' + fontStack; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('等待裝置連入…', W / 2, H / 2);
  }
}

// ---------- 表單 ----------
let type = 'text', mode = 'static', imageData = null, draftImg = null;
function seg(id, cb) {
  $(id).addEventListener('click', e => {
    const v = e.target.dataset.v; if (!v) return;
    for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === v);
    cb(v); formChanged();
  });
}
function setSeg(id, v) { for (const b of $(id).children) b.classList.toggle('on', b.dataset.v === v); }
seg('typeSeg', v => { type = v; $('textOpts').classList.toggle('hidden', v !== 'text'); $('imageOpts').classList.toggle('hidden', v !== 'image'); });
seg('modeSeg', v => { mode = v; $('speedBox').classList.toggle('hidden', v !== 'marquee'); });

function readForm() {
  return {
    type, mode, text: $('text').value, speed: +$('speed').value, size: +$('size').value,
    color: $('color').value, bg: type === 'image' ? $('bg2').value : $('bg').value, bold: $('bold').checked,
    fit: $('fit').value, image: type === 'image' ? imageData : null, t0: draft ? draft.t0 : Date.now(),
  };
}
function applyToForm(c) {
  type = c.type || 'text'; mode = c.mode || 'static';
  setSeg('typeSeg', type); setSeg('modeSeg', mode);
  $('textOpts').classList.toggle('hidden', type !== 'text'); $('imageOpts').classList.toggle('hidden', type !== 'image');
  $('speedBox').classList.toggle('hidden', mode !== 'marquee');
  $('text').value = c.text || '';
  $('speed').value = c.speed || 6; $('speedVal').textContent = $('speed').value;
  $('size').value = c.size || 100; $('sizeVal').textContent = $('size').value + '%';
  $('color').value = c.color || '#ffdd00';
  if (type === 'image') $('bg2').value = c.bg || '#000000'; else $('bg').value = c.bg || '#000000';
  $('bold').checked = c.bold !== false;
  $('fit').value = c.fit || 'contain';
  imageData = c.image || null;
  if (imageData) { const im = new Image(); im.onload = () => { draftImg = im; }; im.src = imageData; }
}
function formChanged() {
  $('speedVal').textContent = $('speed').value;
  $('sizeVal').textContent = $('size').value + '%';
  draft = readForm();
}
['text', 'speed', 'size', 'color', 'bg', 'bg2', 'bold', 'fit'].forEach(id => $(id).addEventListener('input', formChanged));

$('file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      // 縮小到最長邊 2048px，避免傳輸過大
      const max = 2048, s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      const png = /png|gif|webp/.test(f.type);
      imageData = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
      if (png && imageData.length > 3e6) imageData = c.toDataURL('image/jpeg', 0.88);
      const di = new Image(); di.onload = () => { draftImg = di; }; di.src = imageData;
      formChanged();
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(f);
});

$('sendBtn').onclick = () => {
  const c = readForm();
  if (c.type === 'image' && !c.image) { alert('請先選擇圖片'); return; }
  c.t0 = Date.now();
  content = c; draft = c;
  loadImage(c.image);
  for (const d of devices.values()) if (d.conn && d.conn.open) d.conn.send({ t: 'content', c });
  store.set('pwall-manager', { content: c, layout: { autoSort: $('autoSort').checked, gap: +$('gap').value || 0 } });
  const b = $('sendBtn'); b.textContent = '已送出 ✓'; setTimeout(() => { b.textContent = '送出顯示'; }, 1200);
};
$('identify').onchange = () => { identify = $('identify').checked; sendViews(); };
$('rows').onchange = relayout;
$('autoSort').onchange = relayout;
$('gap').oninput = relayout;
$('selfShow').onchange = () => { selfShow = $('selfShow').checked; $('viewBtn').classList.toggle('hidden', !selfShow); relayout(); };
$('viewBtn').onclick = () => {
  $('panel').classList.add('hidden'); $('gear').classList.remove('hidden');
  showWall(true); keepAwake();
  setStatus('點右下角 ⚙ 回到控制台');
};
$('gear').onclick = () => { $('panel').classList.remove('hidden'); $('gear').classList.add('hidden'); showWall(false); };
$('copyBtn').onclick = () => {
  const t = $('link'); t.select();
  (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).catch(() => document.execCommand('copy'));
  $('copyBtn').textContent = '已複製'; setTimeout(() => { $('copyBtn').textContent = '複製連結'; }, 1200);
};
$('shareBtn').onclick = () => navigator.share({ title: '拼接大螢幕 房間 ' + room, url: $('link').value }).catch(() => {});

// 帶有房間參數直接開啟時自動進入
if (params.get('room')) $('joinBtn').click();
