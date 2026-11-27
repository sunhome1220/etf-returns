// 各頁共用（報酬率頁、主動型比較頁）：資料代理網址、證交所即時報價、ETF 預估淨值、日期推算。
// 證交所的資料經 Cloudflare Worker（worker.js）轉送：/mis/<代碼,...>、/etfnav。
const MK = (() => {
  // 資料代理網址：頁面有內嵌的就用（setProxy），否則讀 proxy.txt
  let url = null;
  const setProxy = p => { url = (p || '').replace(/\/$/, '') || null; };
  async function proxy() {
    if (url === null) {
      const t = await fetch('proxy.txt', {cache:'no-cache'}).then(r => r.ok ? r.text() : '').catch(() => '');
      url = t.trim().replace(/\/$/, '');
    }
    return url;
  }

  // 證交所「基本市況報導」即時報價（約 15 秒快取）；t00＝加權指數。Worker 未更新時自動略過
  // → {代碼: {price, prev, day:'YYYY-MM-DD', closed, ts}}；已收盤的資料時間一律是當日 13:30
  async function mis(codes) {
    const out = {}, px = await proxy();
    if (!px || !codes.length) return out;
    for (let i = 0; i < codes.length; i += 30) {
      const j = await fetch(`${px}/mis/${codes.slice(i, i + 30).join(',')}`).then(r => r.ok ? r.json() : null).catch(() => null);
      for (const q of (j && j.msgArray) || []) {
        const num = v => { const n = parseFloat(v); return n > 0 ? n : null; };
        // 成交價；這一盤還沒成交（-）時用最佳買價
        const price = num(q.z) ?? num((q.b || '').split('_')[0]);
        if (!price || !q.d || !q.tlong) continue;
        const hm = (q.t || '').slice(0, 5);
        const day = `${q.d.slice(0, 4)}-${q.d.slice(4, 6)}-${q.d.slice(6, 8)}`, closed = hm >= '13:30';
        out[q.c] = {price, prev:num(q.y), day, closed, ts:closed ? Date.parse(`${day}T13:30:00+08:00`) / 1000 : Math.floor(+q.tlong / 1000)};
      }
    }
    return out;
  }

  // 證交所「ETF 即時預估淨值」（與 build.py parse_etf_nav 相同）：逐層找有 a（代碼）與 f（預估淨值）的物件
  // → {代碼: {v:淨值, prev:前一營業日淨值, d:'YYYYMMDD', t:'HH:MM:SS'}}
  function parseNav(j) {
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
  // 舊版資料代理沒有 /etfnav 時回傳空的，沿用排程資料
  async function etfNav() {
    const px = await proxy(); if (!px) return {};
    const j = await fetch(`${px}/etfnav`).then(r => r.ok ? r.text() : '').then(t => t ? JSON.parse(t.replace(/^﻿/, '')) : null).catch(() => null);
    return parseNav(j);
  }

  // 期間起點的目標日（與 build.py period_target 相同）：往回推 days 天，或 months 個月（月底對齊）
  function periodTarget(day, months, days) {
    const [y, m, d] = day.split('-').map(Number);
    if (days) return new Date(Date.UTC(y, m - 1, d) - days * 864e5).toISOString().slice(0, 10);
    const t = new Date(Date.UTC(y, m - 1 - months, 1));
    t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
    return t.toISOString().slice(0, 10);
  }

  return {setProxy, proxy, mis, parseNav, etfNav, periodTarget};
})();
