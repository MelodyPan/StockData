# StockData

供 StockExplorer 讀取的公開每日收盤價 JSON，來源為臺灣證券交易所與證券櫃檯買賣中心。

固定網址：`https://raw.githubusercontent.com/MelodyPan/StockData/main/closing-prices.json`

GitHub Actions 每週一至週五台灣時間 16:45 執行一次；可在 Actions 手動執行 Update official closing prices。排程與快取可能延後，請以 JSON 內的交易日期為準。

Node.js 22，不需要安裝依賴：

```sh
npm test
npm run refresh
```

資料包含上市／上櫃全部可用代碼，不儲存個人關注清單。單市場失敗時保留有效舊資料及原取得時間；兩市場都失敗則不提交；首次更新必須兩市場成功。官方日期倒退時保留較新資料。價格缺值為 null。

此專案不需 GitHub Pages、Cloudflare 或額外部署金鑰。Actions 使用僅限此儲存庫的 GITHUB_TOKEN 寫入 JSON；分支規則須允許該流程提交。公開儲存庫的定時 workflow 長期無活動可能被 GitHub 停用，請留意 Actions 狀態。

維護來源在 MyExplorer。首次發布或更新抓價程式時，使用 MyExplorer 的 `npm run build:stock-data` 匯出檔案，再合併至本專案；保留遠端歷史與最近 JSON，不要強制推送。日常更新僅改 JSON，不建置或發布 StockExplorer。
