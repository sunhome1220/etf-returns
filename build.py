"""讀取 stocks.csv，從 Yahoo Finance 抓股價，計算各年度含息報酬率，輸出 index.html。

用法:  python build.py            (預設抓今年 + 前 9 年，網頁可拉選 1~10 年)
       python build.py --years 8
"""
import argparse
import csv
import datetime as dt
import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0"}


def fetch_chart(symbol, start_year):
    p1 = int(dt.datetime(start_year - 1, 12, 1).timestamp())
    p2 = int(dt.datetime.now().timestamp()) + 86400
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s"
           "?period1=%d&period2=%d&interval=1d&events=div%%7Csplit" % (symbol, p1, p2))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        res = json.load(r)["chart"]["result"]
    if not res or not res[0].get("timestamp"):
        return None
    return res[0]


def prev_close(symbol):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1d&interval=1d" % symbol
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return json.load(r)["chart"]["result"][0]["meta"].get("chartPreviousClose")
    except Exception:
        return None


MARKETS = {"Asia/Taipei": ("台股", "台北"), "America/New_York": ("美股", "紐約"),
           "Europe/London": ("英股", "倫敦")}
TPE = dt.timezone(dt.timedelta(hours=8))


def market_time(meta):
    """回傳 (市場, 資料時間 UTC timestamp, 是否收盤, 當地時區名, 當地 gmtoffset)。
    已收盤 → 以該交易日收盤時間為準；盤中 → 以最後成交時間為準。"""
    tz = meta.get("exchangeTimezoneName", "")
    name, city = MARKETS.get(tz, (meta.get("fullExchangeName", tz), tz))
    off = meta.get("gmtoffset", 0)
    rmt = meta.get("regularMarketTime")
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    now = dt.datetime.now(dt.timezone.utc).timestamp()
    if not rmt or not reg:
        return {"market": name, "city": city, "ts": rmt, "closed": True, "off": off}
    is_open = reg["start"] <= now < reg["end"]
    if is_open:
        ts = rmt
    else:
        # 最後成交日的收盤時間（收盤時刻取自交易時段）
        close_tod = (reg["end"] + off) % 86400
        ts = (rmt + off) // 86400 * 86400 + close_tod - off
        if ts > rmt + 3600 * 12:  # 異常（例如半日市），退回最後成交時間
            ts = rmt
    return {"market": name, "city": city, "ts": ts, "closed": not is_open, "off": off}


def fmt_ts(ts, off):
    return dt.datetime.fromtimestamp(ts, dt.timezone(dt.timedelta(seconds=off))).strftime("%Y/%m/%d %H:%M")


def yahoo_symbols(row):
    if row.get("Yahoo代號"):
        return [row["Yahoo代號"]]
    code = row["代碼"]
    if re.fullmatch(r"\d{4,6}[A-Z]?", code):  # 台股代碼（含追蹤海外的 ETF）
        return [code + ".TW", code + ".TWO"]
    return [code]


def analyze(row, years):
    data, symbol = None, None
    for s in yahoo_symbols(row):
        try:
            data = fetch_chart(s, years[-1])
        except Exception:
            data = None
        if data:
            symbol = s
            break
    out = dict(row)
    if not data:
        out["error"] = "查無資料"
        return out

    off = data["meta"].get("gmtoffset", 28800)
    closes = data["indicators"]["quote"][0]["close"]
    adj = data["indicators"]["adjclose"][0]["adjclose"]
    pts = []  # (date, close, adjclose)
    for t, c, a in zip(data["timestamp"], closes, adj):
        if c is not None and a is not None:
            pts.append((dt.datetime.utcfromtimestamp(t + off).date(), c, a))
    if not pts:
        out["error"] = "查無資料"
        return out

    # Yahoo 有時漏掉分割調整：台股單日漲跌幅有限制，單日變動 >40% 視為分割/合併
    for i in range(len(pts) - 1, 0, -1):
        r = pts[i - 1][2] / pts[i][2]
        n = round(r) if r > 1 else 1 / round(1 / r)
        if (r > 1.6 or r < 0.6) and abs(r / n - 1) < 0.12:
            pts[:i] = [(d, c, a / n) for d, c, a in pts[:i]]

    out["symbol"] = symbol
    out["_market"] = market_time(data["meta"])
    out["_yname"] = data["meta"].get("shortName") or data["meta"].get("longName")
    out["price"] = data["meta"].get("regularMarketPrice", pts[-1][1])
    prev = prev_close(symbol)
    out["chg"] = (out["price"] / prev - 1) * 100 if prev else None
    out["date"] = pts[-1][0].isoformat()

    # 成立日: 若資料起點晚於查詢起點，視為該日上市
    first = pts[0][0]
    listed = first if first > dt.date(years[-1] - 1, 12, 31) else None
    out["listed"] = listed.isoformat() if listed else None

    def last_adj(year):
        v = [a for d, _, a in pts if d.year == year]
        return v[-1] if v else None

    rets = {}
    for y in years:
        end, prev = last_adj(y), last_adj(y - 1)
        if end is None:
            if listed and listed.year == y + 1:
                rets[y] = {"note": "%d年%d月成立" % (listed.year % 100, listed.month)}
            elif listed and listed.year > y:
                rets[y] = {"note": "-未成立"}
            continue
        if prev is None:  # 當年上市：從第一筆收盤算起
            base = pts[0][2]
            rets[y] = {"v": (end / base - 1) * 100, "partial": True}
        else:
            rets[y] = {"v": (end / prev - 1) * 100}
    out["returns"] = {str(k): v for k, v in rets.items()}

    # 除息月份：近一年的除息事件
    if not row.get("除息"):
        cutoff = pts[-1][0] - dt.timedelta(days=380)
        months = set()
        for ev in (data.get("events") or {}).get("dividends", {}).values():
            d = dt.datetime.utcfromtimestamp(ev["date"] + off).date()
            if d >= cutoff:
                months.add(d.month)
        out["除息"] = "每月" if len(months) >= 9 else (
            ",".join(str(m) for m in sorted(months)) if months else "無")
    return out


DEFAULT_YEARS = 10
CSV_PATH = os.path.join(HERE, "stocks.csv")
CSV_FIELDS = ["區", "類", "代碼", "名稱", "除息", "Yahoo代號"]
MARKET_ORDER = ["台股", "美股", "英股"]


def get_years(n=DEFAULT_YEARS):
    this_year = dt.date.today().year
    return [this_year - i for i in range(n)]


def load_rows(path=CSV_PATH):
    with open(path, encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if r.get("代碼")]


def save_rows(rows, path=CSV_PATH):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def market_text(m):
    txt = "%s %s %s" % (m["market"], fmt_ts(m["ts"], m["off"]), "收盤" if m["closed"] else "盤中")
    if m["off"] != 28800:
        txt += "（%s時間，台北 %s）" % (m["city"], fmt_ts(m["ts"], 28800))
    return txt


def finish_row(r, markets):
    """把 analyze 的市場資訊轉成 r["mkt"]，並更新 markets {名稱: {ts, text}}（取最新）。"""
    r.pop("_yname", None)
    m = r.pop("_market", None)
    if not m or not m["ts"]:
        return
    r["mkt"] = m["market"]
    cur = markets.get(m["market"])
    if not cur or m["ts"] > cur["ts"]:
        markets[m["market"]] = {"ts": m["ts"], "text": market_text(m)}


def build(rows, years):
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda r: analyze(r, years), rows))
    markets = {}
    for r in results:
        finish_row(r, markets)
    return {
        "years": years,
        "updated": dt.datetime.now(TPE).strftime("%Y/%m/%d %H:%M"),
        "markets": markets,
        "marketOrder": MARKET_ORDER,
        "rows": results,
    }


def write_html(payload, out=os.path.join(HERE, "index.html")):
    with open(os.path.join(HERE, "template.html"), encoding="utf-8") as f:
        html = f.read()
    html = html.replace("/*DATA*/null", json.dumps(payload, ensure_ascii=False))
    # 資料代理網址：環境變數 PROXY_URL 或 proxy.txt
    proxy = os.environ.get("PROXY_URL", "")
    ptxt = os.path.join(HERE, "proxy.txt")
    if not proxy and os.path.exists(ptxt):
        proxy = open(ptxt, encoding="utf-8").read().strip()
    html = html.replace("/*PROXY*/''", json.dumps(proxy.rstrip("/")))
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)


def tw_name(code):
    """從證交所查中文簡稱（上市 tse / 上櫃 otc）。"""
    for ex in ("tse", "otc"):
        url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=%s_%s.tw" % (ex, code)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
                for x in json.load(r).get("msgArray", []):
                    if x.get("n"):
                        return x["n"]
        except Exception:
            pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=DEFAULT_YEARS, help="抓取年數(含今年)")
    ap.add_argument("--csv", default=CSV_PATH)
    ap.add_argument("--out", default=os.path.join(HERE, "index.html"))
    args = ap.parse_args()

    payload = build(load_rows(args.csv), get_years(args.years))
    for r in payload["rows"]:
        print("%-8s %-12s %s" % (r["代碼"], r["名稱"], r.get("error", "OK")))
    for m in payload["markets"].values():
        print(m["text"])
    write_html(payload, args.out)
    print("已輸出", args.out)


if __name__ == "__main__":
    main()
