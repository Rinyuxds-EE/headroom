// Headroom 儲存模組：讀寫 localStorage、月份快照
// 規則見 SPEC.md 第 4.2、5 節。
// 所有讀寫都包在 try/catch 裡；資料損壞時絕不直接覆蓋。

import { addMonths } from './calc.js';

export const STORAGE_KEY = 'headroom:data';
export const CORRUPTED_PREFIX = 'headroom:corrupted:';
export const DATA_VERSION = 1;

// 取得瀏覽器的 localStorage；某些環境光是讀取 window.localStorage 就會出錯
function defaultStore() {
  return window.localStorage;
}

// ───────────── id ─────────────

// 產生唯一 id。crypto.randomUUID 只能在 https 或 localhost 使用，
// 用區網 IP（http://192.168…）在手機上測試時沒有，所以準備備用做法。
export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // 版本 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // 變體
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ───────────── 預設資料 ─────────────

// 第一次開啟 App 時的資料（SPEC 第 5 節）
// 固定支出 4 個預設項目（金額 0）；會員訂閱、自訂類別都沒有預設，由使用者自己新增
export function createDefaultData(currentMonth) {
  const fixedNames = ['孝親', '學貸', '約會', '投資'];
  return {
    version: DATA_VERSION,
    settings: {
      defaultSalary: 0,
      dailyLiving: 0,
      startMonth: currentMonth,
      lastBackupAt: null,
    },
    fixedExpenses: fixedNames.map((name, i) => ({
      id: newId(), name, amount: 0, cycle: 'monthly', dueMonth: null, order: i,
    })),
    subscriptions: [],
    installments: [],
    categories: [],
    months: {},
    entries: [],
  };
}

// 補上舊資料缺少的欄位（會直接修改 data 並回傳它）
// 會員訂閱是後來才加的，之前的資料和備份檔沒有 subscriptions，補成空的
export function normalizeData(data) {
  if (!Array.isArray(data.subscriptions)) data.subscriptions = [];
  return data;
}

// 檢查固定支出或會員訂閱的一個項目；正確回傳 null
function itemProblem(f, label) {
  if (!isObject(f) || typeof f.name !== 'string' || !isInt(f.amount)) return `${label}項目格式錯誤`;
  if (f.cycle !== 'monthly' && f.cycle !== 'yearly') return `${label}週期格式錯誤`;
  return null;
}

// ───────────── 格式檢查 ─────────────

const isInt = (v) => Number.isSafeInteger(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isMonthString = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// 檢查資料格式；正確回傳 null，錯誤回傳說明文字
export function validateData(data) {
  if (!isObject(data)) return '資料不是物件';
  if (data.version !== DATA_VERSION) return `不支援的資料版本：${data.version}`;

  const s = data.settings;
  if (!isObject(s)) return '缺少 settings';
  if (!isInt(s.defaultSalary)) return 'settings.defaultSalary 不是整數';
  if (!isInt(s.dailyLiving)) return 'settings.dailyLiving 不是整數';
  if (!isMonthString(s.startMonth)) return 'settings.startMonth 格式錯誤';

  if (!Array.isArray(data.fixedExpenses)) return 'fixedExpenses 不是陣列';
  for (const f of data.fixedExpenses) {
    const problem = itemProblem(f, '固定支出');
    if (problem) return problem;
  }

  // 會員訂閱可以沒有（舊資料），有的話要是陣列
  if (data.subscriptions !== undefined) {
    if (!Array.isArray(data.subscriptions)) return 'subscriptions 不是陣列';
    for (const f of data.subscriptions) {
      const problem = itemProblem(f, '會員訂閱');
      if (problem) return problem;
    }
  }

  if (!Array.isArray(data.installments)) return 'installments 不是陣列';
  for (const inst of data.installments) {
    if (!isObject(inst) || !isInt(inst.amountPerPeriod) || !isInt(inst.periods) || !isMonthString(inst.firstMonth)) {
      return '分期項目格式錯誤';
    }
  }

  if (!Array.isArray(data.categories)) return 'categories 不是陣列';
  for (const c of data.categories) {
    if (!isObject(c) || typeof c.name !== 'string') return '類別格式錯誤';
  }

  if (!isObject(data.months)) return 'months 不是物件';
  for (const [key, m] of Object.entries(data.months)) {
    if (!isMonthString(key) || !isObject(m)) return `月份 ${key} 格式錯誤`;
  }

  if (!Array.isArray(data.entries)) return 'entries 不是陣列';
  for (const e of data.entries) {
    if (!isObject(e) || typeof e.date !== 'string' || !isInt(e.amount)) return '記帳記錄格式錯誤';
  }

  return null;
}

// ───────────── 讀寫 ─────────────

// 讀取資料，回傳其中一種：
//   { status: 'ok', data }              正常
//   { status: 'new', data }             第一次使用（尚未儲存）
//   { status: 'corrupt', raw, error }   資料損壞，raw 是原始字串
//   { status: 'unavailable', error }    無法存取 localStorage
export function loadData(currentMonth, store) {
  let raw;
  try {
    raw = (store || defaultStore()).getItem(STORAGE_KEY);
  } catch (err) {
    return { status: 'unavailable', error: String(err && err.message || err) };
  }

  if (raw === null) return { status: 'new', data: createDefaultData(currentMonth) };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: 'corrupt', raw, error: `JSON 格式錯誤：${err.message}` };
  }

  const problem = validateData(parsed);
  if (problem) return { status: 'corrupt', raw, error: problem };

  return { status: 'ok', data: normalizeData(parsed) };
}

// 儲存資料；成功回傳 true，失敗（例如空間不足）回傳 false
export function saveData(data, store) {
  try {
    (store || defaultStore()).setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

// 把損壞的原始字串另存一份；成功回傳 true
export function preserveCorrupted(raw, store, now = new Date()) {
  try {
    (store || defaultStore()).setItem(CORRUPTED_PREFIX + now.toISOString(), raw);
    return true;
  } catch (err) {
    return false;
  }
}

// ───────────── 備份（SPEC 3.9） ─────────────

export const BEFORE_IMPORT_KEY = 'headroom:beforeImport';

// 備份檔名：headroom-backup-YYYYMMDD.json（用當地日期）
export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `headroom-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`;
}

// 產生備份檔內容；檔案裡的 lastBackupAt 就是這次備份的時間（還原後也知道是哪一次的備份）
export function serializeBackup(data, nowIso) {
  const copy = JSON.parse(JSON.stringify(data));
  copy.settings.lastBackupAt = nowIso;
  return JSON.stringify(copy, null, 2);
}

// 讀取備份檔內容並檢查格式：{ ok: true, data } 或 { ok: false, error }
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: '這不是 Headroom 的備份檔（JSON 格式錯誤）' };
  }
  const problem = validateData(parsed);
  if (problem) return { ok: false, error: `備份檔格式不正確：${problem}` };
  return { ok: true, data: normalizeData(parsed) };
}

// 匯入前先把目前的資料另存一份（只保留最近一次），萬一匯錯檔還救得回來；成功回傳 true
export function stashBeforeImport(data, store) {
  try {
    (store || defaultStore()).setItem(BEFORE_IMPORT_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

// ───────────── 清除所有資料 ─────────────

// 刪除所有 Headroom 的 localStorage 項目（headroom: 開頭的都算，包含損壞資料備份、匯入前備份、上次選的類別）
// 成功回傳 true
export function clearAllData(store) {
  try {
    const s = store || defaultStore();
    const keys = [];
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (key && key.startsWith('headroom:')) keys.push(key);
    }
    keys.forEach((key) => s.removeItem(key));
    return true;
  } catch (err) {
    return false;
  }
}

// ───────────── 月份資料 ─────────────

// 取得某個月的資料，沒有就建立一個空的
export function ensureMonth(data, month) {
  if (!data.months[month]) {
    data.months[month] = { salary: null, extraIncome: [], balance: null, snapshot: null };
  }
  return data.months[month];
}

// 凍結月份快照（SPEC 4.2）：替「開始使用月份到上個月」之間還沒有快照的月份，
// 存下當下的預設月薪、每日生活費、固定支出。
// 會直接修改 data，回傳這次凍結了幾個月。可以重複執行：已有快照的月份不會被覆蓋。
export function freezeSnapshots(data, currentMonth) {
  const start = data.settings.startMonth;
  let count = 0;

  for (let m = start; m < currentMonth; m = addMonths(m, 1)) {
    const monthData = ensureMonth(data, m);
    if (monthData.snapshot) continue;

    const copyItems = (items) => [...(items || [])]
      .sort((a, b) => a.order - b.order)
      .map((f) => ({ name: f.name, amount: f.amount, cycle: f.cycle, dueMonth: f.dueMonth }));
    monthData.snapshot = {
      defaultSalary: data.settings.defaultSalary,
      dailyLiving: data.settings.dailyLiving,
      fixedExpenses: copyItems(data.fixedExpenses),
      subscriptions: copyItems(data.subscriptions),
    };
    count += 1;
  }

  return count;
}

// 凍結檢查（SPEC 4.2 時機 1、2、4）：用「現在的月份」凍結，並回報月份是否跟上次檢查時不同
// 回傳 { frozen: 凍結了幾個月, monthChanged: 月份是否改變 }
export function checkMonth(data, lastCheckedMonth, nowMonth) {
  const frozen = freezeSnapshots(data, nowMonth);
  return { frozen, monthChanged: lastCheckedMonth !== nowMonth };
}

// 修改設定（SPEC 4.2「任何設定在儲存之前」與時機 3）：
//   1. 先用現在的月份凍結，避免新設定改到已經結束的月份
//   2. 月份沒變才套用修改（月份變了代表畫面上的「本月」是舊的，這次修改不套用）
//   3. 套用後再凍結一次（例如開始使用月份往前調，新納入的月份要馬上凍結）
// 回傳 { applied: 是否套用了修改, monthChanged, frozen: 總共凍結了幾個月 }
export function applyChange(data, lastCheckedMonth, nowMonth, mutator) {
  const before = checkMonth(data, lastCheckedMonth, nowMonth);
  if (before.monthChanged) {
    return { applied: false, monthChanged: true, frozen: before.frozen };
  }
  mutator(data);
  const after = freezeSnapshots(data, nowMonth);
  return { applied: true, monthChanged: false, frozen: before.frozen + after };
}
