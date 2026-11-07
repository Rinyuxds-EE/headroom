// 備份匯出、匯入、清除所有資料（SPEC 3.9）
// 匯出：優先用 iOS 分享選單（可以存到「檔案」App 的 iCloud 雲碟），不支援就下載
// 匯入：選 JSON 檔 → 檢查格式 → 確認後覆蓋（覆蓋前先另存目前的資料）
// 清除：確認兩次（第二次要輸入「清除」）→ 自動匯出備份 → 備份成功才清除

import { backupFileName, serializeBackup, parseBackup } from '../storage.js';
import { toast } from './dom.js';

// 匯出備份，回傳結果：'shared'（分享成功）、'downloaded'（改用下載）、'cancelled'（使用者取消）、'failed'
// 必須在按鈕的 click 裡呼叫，而且呼叫前不能有 await（iOS 只允許在使用者點擊的當下叫出分享選單）
// options.strict = true：分享選單被瀏覽器擋下時不改用下載，直接回傳 'failed'
//   （清除資料時用，避免「看起來下載了、其實沒存到」就把資料清掉）
export async function exportBackup(ctx, { strict = false } = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const name = backupFileName(now);
  const text = serializeBackup(ctx.getData(), nowIso);
  const file = new File([text], name, { type: 'application/json' });

  const markDone = () => {
    ctx.commit((d) => { d.settings.lastBackupAt = nowIso; });
    ctx.refresh();
  };

  // 優先：分享選單
  let canShareFile = false;
  if (navigator.canShare && navigator.share) {
    try {
      canShareFile = navigator.canShare({ files: [file] });
    } catch (err) {
      canShareFile = false;
    }
  }
  if (canShareFile) {
    try {
      await navigator.share({ files: [file], title: name });
      markDone();
      toast('已匯出備份');
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') {
        toast('已取消匯出');
        return 'cancelled';
      }
      if (strict) return 'failed';
      // 其他錯誤：改用下載
    }
  }

  // 備用：下載連結
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markDone();
    toast('已下載備份檔');
    return 'downloaded';
  } catch (err) {
    toast('匯出失敗', 'error');
    return 'failed';
  }
}

// 匯入備份檔。file 是使用者選的檔案
export async function importBackupFile(ctx, file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    alert('讀取檔案失敗');
    return;
  }

  const result = parseBackup(text);
  if (!result.ok) {
    alert(result.error);
    return;
  }

  const imported = result.data;
  const when = imported.settings.lastBackupAt
    ? new Date(imported.settings.lastBackupAt).toLocaleString('zh-TW')
    : '不明';
  const message = `匯入「${file.name}」？\n\n`
    + `備份時間：${when}\n`
    + `記帳記錄：${imported.entries.length} 筆\n\n`
    + '目前的資料會被覆蓋（App 會先另存一份目前的資料）。';
  if (!confirm(message)) return;

  if (ctx.replaceData(imported)) toast('已匯入備份');
}

// 清除所有資料（SPEC 3.9）。必須在按鈕的 click 裡呼叫
// 兩次確認都是同步的對話框，所以接著叫出分享選單時仍算是「使用者點擊的當下」
export async function clearAllWithBackup(ctx) {
  const first = confirm('確定要清除所有資料嗎？\n\n'
    + '所有設定、記帳記錄、帳戶餘額都會刪除，回到第一次開啟 App 的狀態。\n'
    + '清除前會先自動匯出一份備份。');
  if (!first) return;

  const word = prompt('這個動作無法復原。\n請輸入「清除」兩個字確認：');
  if (word === null) return;
  if (word.trim() !== '清除') {
    alert('輸入的不是「清除」，沒有清除任何資料。');
    return;
  }

  const status = await exportBackup(ctx, { strict: true });
  if (status !== 'shared' && status !== 'downloaded') {
    alert(status === 'cancelled'
      ? '備份已取消，為了保護資料，沒有清除。'
      : '自動備份沒有成功，為了保護資料，沒有清除。請先用「匯出備份」存一份，再試一次。');
    return;
  }

  if (ctx.resetAll()) toast('已清除所有資料');
}
