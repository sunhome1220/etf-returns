"""build.py 的計算測試（不連網）：python -m unittest discover tests
fixtures/calc_cases.json 同時給網頁端測試（web_test.js）用，確保 Python 與瀏覽器的算法一致。"""
import datetime as dt
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build  # noqa: E402

CASES = json.load(open(os.path.join(HERE, "fixtures", "calc_cases.json"), encoding="utf-8"))


def load(case):
    pts = [(dt.date.fromisoformat(d), c, a) for d, c, a in case["pts"]]
    divs = [(dt.date.fromisoformat(d), v) for d, v in case["divs"]]
    return pts, divs


def close(t, got, want, path=""):
    """巢狀 dict 的數值比對（允許浮點誤差）"""
    if isinstance(want, dict):
        t.assertEqual(set(got), set(want), path)
        for k in want:
            close(t, got[k], want[k], path + "." + k)
    elif isinstance(want, (int, float)):
        t.assertAlmostEqual(got, want, places=9, msg=path)
    else:
        t.assertEqual(got, want, path)


class RiskStats(unittest.TestCase):
    def test_hand_case(self):
        # 高點 120、低點 80、現價 100：距高點 −16.67%、距低點 +25%、近一年最大回撤（120→80）−33.33%
        r = build.risk_stats(*load(CASES["A"]))
        self.assertAlmostEqual(r["hi52"]["s"], -100 / 6, places=9)
        self.assertAlmostEqual(r["lo52"]["s"], 25, places=9)
        self.assertAlmostEqual(r["mdd1"]["v"], -100 / 3, places=9)
        self.assertEqual(r["mdd3"], {"note": "上市未滿"})

    def test_dividend_case(self):
        # 不再投入把高點之後的除息加回：從 3/1（90）到現在（96＋5）＝ +12.22%；再投入用還原價 96 ÷ 85.5 − 1
        r = build.risk_stats(*load(CASES["B"]))
        self.assertAlmostEqual(r["lo52"]["s"], (96 + 5) / 90 * 100 - 100, places=9)
        self.assertAlmostEqual(r["lo52"]["v"], 96 / 85.5 * 100 - 100, places=9)

    def test_fixture_regression(self):
        for k, case in CASES.items():
            pts, divs = load(case)
            close(self, build.risk_stats(pts, divs), case["expect"]["risk"], k + ".risk")
            close(self, build.recent_returns(pts, divs), case["expect"]["recent"], k + ".recent")


class Parsing(unittest.TestCase):
    def test_parse_etf_nav(self):
        j = {"a1": [{"msgArray": [
            {"a": "0050", "e": 95.1, "f": 95.3, "g": -0.21, "h": 94.8, "i": "20261126", "j": "13:30:00"},
            {"a": "00981A", "f": "", "h": "22.1", "i": "20261126", "j": "10:00:00"},   # 沒有預估淨值時用前一營業日淨值
            {"a": "X", "f": "", "h": ""},
        ]}]}
        self.assertEqual(build.parse_etf_nav(j), {
            "0050": {"v": 95.3, "prev": 94.8, "d": "20261126", "t": "13:30:00"},
            "00981A": {"v": 22.1, "prev": 22.1, "d": "20261126", "t": "10:00:00"},
        })

    def test_is_compare_multi_category(self):
        self.assertTrue(build.is_compare({"代碼": "00984A", "類": "主動、高息"}))
        self.assertTrue(build.is_compare({"代碼": "0050", "類": "市值"}))   # 基準
        self.assertFalse(build.is_compare({"代碼": "0056", "類": "高息"}))

    def test_stamp_versions(self):
        html = '<script src="app.js"></script><link rel="stylesheet" href="returns.css?v=old"><script src="nope.js"></script>'
        out = build.stamp_versions(html)
        self.assertRegex(out, r'src="app\.js\?v=[0-9a-f]{8}"')
        self.assertRegex(out, r'href="returns\.css\?v=[0-9a-f]{8}"')
        self.assertNotIn("v=old", out)
        self.assertIn('src="nope.js"', out)   # 不存在的檔案不動


class Crypto(unittest.TestCase):
    def test_market_name_and_text(self):
        for tz in ("UTC", "Etc/UTC"):
            self.assertEqual(build.MARKETS[tz][0], "加密貨幣")
        self.assertIn("加密貨幣", build.MARKET_ORDER)
        txt = build.market_text({"market": "加密貨幣", "city": "UTC", "ts": 1793000000, "closed": False, "off": 0})
        self.assertIn("24 小時", txt)   # 沒有收盤，不寫盤中／收盤
        self.assertNotIn("盤中", txt)
        self.assertNotIn("收盤", txt)
        self.assertIn("收盤", build.market_text({"market": "台股", "city": "台北", "ts": 1793000000, "closed": True, "off": 28800}))

    def test_vol_uses_365_for_daily_series(self):
        # 案例 D：每天都有價（含週末）→ 年化用 365；股票案例 C（只有交易日）仍用 252
        pts, divs = load(CASES["D"])
        end = pts[-1][0]
        start_t = build.add_months(end, -12)
        si = max(i for i, p in enumerate(pts) if p[0] <= start_t)
        rs = [pts[i][2] / pts[i - 1][2] - 1 for i in range(si + 1, len(pts))]
        mean = sum(rs) / len(rs)
        sd = (sum((x - mean) ** 2 for x in rs) / (len(rs) - 1)) ** .5
        self.assertAlmostEqual(build.risk_stats(pts, divs)["vol"]["v"], sd * 365 ** .5 * 100, places=9)
        pts_c, divs_c = load(CASES["C"])
        self.assertLess(build.risk_stats(pts_c, divs_c)["vol"]["v"], 30)   # 股票維持 √252（C 約 18.7%）


class StocksCsv(unittest.TestCase):
    def test_categories(self):
        rows = build.load_rows()
        known = {"主動", "市值", "高息", "主題", "槓桿", "反一", "金融", "動能", "中小", "加密貨幣",
                 "個股-科", "個股-穩", "報酬指數", "加權指數"}
        codes = [r["代碼"] for r in rows]
        self.assertEqual(len(codes), len(set(codes)), "代碼重複")
        for r in rows:
            tags = r["類"].split("、")
            self.assertTrue(1 <= len(tags) <= 3, r["代碼"])
            self.assertLessEqual(set(tags), known, r["代碼"])
            self.assertTrue(r["名稱"], r["代碼"] + " 名稱空白")


class Compare(unittest.TestCase):
    def test_build_compare_alignment(self):
        d = dt.date
        series = {
            "0050": ([(d(2026, 1, 5), 100, 100), (d(2026, 1, 6), 101, 101), (d(2026, 1, 8), 102, 102)], [],
                     {"名稱": "元大台灣50", "類": "市值", "since": "2003", "nav": None}),
            "00999A": ([(d(2026, 1, 6), 10, 9.5), (d(2026, 1, 8), 10.5, 10.5)], [(d(2026, 1, 7), 0.5)],
                       {"名稱": "主動", "類": "主動、高息", "since": "2026-01-06", "nav": {"v": 10.4}}),
        }
        c = build.build_compare(series, [(d(2026, 1, 5), 50000), (d(2026, 1, 8), 50500)])
        self.assertEqual(c["dates"], ["2026-01-05", "2026-01-06", "2026-01-08"])
        f = {x["代碼"]: x for x in c["funds"]}
        self.assertEqual(f["00999A"]["o"], 1)
        self.assertEqual(f["00999A"]["c"], [10, 10.5])
        self.assertEqual(f["00999A"]["d"], [[2, 0.5]])          # 1/7 除息對到下一個交易日 1/8
        self.assertEqual(c["bench"]["IR0001"]["v"], [50000, 50000, 50500])   # 缺的日子沿用前一天


if __name__ == "__main__":
    unittest.main()
