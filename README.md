# StockData

供 StockExplorer 讀取的公開每日收盤價 JSON，來源為臺灣證券交易所與證券櫃檯買賣中心。

固定網址：`https://raw.githubusercontent.com/MelodyPan/StockData/main/closing-prices.json`

大盤分析：`market-indices.json` 提供加權與櫃買指數的日開高低收、漲跌點數、成交股數及成交金額。來源為證交所 MI_5MINS_HIST／FMTQIK、櫃買 indexInfo/inx／tradingIndex 月報。指數單位為點、成交量為股、成交金額為新台幣元；櫃買月報的張數與仟元先乘 1,000 正規化。兩市場依各自官方成交統計範圍列示。

`npm run refresh:market` 首次回補最近 12 個月份，日常重抓當月及前月並保留最近 12 個月份；`npm run backfill:market` 可重抓全部 12 個月份。休市不補造資料，日期落後今日時明示尚無今日資料，不把抓取時間當交易日期。落後同次個股已知交易日、兩份報表不一致或來源異常均視為失敗；單市場保留舊資料，兩市失敗不覆寫檔案。大盤更新失敗仍會先提交可用個股資料，然後明確讓 workflow 顯示失敗，保留手動重試入口。

GitHub Actions 使用 UTC 排程 `0 8 * * 1-5`，換算為台灣時間每週一至週五 16:00 執行一次；不依賴 `timezone` 覆寫。可在 Actions 手動執行 Update official closing prices。排程與快取可能延後，請以 JSON 內的交易日期為準。

Node.js 22，不需要安裝依賴：

```sh
npm test
npm run refresh
```

資料包含上市／上櫃全部可用代碼，不儲存個人關注清單。單市場失敗時保留有效舊資料及原取得時間；兩市場都失敗則不提交；首次更新必須兩市場成功。官方日期倒退時保留較新資料。價格缺值為 null。

此專案不需 GitHub Pages、Cloudflare 或額外部署金鑰。Actions 使用僅限此儲存庫的 GITHUB_TOKEN 寫入 JSON；分支規則須允許該流程提交。公開儲存庫的定時 workflow 長期無活動可能被 GitHub 停用，請留意 Actions 狀態。

歷史資料：`history/{tse|otc}/{code}.json`，包含原始（未還原權息）日開、高、低、收與成交股數，來源為證交所 MI_INDEX 與櫃買中心 dailyQuotes 官方日期報表。涵蓋一般上市櫃股票、特別股及 0 開頭基金／指數商品；排除權證。沒有完整 OHLC 的交易日不補造價格。個股檔內列出實際日期範圍，不保證每檔都有六個月資料。

`npm run refresh:history` 每次查最近三個平日並補齊最多 12 個日期，`npm run backfill:history` 可一次回補近六個月。`history/index.json` 記錄各市場日期的成功／休市狀態，可中斷後接續。失敗日期仍保留原資料，後續補齊；歷史更新失敗不會停止原有收盤價發布。所有資料依官方公開全市場報表建立，不讀取或上傳個人 Drive 清單。

維護來源在 MyExplorer。首次發布或更新抓價程式時，使用 MyExplorer 的 `npm run build:stock-data` 匯出檔案，再合併至本專案；保留遠端歷史與最近 JSON，不要強制推送。日常更新僅改 JSON，不建置或發布 StockExplorer。

除權息預告：`npm run refresh:dividends` 讀取證交所 TWT48U_ALL 與櫃買中心 tpex_exright_prepost，產生 `ex-dividends.json`，並整合既有平日排程與手動執行。現金股利為元／股，配股率為原始比例，前端顯示百分比；未公告數字為 null，與 0 分開。每次成功回應完整替換該市場預告，避免保留官方已撤除事件。單市場失敗保留上次成功資料及原更新時間；初次失敗市場以明確錯誤及空表表示未知，兩市場皆失敗不覆寫 JSON。前端僅顯示台北當日或以後最近一筆公告，無公告不顯示卡片；失敗不當作無公告。實際配發以公司公告為準。
