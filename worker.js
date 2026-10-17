// Cloudflare Worker：讓網頁可以向 Yahoo Finance / 證交所查資料（瀏覽器直接呼叫會被 CORS 擋下）
// 只轉送這兩個來源，不是通用代理。
//   GET /chart/<Yahoo代號>?<查詢參數>   → query1.finance.yahoo.com/v8/finance/chart/...
//   GET /twname/<台股代碼>              → mis.twse.com.tw 中文名稱
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
    if (!SYMBOL.test(sym)) return json({error: 'bad symbol'}, 400);

    let target, ttl;
    if (kind === 'chart') {
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
