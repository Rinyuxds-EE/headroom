# Headroom 部署教學（GitHub Pages）

這份教學用 **git 推送**（由 Claude 執行指令）。
做完之後，網址會是 `https://你的帳號.github.io/headroom/`，用 iPhone 的 Safari 打開，再加入主畫面就能像 App 一樣使用。

---

## 哪些檔案會公開

GitHub Pages 免費版的儲存庫（repository）必須是**公開的**，任何人都看得到裡面的檔案。

| 檔案 | 會不會上傳 | 說明 |
|---|---|---|
| `index.html`、`styles.css`、`manifest.webmanifest`、`sw.js` | ✅ 會 | App 本體 |
| `js/` 資料夾、`icons/` 資料夾 | ✅ 會 | App 本體 |
| `DEPLOY.md`、`.gitignore` | ✅ 會 | 這份教學、排除清單 |
| `SPEC.md`、`CLAUDE.md`、`tests/` 資料夾 | ❌ 不會 | 列在 `.gitignore` 裡。規格書和測試裡有範例金額和支出名稱，不公開 |

> 你的**記帳資料不會**被上傳。資料只存在你的手機裡，GitHub 上只有程式。
> 程式本身會看得到預設的固定支出名稱（孝親、學貸、約會、投資），這些沒辦法隱藏。
>
> ⚠️ 因為 `SPEC.md`、`CLAUDE.md`、`tests/` 不在 git 裡，它們**只存在你的電腦上**，請自己另外備份（例如複製一份到 iCloud 雲碟）。

---

## 第 1 步：建立儲存庫

1. 登入 GitHub，按右上角的 **＋** → **New repository**。
2. **Repository name** 填 `headroom`（全部小寫，網址會用到）。
3. 選 **Public**。
4. 下面的「Add a README file」、「.gitignore」、「license」等選項**都不要勾**（儲存庫要是空的）。
5. 按 **Create repository**，把頁面上顯示的網址（`https://github.com/你的帳號/headroom.git`）告訴 Claude。

## 第 2 步：推送檔案

Claude 會執行 `git init`、`git commit`、`git push`。
第一次推送時，Windows 可能會跳出 GitHub 登入視窗，照畫面登入就好（帳號密碼只會交給 GitHub，不會經過 Claude）。

## 第 3 步：開啟 GitHub Pages

1. 在儲存庫頁面上方，點 **Settings**（齒輪圖示）。
2. 左邊選單找到 **Pages**。
3. **Build and deployment** → **Source** 選 **Deploy from a branch**。
4. **Branch** 選 **main**，旁邊的資料夾選 **/ (root)**，按 **Save**。
5. 等 1～5 分鐘。可以點上方的 **Actions** 分頁，看到「pages build and deployment」出現綠色勾勾就好了。
6. 回到 **Settings → Pages**，最上面會顯示網址：`https://你的帳號.github.io/headroom/`。

## 第 4 步：電腦上先確認

用電腦的瀏覽器打開那個網址，應該看到 Headroom 的首頁。
（測試頁沒有上傳；要跑測試請在電腦上用 Live Server 打開 `tests/calc.test.html`。）

## 第 5 步：裝到 iPhone

1. 用 iPhone 的 **Safari** 打開網址（一定要用 Safari）。
2. 按下方的 **分享** 按鈕（方框加向上箭頭）→ 往下找 **加入主畫面** → **新增**。
3. 主畫面會出現 Headroom 的圖示（深色底、綠色圓環）。**之後都從這個圖示打開。**

## 第 6 步：把資料搬過去

⚠️ **很重要**：iPhone 上，「主畫面的 App」和「Safari 分頁」的資料是**分開存的**，之前在 `http://電腦IP:5500` 測試時記的資料也不會自動跑過來。

1. 從主畫面打開 Headroom → **設定** → **匯入備份**。
2. 選你之前存到 iCloud 雲碟的 `headroom-backup-日期.json`。
3. 確認後，資料就回來了。

---

## M7 驗收清單

在 iPhone 上，**從主畫面的圖示打開**，逐項確認：

- [ ] **全螢幕**：沒有 Safari 的網址列；最上面的瀏海、最下面的橫條都沒有擋到文字或按鈕。
- [ ] **圖示和名稱**：主畫面顯示 Headroom 的圖示和名稱。
- [ ] **匯入還原**（M6 尚未確認的項目）：先匯出一份備份 → 改月薪、刪一筆記錄 → 匯入剛剛的備份 → 月薪和記錄都恢復。
- [ ] **匯出用分享選單**（M6 因為 http 沒測到的項目）：設定 → 匯出備份 → 出現 iOS 分享選單 → **儲存到檔案** → 選 **iCloud 雲碟** → 打開「檔案」App 確認有 `headroom-backup-日期.json`。
- [ ] **分享選單按取消**：上次備份時間**不會**更新。
- [ ] **清除所有資料**（先確定有備份！）：
  - [ ] 第一次確認按取消 → 什麼都沒變。
  - [ ] 第二次輸入錯字 → 沒有清除，有說明。
  - [ ] 正確輸入「清除」→ **出現分享選單**（自動備份）→ 存好後資料清空、回到首頁、開始使用月份是本月。
  - [ ] 在自動備份的分享選單按取消 → 沒有清除。
  - [ ] 測完用「匯入備份」把資料還原。
- [ ] **離線**：開**飛航模式** → 從主畫面打開 → 畫面正常、可以記一筆 → 完全關掉 App 再打開，剛記的還在 → 關掉飛航模式。
- [ ] **重新開機後**：重開 iPhone，從主畫面打開，資料都還在。

---

## 之後要更新 App 時

1. Claude 改完程式後，會把 `sw.js` 裡的版本號（`CACHE_VERSION`）加 1。**沒改版本號的話，手機會一直用舊的檔案。**
2. 請 Claude commit 並 push（推送前會用 `git status` 確認 `SPEC.md`、`CLAUDE.md`、`tests/` 沒有被加進去）。
3. 等 1～5 分鐘部署完成。
4. iPhone 上打開 App，會在背景下載新版本，並提示「已下載新版本，下次開啟 App 時生效」。**完全關掉 App**（從下往上滑、把它滑掉）再打開，就是新版本了。
