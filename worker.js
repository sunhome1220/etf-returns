// Cloudflare Worker：讓網頁可以向 Yahoo Finance / 證交所查資料（瀏覽器直接呼叫會被 CORS 擋下）
// 只轉送這兩個來源，不是通用代理。
//   GET /chart/<Yahoo代號>?<查詢參數>   → query1.finance.yahoo.com/v8/finance/chart/...
//   GET /twname/<台股代碼>              → mis.twse.com.tw 中文名稱
//   GET /mis/<代碼,代碼,...>            → mis.twse.com.tw 台股即時報價（上市＋上櫃，最多 40 檔，快取 15 秒）
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,20}$/;
const ALLOWED_QS = new Set(['period1', 'period2', 'interval', 'events', 'range']);

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, {headers: CORS});
    const u = new URL(req.url);
    const [, kind, raw] = u.pathname.split('/');
    const sym = decodeURIComponent(raw || '');

    let target, ttl;
    if (kind === 'mis') {
      const codes = sym.split(',').filter(Boolean);
      if (!codes.length || codes.length > 40 || !codes.every(c => /^[0-9A-Z]{4,6}$/.test(c))) return json({error: 'bad codes'}, 400);
      const ex = codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]).join('|');
      target = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex}&json=1&delay=0`;
      ttl = 15;
    } else if (!SYMBOL.test(sym)) {
      return json({error: 'bad symbol'}, 400);
    } else if (kind === 'chart') {
      const qs = new URLSearchParams();
      for (const [k, v] of u.searchParams) if (ALLOWED_QS.has(k)) qs.set(k, v);
      target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`;
      ttl = 300;
    } else if (kind === 'twname') {
      target = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${sym}.tw|otc_${sym}.tw`;
      ttl = 86400;
    } else {
      return json({error: 'not found'}, 404);
    }
    const r = await fetch(target, {headers: {'User-Agent': 'Mozilla/5.0'}, cf: {cacheTtl: ttl, cacheEverything: true}});
    return new Response(r.body, {status: r.status, headers: {...CORS, 'Cache-Control': `public, max-age=${ttl}`}});
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {status, headers: CORS});
}
