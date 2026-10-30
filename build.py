"""讀取 stocks.csv，從 Yahoo Finance / 證交所抓資料，計算各年度含息報酬率，輸出 returns.html。
已結束年度的報酬率記在 history.json，之後只重算今年。

用法:  python build.py            (預設抓今年 + 前 9 年，網頁可拉選 1~10 年)
       python build.py --years 8
       python build.py --full      (忽略 history.json，全部重算)
"""
import argparse
import calendar
import csv
import datetime as dt
import json
import os
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0"}


def fetch_chart(symbol, start_year=None, period1=None):
    p1 = period1 or int(dt.datetime(start_year - 1, 12, 1).timestamp())
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


# ---- 歷史報酬率快取 history.json：已結束年度的報酬率不會再變，算過就記下來 ----
HIST_PATH = os.path.join(HERE, "history.json")


def load_hist(path=HIST_PATH):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_hist(hist, path=HIST_PATH):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=1, sort_keys=True)


def hist_key(row):
    return row["代碼"] + ("|" + row["Yahoo代號"] if row.get("Yahoo代號") else "")


def year_returns(years, end_of, listed, first_val, simple=None):
    """end_of(y) → 該年最後一筆（還原）值或 None；listed 為上市日（期間內上市才有）。
    simple = (close_of, div_of, first_close)：另算股息不再投入的報酬率
    （年底收盤 + 當年除息合計 − 前一年底收盤）÷ 前一年底收盤，存在 "s"。"""
    rets = {}
    for y in years:
        end, prev = end_of(y), end_of(y - 1)
        if end is None:
            if listed and listed.year == y + 1:
                rets[str(y)] = {"note": "%d年成立" % listed.year}
            elif listed and listed.year > y:
                rets[str(y)] = {"note": "尚未成立"}
            continue
        if prev is None:  # 當年上市：從第一筆收盤算起
            rets[str(y)] = {"v": (end / first_val - 1) * 100, "partial": True}
        else:
            rets[str(y)] = {"v": (end / prev - 1) * 100}
        if simple:
            close_of, div_of, first_close = simple
            base = close_of(y - 1) if prev is not None else first_close
            if base:
                rets[str(y)]["s"] = ((close_of(y) + div_of(y)) / base - 1) * 100
    return rets


# 近期報酬率：以最新收盤日往回推日曆日，起點取該日（或之前最後一個交易日）收盤
PERIODS = [("w1", 0, 7), ("m1", 1, 0), ("m3", 3, 0), ("m6", 6, 0), ("y1", 12, 0), ("y3", 36, 0), ("y5", 60, 0)]


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def period_target(end, months, days):
    return end - dt.timedelta(days=days) if days else add_months(end, -months)


def recent_returns(pts, divs):
    """pts = [(date, close, adjclose)] 依日期排序；divs = [(除息日, 金額)]。
    回傳 {期間: {"v": 再投入, "s": 不再投入}}，資料不足（上市未滿）為 {"note": "上市未滿"}。"""
    end_d, end_c, end_a = pts[-1]
    out = {}
    for k, months, days in PERIODS:
        t = period_target(end_d, months, days)
        start = None
        for p in pts:
            if p[0] > t:
                break
            start = p
        if start is None:
            out[k] = {"note": "上市未滿"}
            continue
        div = sum(v for d, v in divs if start[0] < d <= end_d)
        out[k] = {"v": (end_a / start[2] - 1) * 100, "s": ((end_c + div) / start[1] - 1) * 100}
    return out


def analyze(row, years, hist=None):
    hist = {} if hist is None else hist
    key = hist_key(row)
    cached = hist.get(key) or {}
    done = cached.get("returns", {})
    missing = [y for y in years[1:] if str(y) not in done]
    if (row.get("Yahoo代號") or "").upper().startswith("TWSE:"):
        return analyze_twse(row, years, hist, key, cached, missing)
    # 舊記錄沒有「股息不再投入」報酬率（s）的年度也要重算
    missing = [y for y in years[1:] if str(y) not in done or ("v" in done[str(y)] and "s" not in done[str(y)])]

    # 有缺的年度才抓更早的資料；否則抓近五年多（近期報酬率最長五年 + 今年報酬 + 除息月份）
    recent = int(dt.datetime.now().timestamp()) - (5 * 366 + 20) * 86400
    p1 = min(int(dt.datetime(min(missing) - 1, 12, 1).timestamp()), recent) if missing else recent
    data, symbol = None, None
    for s in yahoo_symbols(row):
        try:
            data = fetch_chart(s, period1=p1)
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
    divs = sorted((dt.datetime.utcfromtimestamp(ev["date"] + off).date(), ev["amount"])
                  for ev in (data.get("events") or {}).get("dividends", {}).values())

    # Yahoo 有時漏掉分割調整：台股單日漲跌幅有限制，單日變動 >40% 視為分割/合併
    def split_n(r):
        n = round(r) if r > 1 else 1 / round(1 / r)
        return n if (r > 1.6 or r < 0.6) and abs(r / n - 1) < 0.12 else None
    for i in range(len(pts) - 1, 0, -1):
        n = split_n(pts[i - 1][2] / pts[i][2])
        if n:
            pts[:i] = [(d, c, a / n) for d, c, a in pts[:i]]
        n = split_n(pts[i - 1][1] / pts[i][1])  # 收盤價與當時的配息金額同樣調整
        if n:
            pts[:i] = [(d, c / n, a) for d, c, a in pts[:i]]
            divs = [(d, v / n if d < pts[i][0] else v) for d, v in divs]

    # Yahoo 有時缺最後一根日K（例如除息日當天）：用最新成交價補上，期間除息一併計入還原價
    meta = data["meta"]
    rmt, last_px = meta.get("regularMarketTime"), meta.get("regularMarketPrice")
    if rmt and last_px:
        d_now = dt.datetime.utcfromtimestamp(rmt + off).date()
        d_last, c_last, a_last = pts[-1]
        if d_now > d_last:
            div = sum(ev["amount"] for ev in (data.get("events") or {}).get("dividends", {}).values()
                      if d_last < dt.datetime.utcfromtimestamp(ev["date"] + off).date() <= d_now)
            pts.append((d_now, last_px, a_last * (last_px + div) / c_last))

    # Yahoo 偶爾缺台股新上市標的的歷史日K（最早交易日比資料起點早一週以上，且不是查詢範圍造成的）：
    # 改用證交所每日收盤價與除息紀錄
    ftd = meta.get("firstTradeDate")
    if ftd and symbol.endswith(".TW"):
        fd = dt.datetime.utcfromtimestamp(ftd + off).date()
        if fd > dt.date.fromtimestamp(p1) + dt.timedelta(days=7) and (pts[0][0] - fd).days > 7:
            try:
                tp, td = twse_series(row["代碼"], fd)
            except Exception as e:
                tp, td = [], []
                print("%s：證交所資料讀取失敗 %s" % (row["代碼"], e))
            if len(tp) > len(pts):
                print("%s：Yahoo 缺歷史資料，改用證交所（%s 起 %d 筆、除息 %d 次）" % (row["代碼"], tp[0][0], len(tp), len(td)))
                pts, divs = tp, td
                out["src"] = "twse"

    out["symbol"] = symbol
    out["_market"] = market_time(data["meta"])
    out["_yname"] = data["meta"].get("shortName") or data["meta"].get("longName")
    # 成立日：stocks.csv「成立」欄優先（Yahoo 台股資料最早只到 2000／2008 年，較舊的標的需手動填），否則用 Yahoo 最早交易日
    if row.get("成立"):
        out["since"] = row["成立"]
    elif data["meta"].get("firstTradeDate"):
        out["since"] = dt.datetime.utcfromtimestamp(data["meta"]["firstTradeDate"] + off).date().isoformat()
    out["price"] = data["meta"].get("regularMarketPrice", pts[-1][1])
    prev = prev_close(symbol)
    out["chg"] = (out["price"] / prev - 1) * 100 if prev else None
    out["date"] = pts[-1][0].isoformat()

    # 成立日：資料起點晚於查詢範圍起點，視為該日上市（範圍比上次更早時重新判斷）
    first = pts[0][0]
    if not cached or (missing and min(missing) < cached.get("from", 9999)):
        listed = first if first > dt.date(years[-1] - 1, 12, 31) else None
        frm = years[-1]
    else:
        listed = dt.date.fromisoformat(cached["listed"]) if cached.get("listed") else None
        frm = cached.get("from", years[-1])
    out["listed"] = listed.isoformat() if listed else None

    def last_adj(year):
        v = [a for d, _, a in pts if d.year == year]
        return v[-1] if v else None

    def last_close(year):
        v = [c for d, c, _ in pts if d.year == year]
        return v[-1] if v else None

    def div_sum(year):  # 當年除息合計（以除息日歸年，資料起點後才算）
        return sum(v for d, v in divs if d.year == year and pts[0][0] < d <= pts[-1][0])

    new = year_returns([years[0]] + missing, last_adj, listed, pts[0][2], (last_close, div_sum, pts[0][1]))
    out["returns"] = {str(y): (new.get(str(y)) or done.get(str(y))) for y in years
                      if new.get(str(y)) or done.get(str(y))}
    # 只記錄已結束、且資料已跨到下一年的年度（避免年底最後一根日K尚未到位）
    settled = {y: v for y, v in new.items() if int(y) < years[0] and pts[-1][0] > dt.date(int(y), 12, 31)}
    hist[key] = {"listed": out["listed"], "from": frm, "returns": {**done, **settled}}
    out["recent"] = recent_returns(pts, divs)
    # 今年已除息：今年除息日已過的每股股息合計（元）
    out["divYtd"] = round(sum(v for d, v in divs if d.year == years[0] and d <= pts[-1][0]), 3)

    # 除息月份：近一年的除息事件
    if not row.get("除息"):
        cutoff = pts[-1][0] - dt.timedelta(days=380)
        ds = [d for d, _ in divs if d >= cutoff]
        out["除息"] = div_months(ds, young=pts[0][0] > cutoff)
    return out


def div_months(ds, young):
    """近一年的除息日 → 「每月」或月份清單。young＝上市未滿一年：除息次數還不夠，依間隔推算
    （間隔約 1 個月＝每月；固定 3／6 個月＝季配／半年配，補齊整年的月份）。"""
    months = sorted({d.month for d in ds})
    if len(months) >= 9:
        return "每月"
    idx = sorted({d.year * 12 + d.month - 1 for d in ds})
    if young and len(idx) >= 2:
        gaps = {b - a for a, b in zip(idx, idx[1:])}
        span = idx[-1] - idx[0] + 1
        if len(idx) >= 3 and max(gaps) <= 2 and len(idx) >= span * 0.75:
            return "每月"
        if len(gaps) == 1 and gaps.pop() in (3, 6):
            step = idx[1] - idx[0]
            return ",".join(str(m) for m in sorted({(idx[0] + k * step) % 12 + 1 for k in range(12 // step)}))
    return ",".join(str(m) for m in months) if months else "無"


# ---- 證交所指數（stocks.csv 的 Yahoo代號 填 TWSE:IR0001 / TWSE:IX0001）----
TWSE_INDEX = {
    "IR0001": ("MFI94U", 1),        # 發行量加權股價報酬指數（含息）
    "IX0001": ("MI_5MINS_HIST", 4),  # 發行量加權股價指數（收盤）
}
_twse_lock = threading.Lock()


def twse_month(ep, col, y, m):
    """某月每日指數 [(date, value)]；證交所有流量限制，序列化並間隔呼叫。"""
    url = "https://www.twse.com.tw/rwd/zh/TAIEX/%s?date=%04d%02d01&response=json" % (ep, y, m)
    with _twse_lock:
        time.sleep(1)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            j = json.load(r)
    out = []
    for rec in j.get("data") or []:
        ry, rm, rd = (int(x) for x in rec[0].split("/"))
        out.append((dt.date(ry + 1911, rm, rd), float(rec[col].replace(",", ""))))
    return out


def twse_json(path, **qs):
    """證交所 rwd API；有流量限制，與指數查詢共用鎖並間隔呼叫。"""
    url = "https://www.twse.com.tw/rwd/zh/%s?%s&response=json" % (path, "&".join("%s=%s" % kv for kv in qs.items()))
    with _twse_lock:
        time.sleep(1)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return json.load(r)


def roc_date(s):
    """民國日期（115/07/17 或 115年07月17日）→ date"""
    y, m, d = (int(x) for x in re.findall(r"\d+", s)[:3])
    return dt.date(y + 1911, m, d)


def twse_series(code, start):
    """證交所上市個股／ETF 從 start 起的每日收盤與除息 → (pts, divs)。
    pts = [(date, 收盤, 還原價)]，還原價依除息自行計算（除息前的價格乘上 1 − 息值 ÷ 前一日收盤）。"""
    closes = {}
    y, m, today = start.year, start.month, dt.date.today()
    while (y, m) <= (today.year, today.month):
        j = twse_json("afterTrading/STOCK_DAY", date="%04d%02d01" % (y, m), stockNo=code)
        fields = j.get("fields") or []
        ci = fields.index("收盤價") if "收盤價" in fields else 6
        for rec in j.get("data") or []:
            try:
                closes[roc_date(rec[0])] = float(rec[ci].replace(",", ""))
            except (ValueError, IndexError):
                pass   # 停牌等沒有收盤價的日子
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    days = sorted(d for d in closes if d >= start)
    if not days:
        return [], []

    divs = []
    j = twse_json("exRight/TWT49U", startDate=start.strftime("%Y%m%d"), endDate=today.strftime("%Y%m%d"))
    fields = j.get("fields") or []
    if {"資料日期", "股票代號", "權值+息值"} <= set(fields):
        di, ki, vi = fields.index("資料日期"), fields.index("股票代號"), fields.index("權值+息值")
        for rec in j.get("data") or []:
            if str(rec[ki]).strip() == code:
                try:
                    divs.append((roc_date(rec[di]), float(str(rec[vi]).replace(",", ""))))
                except ValueError:
                    pass
    divs.sort()

    pts, factor = [], 1.0
    for d in reversed(days):
        pts.append((d, closes[d], closes[d] * factor))
        for dd, v in divs:   # 這天就是除息日：更早的價格要乘上除息調整係數
            if dd == d:
                prev = [x for x in days if x < d]
                if prev:
                    factor *= 1 - v / closes[prev[-1]]
    pts.reverse()
    return pts, divs


def analyze_twse(row, years, hist, key, cached, missing):
    out = dict(row)
    code = row["Yahoo代號"].split(":", 1)[1].upper()
    if code not in TWSE_INDEX:
        out["error"] = "不支援的指數"
        return out
    ep, col = TWSE_INDEX[code]
    today = dt.date.today()
    try:
        cur = twse_month(ep, col, today.year, today.month)
        if len(cur) < 2:
            pm = (today.replace(day=1) - dt.timedelta(days=1))
            cur = twse_month(ep, col, pm.year, pm.month) + cur
    except Exception:
        cur = []
    if not cur:
        out["error"] = "查無資料"
        return out

    last_d, last_v = cur[-1]
    ends = dict(cached.get("ends", {}))  # 年底收盤值

    def end_of(y):
        if y == years[0]:
            return last_v
        if str(y) not in ends:
            try:
                dec = twse_month(ep, col, y, 12)
            except Exception:
                return None
            if not dec:
                return None
            ends[str(y)] = dec[-1][1]
        return ends[str(y)]

    done = cached.get("returns", {})
    new = year_returns([years[0]] + missing, end_of, None, None)
    out["returns"] = {str(y): (new.get(str(y)) or done.get(str(y))) for y in years
                      if new.get(str(y)) or done.get(str(y))}
    settled = {y: v for y, v in new.items() if int(y) < years[0]}
    hist[key] = {"listed": None, "from": years[-1], "returns": {**done, **settled},
                 "ends": {y: v for y, v in ends.items() if int(y) < years[0]}}

    # 近期報酬率：取各期間起點（該日或之前最後一個交易日）的指數值；指數無另外配息，v 與 s 相同
    months = {(last_d.year, last_d.month): cur}

    def month(y, m):
        if (y, m) not in months:
            try:
                months[(y, m)] = twse_month(ep, col, y, m)
            except Exception:
                months[(y, m)] = None
        return months[(y, m)]

    def value_on(t):
        for y, m in ((t.year, t.month), (add_months(t, -1).year, add_months(t, -1).month)):
            recs = [v for d, v in (month(y, m) or []) if d <= t]
            if recs:
                return recs[-1]
        return None

    out["recent"] = {}
    for k, mo, days in PERIODS:
        start = value_on(period_target(last_d, mo, days))
        r = (last_v / start - 1) * 100 if start else None
        out["recent"][k] = {"v": r, "s": r} if r is not None else {"note": "無資料"}

    close_ts = int(dt.datetime(last_d.year, last_d.month, last_d.day, 13, 30, tzinfo=TPE).timestamp())
    out.update({
        "symbol": code, "price": last_v, "chg": (last_v / cur[-2][1] - 1) * 100,
        "since": row.get("成立") or None,   # 指數的編製起始年，填在 stocks.csv「成立」欄
        "date": last_d.isoformat(), "listed": None, "除息": row.get("除息") or "無",
        "_market": {"market": "台股", "city": "台北", "ts": close_ts, "closed": True, "off": 28800},
        "_yname": row.get("名稱"),
    })
    return out


DEFAULT_YEARS = 10
CSV_PATH = os.path.join(HERE, "stocks.csv")
CSV_FIELDS = ["區", "類", "代碼", "名稱", "除息", "Yahoo代號", "成立"]
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


def build(rows, years, hist=None):
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda r: analyze(r, years, hist), rows))
    markets = {}
    for r in results:
        # 名稱留空：台股用證交所中文簡稱，否則用 Yahoo 名稱
        if not r.get("名稱"):
            r["名稱"] = (re.fullmatch(r"\d{4,6}[A-Z]?", r["代碼"]) and tw_name(r["代碼"])) or r.get("_yname") or r["代碼"]
        finish_row(r, markets)
    return {
        "years": years,
        "updated": dt.datetime.now(TPE).strftime("%Y/%m/%d %H:%M"),
        "markets": markets,
        "marketOrder": MARKET_ORDER,
        "rows": results,
    }


def write_html(payload, out=os.path.join(HERE, "returns.html")):
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
    ap.add_argument("--full", action="store_true", help="忽略 history.json，全部重算")
    ap.add_argument("--out", default=os.path.join(HERE, "returns.html"))
    args = ap.parse_args()

    hist = {} if args.full else load_hist()
    payload = build(load_rows(args.csv), get_years(args.years), hist)
    save_hist(hist)
    for r in payload["rows"]:
        print("%-8s %-12s %s" % (r["代碼"], r["名稱"], r.get("error", "OK")))
    for m in payload["markets"].values():
        print(m["text"])
    write_html(payload, args.out)
    print("已輸出", args.out)


if __name__ == "__main__":
    main()
