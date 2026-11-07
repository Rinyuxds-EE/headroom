// Headroom 計算模組
// 所有計算都是純函式：只看傳進來的參數，不讀寫畫面或 localStorage。
// 規則見 SPEC.md 第 4 節。金額一律是整數。

// ───────────── 日期與月份工具 ─────────────

// 把 "YYYY-MM" 拆成 { year, month }（month 是 1–12）
function parseMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  return { year, month: mon };
}

// 補零成兩位數
function pad2(n) {
  return String(n).padStart(2, '0');
}

// 某個月有幾天，例如 "2026-11" → 30、"2028-02" → 29
export function daysInMonth(month) {
  const { year, month: mon } = parseMonth(month);
  // 下個月的第 0 天 = 這個月的最後一天
  return new Date(year, mon, 0).getDate();
}

// 月份加減，例如 addMonths("2026-12", 1) → "2027-01"
export function addMonths(month, n) {
  const { year, month: mon } = parseMonth(month);
  const total = year * 12 + (mon - 1) + n;
  const newYear = Math.floor(total / 12);
  const newMonth = total - newYear * 12 + 1;
  return `${newYear}-${pad2(newMonth)}`;
}

// 兩個月份相差幾個月（to − from），例如 ("2026-10", "2026-12") → 2
export function monthDiff(from, to) {
  const a = parseMonth(from);
  const b = parseMonth(to);
  return (b.year * 12 + b.month) - (a.year * 12 + a.month);
}

// 從日期 "YYYY-MM-DD" 取出月份 "YYYY-MM"
export function monthOf(date) {
  return date.slice(0, 7);
}

// 把 Date 物件轉成當地時間的 "YYYY-MM-DD"
// （不用 toISOString，因為那是 UTC 時間，台灣早上 8 點前會變成前一天）
export function toDateString(dateObj) {
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
}

// ───────────── 金額 ─────────────

// 把使用者輸入的文字轉成金額（0 以上的整數），可以有千分位逗號
// 不合法時回傳 null
export function parseAmount(text) {
  const s = String(text).trim().replace(/,/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

// 金額加千分位，例如 -1500 → "-1,500"
export function formatAmount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ───────────── 固定支出 ─────────────

// 年繳項目每月攤提的金額：round(金額 ÷ 12)
export function yearlyMonthly(amount) {
  return Math.round(amount / 12);
}

// 單一固定支出項目每月要扣多少
export function fixedItemMonthly(item) {
  return item.cycle === 'yearly' ? yearlyMonthly(item.amount) : item.amount;
}

// 固定支出合計
export function fixedTotal(fixedExpenses) {
  return fixedExpenses.reduce((sum, item) => sum + fixedItemMonthly(item), 0);
}

// 這個月要繳費的年繳項目（給首頁提醒用）
export function yearlyDueThisMonth(fixedExpenses, month) {
  const { month: mon } = parseMonth(month);
  return fixedExpenses.filter((item) => item.cycle === 'yearly' && item.dueMonth === mon);
}

// ───────────── 分期 ─────────────

// 這筆分期在這個月扣多少；這個月不在扣款期間就回傳 0
export function installmentAmountForMonth(inst, month) {
  const k = monthDiff(inst.firstMonth, month); // 第 k+1 期
  if (k < 0 || k >= inst.periods) return 0;
  const overrides = inst.overrides || {};
  return month in overrides ? overrides[month] : inst.amountPerPeriod;
}

// 這筆分期到了這個月是否已經繳完（最後一期已經過了）
export function isInstallmentFinished(inst, month) {
  return monthDiff(inst.firstMonth, month) >= inst.periods;
}

// 本月分期合計
export function installmentsTotal(installments, month) {
  return installments.reduce((sum, inst) => sum + installmentAmountForMonth(inst, month), 0);
}

// ───────────── 月份設定（快照或目前設定） ─────────────

// 取得某個月計算要用的設定：有快照就用快照，沒有就用目前設定（SPEC 4.2）
export function resolveMonthConfig(data, month) {
  const monthData = (data.months && data.months[month]) || {};
  const snapshot = monthData.snapshot || null;
  const source = snapshot
    ? { defaultSalary: snapshot.defaultSalary, dailyLiving: snapshot.dailyLiving, fixedExpenses: snapshot.fixedExpenses }
    : { defaultSalary: data.settings.defaultSalary, dailyLiving: data.settings.dailyLiving, fixedExpenses: data.fixedExpenses };

  // 該月手動設定的月薪優先；null 就用預設月薪
  const salary = monthData.salary != null ? monthData.salary : source.defaultSalary;

  return {
    salary,
    dailyLiving: source.dailyLiving,
    fixedExpenses: source.fixedExpenses || [],
    extraIncome: monthData.extraIncome || [],
  };
}

// ───────────── 記帳加總 ─────────────

// 把某個月的記帳分成生活費、彈性、各自訂類別加總
export function sumEntries(entries, categories, month) {
  let living = 0;
  let flex = 0;
  const byCategory = new Map(); // categoryId → 金額

  for (const entry of entries) {
    if (monthOf(entry.date) !== month) continue;
    if (entry.kind === 'living') living += entry.amount;
    else if (entry.kind === 'flex') flex += entry.amount;
    else if (entry.kind === 'category') {
      byCategory.set(entry.categoryId, (byCategory.get(entry.categoryId) || 0) + entry.amount);
    }
  }

  // 依類別清單的順序輸出（含已封存的類別）
  const categorySpent = [];
  for (const cat of categories) {
    if (byCategory.has(cat.id)) {
      categorySpent.push({ id: cat.id, name: cat.name, amount: byCategory.get(cat.id) });
      byCategory.delete(cat.id);
    }
  }
  // 理論上不會發生（類別不能刪除），但資料異常時仍然要算進去，不能讓錢消失
  for (const [id, amount] of byCategory) {
    categorySpent.push({ id, name: '（未知類別）', amount });
  }

  return { living, flex, categorySpent };
}

// ───────────── 記帳記錄（明細頁、記帳面板） ─────────────

// 這個類別在任何月份是否有記錄（有記錄就只能封存，不能刪除）
export function categoryHasEntries(entries, categoryId) {
  return entries.some((e) => e.kind === 'category' && e.categoryId === categoryId);
}

// 星期幾，例如 "2026-11-07" → "六"
export function weekdayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return '日一二三四五六'[new Date(y, m - 1, d).getDay()];
}

// 檢查記帳日期（SPEC 3.6）；可以用回傳 null，不行回傳原因
// originalDate：編輯舊記錄時原本的日期；沒改日期就一律允許（即使開始使用月份後來改晚了）
export function entryDateProblem(date, today, startMonth, originalDate = null) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '日期格式錯誤';
  const [y, m, d] = date.split('-').map(Number);
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return '日期不存在';
  if (date === originalDate) return null;
  if (date > today) return '日期不能是未來的日子';
  if (date < `${startMonth}-01`) return `日期不能早於開始使用月份（${startMonth}），可到設定修改`;
  return null;
}

// 篩選某個月的記錄；filter 是 'all'、'living'、'flex' 或 'category:<類別 id>'
export function filterEntries(entries, month, filter = 'all') {
  return entries.filter((e) => {
    if (monthOf(e.date) !== month) return false;
    if (filter === 'all') return true;
    if (filter === 'living' || filter === 'flex') return e.kind === filter;
    if (filter.startsWith('category:')) return e.kind === 'category' && e.categoryId === filter.slice(9);
    return false;
  });
}

// 依日期分組並算當日小計，日期由新到舊；同一天裡後記的排前面
// 回傳 [{ date, total, entries }]
export function groupEntriesByDay(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    if (ca !== cb) return ca < cb ? 1 : -1;
    return 0;
  });

  const groups = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) {
      last.entries.push(entry);
      last.total += entry.amount;
    } else {
      groups.push({ date: entry.date, total: entry.amount, entries: [entry] });
    }
  }
  return groups;
}

// 明細頁可以切換的月份範圍：從「開始使用月份」和「最早一筆記錄的月份」中較早的，到本月
export function entryMonthRange(entries, startMonth, currentMonth) {
  let min = startMonth;
  for (const e of entries) {
    const m = monthOf(e.date);
    if (m < min) min = m;
  }
  return { min: min < currentMonth ? min : currentMonth, max: currentMonth };
}

// ───────────── 帳戶餘額（SPEC 3.8） ─────────────

// 某個月的帳戶餘額，沒輸入是 null
export function monthBalance(data, month) {
  const m = data.months && data.months[month];
  return m && m.balance != null ? m.balance : null;
}

// 跟上個月比較：{ balance, prevBalance, diff }；任一個沒輸入時 diff 是 null
export function balanceComparison(data, month) {
  const balance = monthBalance(data, month);
  const prevBalance = monthBalance(data, addMonths(month, -1));
  const diff = balance !== null && prevBalance !== null ? balance - prevBalance : null;
  return { balance, prevBalance, diff };
}

// 最近 count 個月的餘額（由舊到新，最後一個是 endMonth）：[{ month, balance }]，沒輸入是 null
export function balanceTrend(data, endMonth, count = 12) {
  const list = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const month = addMonths(endMonth, -i);
    list.push({ month, balance: monthBalance(data, month) });
  }
  return list;
}

// ───────────── 提醒 ─────────────

// 26 號後的帳戶餘額提醒：今天是 26 號以後，而且本月還沒輸入餘額
export function balanceReminderDue(data, today) {
  const day = Number(today.slice(8, 10));
  return day >= 26 && monthBalance(data, monthOf(today)) === null;
}

const BACKUP_REMIND_MS = 30 * 24 * 60 * 60 * 1000;

// 太久沒備份的提醒：超過 30 天沒備份；從來沒備份過的話，有記帳記錄才提醒
// lastBackupAt 是 ISO 時間字串或 null；nowMs 是現在的毫秒數
export function backupReminderDue(lastBackupAt, nowMs, hasEntries) {
  if (!lastBackupAt) return hasEntries;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last > BACKUP_REMIND_MS;
}

// ───────────── 月份計算 ─────────────

// 計算某個月，「上月超支」由參數直接給定（SPEC 第 4 節公式）
export function calcMonthWithCarry(data, month, prevOverspend) {
  const config = resolveMonthConfig(data, month);

  const extraIncome = config.extraIncome.reduce((sum, item) => sum + item.amount, 0);
  const totalIncome = config.salary + extraIncome;
  const fixed = fixedTotal(config.fixedExpenses);
  // 固定支出的各項（依設定的順序；年繳用每月攤提的金額），給圓環圖拆塊用
  // 快照裡的項目沒有 id，用順序當代號
  const fixedItems = [...config.fixedExpenses]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item, i) => ({ key: item.id || `#${i}`, name: item.name, amount: fixedItemMonthly(item) }));
  const livingBudget = config.dailyLiving * daysInMonth(month);
  const installments = installmentsTotal(data.installments || [], month);

  const flexBudget = totalIncome - fixed - livingBudget - installments - prevOverspend;

  const spent = sumEntries(data.entries || [], data.categories || [], month);
  const livingOverspend = Math.max(0, spent.living - livingBudget);
  const categoryTotal = spent.categorySpent.reduce((sum, c) => sum + c.amount, 0);

  const flexRemaining = flexBudget - spent.flex - livingOverspend - categoryTotal;

  return {
    month,
    salary: config.salary,
    extraIncome,
    totalIncome,
    fixed,
    fixedItems,
    livingBudget,
    installments,
    prevOverspend,
    flexBudget,
    livingSpent: spent.living,
    livingOverspend,
    flexSpent: spent.flex,
    categorySpent: spent.categorySpent,
    categoryTotal,
    flexRemaining,
  };
}

// 計算某個月，「上月超支」從開始使用月份一路往後追溯（SPEC 4.1）
export function calcMonth(data, month) {
  const start = data.settings.startMonth;

  // 沒有開始使用月份，或這個月就是開始使用月份（或更早）：上月超支 = 0
  if (!start || month <= start) {
    return calcMonthWithCarry(data, month, 0);
  }

  let carry = 0;
  for (let m = start; m < month; m = addMonths(m, 1)) {
    const result = calcMonthWithCarry(data, m, carry);
    carry = Math.max(0, -result.flexRemaining);
  }
  return calcMonthWithCarry(data, month, carry);
}

// ───────────── 今天還能花 ─────────────

// 本月剩餘天數（包含今天），例如 "2026-11-08" → 23
export function remainingDaysInMonth(today) {
  const day = Number(today.slice(8, 10));
  return daysInMonth(monthOf(today)) - day + 1;
}

// 今天還能花 = floor(彈性剩餘 ÷ 本月剩餘天數（含今天）)；彈性剩餘 ≤ 0 時為 0
export function todayAllowance(flexRemaining, today) {
  if (flexRemaining <= 0) return 0;
  return Math.floor(flexRemaining / remainingDaysInMonth(today));
}

// ───────────── 圓環圖 ─────────────

// 依月份計算結果產生圓環圖的分塊（SPEC 4.3）
// 回傳 { denominator, overspend, fixedGroup, segments }
//   overspend > 0 時畫面要顯示超支提示
//   fixedGroup：固定支出的合計 { amount, percent }，給圖例的小標題用
//   segments：固定支出的每一項是獨立一塊（group: 'fixed'，金額 0 的不列）
// 總收入 ≤ 0 時回傳 null，代表不畫圖
export function donutSegments(result) {
  if (result.totalIncome <= 0) return null;

  const segments = [];
  for (const item of result.fixedItems) {
    if (item.amount > 0) {
      segments.push({ key: `fixed:${item.key}`, label: item.name, amount: item.amount, group: 'fixed' });
    }
  }
  segments.push({ key: 'installments', label: '分期', amount: result.installments });
  if (result.prevOverspend > 0) {
    segments.push({ key: 'prevOverspend', label: '上月超支', amount: result.prevOverspend });
  }
  segments.push({ key: 'living', label: '生活費', amount: Math.max(result.livingBudget, result.livingSpent) });
  for (const cat of result.categorySpent) {
    if (cat.amount > 0) {
      segments.push({ key: `category:${cat.id}`, label: cat.name, amount: cat.amount });
    }
  }
  segments.push({ key: 'flexSpent', label: '彈性已花', amount: result.flexSpent });

  // 超支時不新增區塊，只是不顯示「彈性剩餘」
  const overspend = Math.max(0, -result.flexRemaining);
  if (overspend === 0) {
    segments.push({ key: 'flexRemaining', label: '彈性剩餘', amount: result.flexRemaining });
  }

  // 分母 = 總收入 + 超支金額 = 各塊加總（實際總花費）
  const denominator = result.totalIncome + overspend;
  const toPercent = (amount) => Math.round((amount * 100) / denominator);
  for (const seg of segments) {
    seg.percent = toPercent(seg.amount);
  }
  const fixedGroup = { amount: result.fixed, percent: toPercent(result.fixed) };

  return { denominator, overspend, fixedGroup, segments };
}
