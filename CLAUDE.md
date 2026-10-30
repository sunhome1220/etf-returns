# 投資工具・ETF 含息報酬率

台股／ETF 各年度與近期含息報酬率網站（GitHub Pages），可加入手機主畫面當 App。使用者以繁體中文溝通，回覆一律用繁體中文。

## 檔案

| 檔案 | 用途 |
|---|---|
| `stocks.csv` | 預設清單。欄位：區,類,代碼,名稱,除息,Yahoo代號,成立 |
| `build.py` | 排程執行：抓 Yahoo（缺歷史時改用證交所）算報酬率，輸出 `returns.html`，已結束年度記在 `history.json` |
| `template.html` | 報酬率頁的原始碼；`build.py` 把資料塞進 `/*DATA*/null` 產生 `returns.html` |
| `returns.html` | 產生出來的頁面（含資料）。**改 `template.html` 時要同步改 `returns.html`**，否則要等下次排程才生效 |
| `app.js` | 各頁共用：`CHANGELOG`（更新內容通知）、PWA 安裝、service worker 註冊 |
| `watchlist.html` / `watchlist.js` | 「我的追蹤清單」；使用者自訂項目存在瀏覽器 |
| `worker.js` | Cloudflare Worker（資料代理），網址在 `proxy.txt`。**使用者要自己到 Cloudflare 貼上部署**，改了要附完整程式碼請他部署 |
| `.github/workflows/update.yml` | 「更新報酬率」：平日台北 15:17、06:17（常延遲數小時），可手動觸發 |

## 每次改動的規則

- **新功能或清單變動**：在 `app.js` 的 `CHANGELOG` 最前面加一筆（`id` 遞增、`date` 為今天），使用者下次打開會看到「網站更新了」。
- **`stocks.csv`**：
  - 名稱可留空：台股會自動用證交所中文簡稱，其他用 Yahoo 名稱；確認後再把名稱寫回 CSV（「我的追蹤清單」頁直接讀 CSV）。
  - 「除息」「成立」欄有填就以填的為準（Yahoo 台股歷史只到 2000／2008 年，舊標的的成立年要手動填）。
  - 含逗號的值（如 `1,4,7,10`）要加引號；用 Python `csv` 模組改，不要手打。
- 兩種報酬率：`v`＝股息再投入（還原價），`s`＝股息不再投入（預設）。新增計算時兩種都要算，Python（`build.py`）與瀏覽器（`template.html` 的 `analyzeJS`／`liveQuote`）邏輯要一致。
- 手機寬度（< 600px）要能一打開就看到報酬率欄；新增欄位時考慮手機預設隱藏（`MOBILE_HIDDEN`）。

## 流程

1. 在指定分支開發，commit 訊息用繁體中文。
2. 需要真實資料驗證時，**對分支**觸發「更新報酬率」（workflow_dispatch，ref＝分支），完成後 `git pull` 檢查 `returns.html` 裡的 `DATA`。
3. 開 PR，說明改了什麼、怎麼驗證；**使用者說「合併」才合併**。
4. 合併時若 `returns.html` 和 main 的排程更新衝突：保留分支版本，合併後對 main 再觸發一次「更新報酬率」。
5. 需要時合併後對 main 觸發「更新報酬率」，並回報結果（例：新標的的名稱、除息、今年報酬率）。

## 測試環境限制

雲端工作環境**連不到 Yahoo、證交所與 Cloudflare Worker**：
- Python：用 monkeypatch 模擬 `fetch_chart`、`twse_json` 等測試計算。
- 網頁：用 `python3 -m http.server` 起本機伺服器，Playwright（`playwright-core`，Chromium 在 `/opt/pw-browsers/chromium`，需 `--headless=new`）以 `route` 攔截 `**/chart/**`、`**/mis/**` 回傳模擬資料。
- 真實資料只能靠 GitHub Actions 上的「更新報酬率」驗證。
