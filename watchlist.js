// 個人追蹤清單：存在各自的瀏覽器（localStorage），「我的追蹤清單」與「各年度含息報酬率」共用。
// 清單 = 預設清單（stocks.csv）− 移除的項目 + 自訂項目，預設項目可覆寫 名稱/區/類。
// 這樣站長在 stocks.csv 新增的項目，使用者也會自動看到。
const WL = (() => {
  const K = {custom:'etf-custom', removed:'etf-removed', edits:'etf-edits'};
  const KEYS = Object.values(K);
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const FIELDS = ['名稱', '區', '類'];

  const state = () => ({custom:get(K.custom, []), removed:get(K.removed, []), edits:get(K.edits, {})});

  // base: 預設清單 [{代碼, 名稱, 區, 類, ...}] → 個人清單（每項加上 source: 'default' | 'custom', edited）
  function items(base) {
    const s = state(), rm = new Set(s.removed);
    const out = base.filter(r => !rm.has(r.代碼)).map(r => {
      const e = s.edits[r.代碼];
      return {...r, ...(e || {}), source:'default', edited:!!e};
    });
    const have = new Set(out.map(r => r.代碼));
    s.custom.forEach(c => { if (!have.has(c.代碼)) out.push({...c, source:'custom', edited:false}); });
    return out;
  }
  const removedItems = base => { const rm = new Set(state().removed); return base.filter(r => rm.has(r.代碼)); };

  function addCustom(it) {
    const s = state();
    if (s.removed.includes(it.代碼)) {  // 原本是預設項目：直接還原
      set(K.removed, s.removed.filter(x => x !== it.代碼));
      return 'restored';
    }
    set(K.custom, s.custom.filter(c => c.代碼 !== it.代碼).concat([{
      代碼:it.代碼, Yahoo代號:it.Yahoo代號 || '', 名稱:it.名稱 || it.代碼, 區:it.區 || '全球', 類:it.類 || '自選', 除息:''}]));
    return 'added';
  }
  function remove(code) {
    const s = state();
    if (s.custom.some(c => c.代碼 === code)) set(K.custom, s.custom.filter(c => c.代碼 !== code));
    else if (!s.removed.includes(code)) set(K.removed, s.removed.concat([code]));
  }
  function restore(code) { set(K.removed, state().removed.filter(x => x !== code)); }
  function restoreAll() { set(K.removed, []); }
  function edit(code, fields, base) {
    const s = state();
    const ci = s.custom.findIndex(c => c.代碼 === code);
    if (ci >= 0) { Object.assign(s.custom[ci], pick(fields)); set(K.custom, s.custom); return; }
    const orig = base.find(r => r.代碼 === code) || {};
    const e = {...(s.edits[code] || {}), ...pick(fields)};
    FIELDS.forEach(f => { if (e[f] === orig[f] || e[f] === undefined) delete e[f]; });
    if (Object.keys(e).length) s.edits[code] = e; else delete s.edits[code];
    set(K.edits, s.edits);
  }
  function unedit(code) { const s = state(); delete s.edits[code]; set(K.edits, s.edits); }
  function resetAll() { KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); }
  const pick = f => Object.fromEntries(FIELDS.filter(k => f[k] !== undefined).map(k => [k, String(f[k]).trim()]));

  function exportData() { return {app:'etf-watchlist', version:1, exported:new Date().toISOString(), ...state()}; }
  function importData(obj) {
    if (!obj || obj.app !== 'etf-watchlist' || !Array.isArray(obj.custom) || !Array.isArray(obj.removed))
      throw new Error('檔案格式不正確');
    set(K.custom, obj.custom.filter(c => c && c.代碼));
    set(K.removed, obj.removed.filter(x => typeof x === 'string'));
    set(K.edits, obj.edits && typeof obj.edits === 'object' ? obj.edits : {});
  }
  // 其他分頁修改清單時通知（storage 事件只在「其他」分頁觸發）
  function onChange(cb) { addEventListener('storage', e => { if (!e.key || KEYS.includes(e.key)) cb(); }); }

  // ---- 預設清單：直接讀網站上的 stocks.csv ----
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const [head, ...body] = rows.filter(r => r.some(x => x.trim()));
    return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()]))).filter(r => r.代碼);
  }
  async function loadBase() {
    const r = await fetch('stocks.csv', {cache:'no-cache'});
    if (!r.ok) throw new Error('無法讀取預設清單');
    return parseCSV(await r.text());
  }

  // ---- 透過資料代理（Cloudflare Worker）查 Yahoo / 證交所 ----
  let PROXY = null;
  const setProxy = p => { PROXY = (p || '').replace(/\/$/, ''); };
  async function proxy() {
    if (PROXY === null) {
      const t = await fetch('proxy.txt', {cache:'no-cache'}).then(r => r.ok ? r.text() : '').catch(() => '');
      setProxy(t.trim());
    }
    return PROXY;
  }
  async function getJSON(url) { const r = await fetch(url); return r.ok ? r.json() : null; }
  async function chart(sym, qs) {
    const j = await getJSON(`${await proxy()}/chart/${encodeURIComponent(sym)}?${qs}`);
    const res = j && j.chart && j.chart.result;
    return res && res[0] && res[0].timestamp ? res[0] : null;
  }
  function symbolsFor(it) {
    if (it.Yahoo代號) return [it.Yahoo代號];
    if (/^\d{4,6}[A-Z]?$/.test(it.代碼)) return [it.代碼 + '.TW', it.代碼 + '.TWO'];
    return [it.代碼];
  }
  async function twName(code) {
    const j = await getJSON(`${await proxy()}/twname/${encodeURIComponent(code)}`).catch(() => null);
    const hit = j && (j.msgArray || []).find(x => x.n);
    return hit ? hit.n : null;
  }
  const MK = {'Asia/Taipei':['台股','台北'], 'America/New_York':['美股','紐約'], 'Europe/London':['英股','倫敦']};
  const REGION_BY_MARKET = {台股:'台灣', 美股:'美國', 英股:'全球'};
  // '0050' → ['0050', '']；'vwra.l' → ['VWRA', 'VWRA.L']
  function parseCode(raw) {
    raw = String(raw || '').trim().toUpperCase();
    const [code, ysym] = raw.includes('.') ? [raw.split('.')[0], raw] : [raw, ''];
    if (!/^[0-9A-Z^=\-]{1,12}$/.test(code)) throw new Error('代碼格式不正確');
    return {raw, code, ysym};
  }
  // 確認代碼存在，補齊名稱與區
  async function lookup(raw, opts = {}) {
    const {code, ysym} = parseCode(raw);
    if (!await proxy()) throw new Error('尚未設定資料代理，無法查詢新代碼');
    const it = {代碼:code, Yahoo代號:ysym};
    let meta = null;
    for (const s of symbolsFor(it)) {
      const d = await chart(s, 'range=5d&interval=1d').catch(() => null);
      if (d) { meta = d.meta; break; }
    }
    if (!meta) throw new Error(`查無 ${raw || code} 的資料（台股請輸入數字代碼，海外如 QQQ、VWRA.L）`);
    const mkt = (MK[meta.exchangeTimezoneName] || [])[0];
    return {
      ...it,
      名稱:opts.名稱 || (mkt === '台股' && await twName(code)) || meta.shortName || meta.longName || code,
      區:opts.區 || REGION_BY_MARKET[mkt] || '全球',
      類:opts.類 || '自選',
    };
  }

  return {items, removedItems, state, addCustom, remove, restore, restoreAll, edit, unedit, resetAll,
          exportData, importData, onChange, loadBase, parseCSV, setProxy, proxy, chart, symbolsFor, twName,
          parseCode, lookup, MK, REGION_BY_MARKET};
})();
