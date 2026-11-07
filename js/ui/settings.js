// 設定頁（SPEC 第 6 節「設定」）
// 所有欄位自動儲存：欄位觸發 change（離開欄位或按完成）時就存檔。
// 只有結構改變（新增、刪除、排序、封存…）才重畫整頁；
// 單純改數值時只更新旁邊的合計文字，避免重畫讓輸入焦點跑掉。

import {
  formatAmount, parseAmount, fixedTotal, yearlyMonthly, daysInMonth,
  installmentAmountForMonth, isInstallmentFinished, monthDiff, addMonths, resolveMonthConfig,
  categoryHasEntries, backupReminderDue,
} from '../calc.js';
import { newId, ensureMonth } from '../storage.js';
import { escapeHtml, toast } from './dom.js';
import { exportBackup, importBackupFile, clearAllWithBackup } from './backup.js';

// 不能拿來當自訂類別名稱的字（會跟內建類別混淆）
const RESERVED_CATEGORY_NAMES = ['生活費', '彈性'];

// ctx：{ getData(), commit(mutator), today, currentMonth }
export function renderSettings(root, ctx) {
  const el = document.createElement('div');
  root.replaceChildren(el);
  const view = { el, ctx };

  el.addEventListener('change', (e) => handleChange(view, e.target));
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) handleAction(view, btn);
  });
  // 在文字欄位按 Enter（iPhone 鍵盤的「完成」）就離開欄位，觸發儲存
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  draw(view);
}

// ───────────── 畫面 ─────────────

function draw(view) {
  view.el.innerHTML = pageHtml(view.ctx.getData(), view.ctx.currentMonth);
  refreshDerived(view);
}

// 金額輸入框（叫出數字鍵盤）
function amountInput(field, id, value, extra = '') {
  const idAttr = id ? ` data-id="${escapeHtml(id)}"` : '';
  return `<input class="input num" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
    data-field="${field}"${idAttr} value="${value === null ? '' : value}" ${extra}>`;
}

// 文字輸入框
function textInput(field, id, value, extra = '') {
  return `<input class="input" type="text" autocomplete="off"
    data-field="${field}" data-id="${escapeHtml(id)}" value="${escapeHtml(value)}" ${extra}>`;
}

// 固定支出、會員訂閱共用的項目清單（名稱、金額、每月／每年、繳費月份、排序、刪除）
// list：'fixedExpenses' 或 'subscriptions'
function itemListHtml(list, items) {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const attrs = (id) => `data-list="${list}" data-id="${escapeHtml(id)}"`;
  return sorted.map((item, i) => `
    <div class="item">
      <div class="row">
        <input class="input" type="text" autocomplete="off" data-field="itemName" ${attrs(item.id)}
          value="${escapeHtml(item.name)}" aria-label="名稱">
        <input class="input num" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
          data-field="itemAmount" ${attrs(item.id)} value="${item.amount}" aria-label="金額">
      </div>
      <div class="row">
        <select class="input select" data-field="itemCycle" ${attrs(item.id)} aria-label="週期">
          <option value="monthly" ${item.cycle === 'monthly' ? 'selected' : ''}>每月</option>
          <option value="yearly" ${item.cycle === 'yearly' ? 'selected' : ''}>每年</option>
        </select>
        ${item.cycle === 'yearly' ? `
          <select class="input select" data-field="itemDue" ${attrs(item.id)} aria-label="繳費月份">
            ${Array.from({ length: 12 }, (_, k) => k + 1).map((n) =>
              `<option value="${n}" ${item.dueMonth === n ? 'selected' : ''}>${n} 月繳</option>`).join('')}
          </select>` : ''}
      </div>
      ${item.cycle === 'yearly' ? `<p class="hint" data-derived="yearly:${escapeHtml(item.id)}"></p>` : ''}
      <div class="row row-end">
        <button class="btn btn-icon" data-action="moveItem" data-dir="-1" ${attrs(item.id)}
          aria-label="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-icon" data-action="moveItem" data-dir="1" ${attrs(item.id)}
          aria-label="下移" ${i === sorted.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-icon btn-danger" data-action="deleteItem" ${attrs(item.id)} aria-label="刪除">✕</button>
      </div>
    </div>`).join('');
}

const LIST_LABEL = { fixedExpenses: '固定支出', subscriptions: '會員訂閱' };

function pageHtml(data, month) {
  const monthData = data.months[month] || { salary: null, extraIncome: [] };
  const visibleInst = data.installments.filter((inst) => !isInstallmentFinished(inst, month));
  const activeCats = data.categories.filter((c) => !c.archived);
  const archivedCats = data.categories.filter((c) => c.archived);

  return `
  <div class="page">
    <h1 class="page-title">設定</h1>

    <section class="card">
      <h2 class="section-title">開始使用月份</h2>
      <label class="field">
        <span class="field-label">開始使用月份</span>
        <input class="input num" type="month" placeholder="YYYY-MM" max="${month}"
          data-field="startMonth" value="${data.settings.startMonth}">
      </label>
      <p class="hint">超支從這個月開始追溯；記帳日期不能早於這個月。</p>
    </section>

    <section class="card">
      <h2 class="section-title">收入</h2>
      <label class="field">
        <span class="field-label">預設月薪</span>
        ${amountInput('defaultSalary', null, data.settings.defaultSalary)}
      </label>
      <label class="field">
        <span class="field-label">本月月薪（<span class="num">${month}</span>）</span>
        ${amountInput('monthSalary', null, monthData.salary, 'data-derived-placeholder="monthSalaryPlaceholder"')}
      </label>
      <p class="hint">留空 = 使用預設月薪。</p>

      <h3 class="sub-title">本月額外收入</h3>
      ${monthData.extraIncome.map((item) => `
        <div class="item">
          <div class="row">
            ${textInput('extraName', item.id, item.name, 'aria-label="名稱"')}
            ${amountInput('extraAmount', item.id, item.amount, 'aria-label="金額"')}
            <button class="btn btn-icon btn-danger" data-action="deleteExtra" data-id="${escapeHtml(item.id)}" aria-label="刪除">✕</button>
          </div>
        </div>`).join('')}
      <button class="btn btn-ghost" data-action="addExtra">＋ 新增額外收入</button>
      <div class="total">本月總收入 <span class="num" data-derived="monthIncome"></span></div>
    </section>

    <section class="card">
      <h2 class="section-title">固定支出</h2>
      ${itemListHtml('fixedExpenses', data.fixedExpenses)}
      <button class="btn btn-ghost" data-action="addItem" data-list="fixedExpenses">＋ 新增固定支出</button>
      <div class="total">每月固定支出合計 <span class="num" data-derived="total:fixedExpenses"></span></div>
    </section>

    <section class="card">
      <h2 class="section-title">會員訂閱</h2>
      <p class="hint">跟固定支出一樣在月初先扣；在首頁圓環圖裡是獨立的一組。</p>
      ${data.subscriptions.length === 0 ? '<p class="hint">還沒有會員訂閱。</p>' : ''}
      ${itemListHtml('subscriptions', data.subscriptions)}
      <button class="btn btn-ghost" data-action="addItem" data-list="subscriptions">＋ 新增會員訂閱</button>
      <div class="total">每月會員訂閱合計 <span class="num" data-derived="total:subscriptions"></span></div>
    </section>

    <section class="card">
      <h2 class="section-title">生活費</h2>
      <label class="field">
        <span class="field-label">每日生活費</span>
        ${amountInput('dailyLiving', null, data.settings.dailyLiving)}
      </label>
      <p class="hint">這是預算，實際花費請在記帳時選擇生活費</p>
      <p class="hint" data-derived="livingBudget"></p>
    </section>

    <section class="card">
      <h2 class="section-title">分期</h2>
      ${visibleInst.length === 0 ? '<p class="hint">目前沒有分期。</p>' : ''}
      ${visibleInst.map((inst) => {
        const k = monthDiff(inst.firstMonth, month);
        const activeNow = k >= 0 && k < inst.periods;
        const override = inst.overrides && month in inst.overrides ? inst.overrides[month] : null;
        return `
        <div class="item">
          <label class="field">
            <span class="field-label">名稱</span>
            ${textInput('instName', inst.id, inst.name)}
          </label>
          <div class="row">
            <label class="field">
              <span class="field-label">每期金額</span>
              ${amountInput('instAmount', inst.id, inst.amountPerPeriod)}
            </label>
            <label class="field">
              <span class="field-label">總期數</span>
              ${amountInput('instPeriods', inst.id, inst.periods)}
            </label>
          </div>
          <label class="field">
            <span class="field-label">第一期入帳月</span>
            <input class="input num" type="month" placeholder="YYYY-MM"
              data-field="instFirst" data-id="${escapeHtml(inst.id)}" value="${inst.firstMonth}">
          </label>
          ${activeNow ? `
            <label class="field">
              <span class="field-label">本月（<span class="num">${month}</span>）調整金額</span>
              ${amountInput('instOverride', inst.id, override, `data-derived-placeholder="instPlaceholder:${escapeHtml(inst.id)}"`)}
            </label>` : ''}
          <p class="hint" data-derived="inst:${escapeHtml(inst.id)}"></p>
          <div class="row row-end">
            <button class="btn btn-small btn-danger" data-action="deleteInst" data-id="${escapeHtml(inst.id)}">刪除</button>
          </div>
        </div>`;
      }).join('')}
      <button class="btn btn-ghost" data-action="addInst">＋ 新增分期</button>
    </section>

    <section class="card">
      <h2 class="section-title">自訂類別</h2>
      <p class="hint">建立類別後，在記帳時選擇此類別記錄花費</p>
      ${activeCats.length === 0 ? '<p class="hint">沒有使用中的類別。</p>' : ''}
      ${activeCats.map((c) => `
        <div class="item">
          <div class="row">
            ${textInput('catName', c.id, c.name, 'aria-label="類別名稱"')}
            ${categoryHasEntries(data.entries, c.id)
              ? `<button class="btn btn-small" data-action="archiveCat" data-id="${escapeHtml(c.id)}">封存</button>`
              : `<button class="btn btn-small btn-danger" data-action="deleteCat" data-id="${escapeHtml(c.id)}">刪除</button>`}
          </div>
        </div>`).join('')}
      <button class="btn btn-ghost" data-action="addCat">＋ 新增類別</button>

      ${archivedCats.length > 0 ? `
        <h3 class="sub-title">已封存</h3>
        ${archivedCats.map((c) => `
          <div class="item">
            <div class="row">
              <span class="archived-name">${escapeHtml(c.name)}</span>
              <button class="btn btn-small" data-action="unarchiveCat" data-id="${escapeHtml(c.id)}">取消封存</button>
              ${categoryHasEntries(data.entries, c.id) ? ''
                : `<button class="btn btn-small btn-danger" data-action="deleteCat" data-id="${escapeHtml(c.id)}">刪除</button>`}
            </div>
          </div>`).join('')}` : ''}
    </section>

    <section class="card">
      <h2 class="section-title">備份</h2>
      <p>上次備份：<span class="num">${data.settings.lastBackupAt
        ? escapeHtml(new Date(data.settings.lastBackupAt).toLocaleString('zh-TW'))
        : '從未備份'}</span></p>
      ${backupReminderDue(data.settings.lastBackupAt, Date.now(), data.entries.length > 0)
        ? `<p class="reminder">${data.settings.lastBackupAt ? '已經超過 30 天沒備份了' : '還沒備份過'}，建議現在匯出一份。</p>` : ''}
      <div class="row">
        <button class="btn" data-action="exportBackup">匯出備份</button>
        <label class="btn file-btn">匯入備份
          <input type="file" accept=".json,application/json" data-field="importFile" hidden>
        </label>
      </div>
      <p class="hint">匯出時選「儲存到檔案」，再選 iCloud 雲碟。匯入會覆蓋目前的資料。</p>
    </section>

    <section class="card danger-zone">
      <h2 class="section-title negative">清除所有資料</h2>
      <p class="hint">刪除所有設定、記帳記錄和帳戶餘額，回到第一次開啟 App 的狀態。清除前會自動先匯出一份備份。</p>
      <button class="btn btn-danger-solid btn-block" data-action="clearAll">清除所有資料</button>
    </section>
  </div>`;
}

// 算出所有「會跟著數值變動」的文字（合計、攤提、提示）
function derivedValues(data, month) {
  const values = {};
  const config = resolveMonthConfig(data, month);
  const extra = config.extraIncome.reduce((sum, x) => sum + x.amount, 0);

  values.monthSalaryPlaceholder = `預設 ${formatAmount(data.settings.defaultSalary)}`;
  values.monthIncome = formatAmount(config.salary + extra);
  values['total:fixedExpenses'] = formatAmount(fixedTotal(data.fixedExpenses));
  values['total:subscriptions'] = formatAmount(fixedTotal(data.subscriptions));

  const days = daysInMonth(month);
  values.livingBudget = `本月預算 = ${formatAmount(data.settings.dailyLiving)} × ${days} 天 = ${formatAmount(data.settings.dailyLiving * days)}`;

  for (const f of [...data.fixedExpenses, ...data.subscriptions]) {
    if (f.cycle === 'yearly') {
      values[`yearly:${f.id}`] = `每月攤提 ${formatAmount(yearlyMonthly(f.amount))}（全額 ${formatAmount(f.amount)}）`;
    }
  }

  for (const inst of data.installments) {
    const k = monthDiff(inst.firstMonth, month);
    const last = addMonths(inst.firstMonth, inst.periods - 1);
    values[`instPlaceholder:${inst.id}`] = `留空 = ${formatAmount(inst.amountPerPeriod)}`;
    values[`inst:${inst.id}`] = k < 0
      ? `尚未開始：${inst.firstMonth} 第 1 期，最後一期 ${last}`
      : `本月第 ${k + 1} / ${inst.periods} 期，扣 ${formatAmount(installmentAmountForMonth(inst, month))}；最後一期 ${last}`;
  }

  return values;
}

function refreshDerived(view) {
  const values = derivedValues(view.ctx.getData(), view.ctx.currentMonth);
  view.el.querySelectorAll('[data-derived]').forEach((node) => {
    node.textContent = values[node.dataset.derived] || '';
  });
  view.el.querySelectorAll('[data-derived-placeholder]').forEach((node) => {
    node.placeholder = values[node.dataset.derivedPlaceholder] || '';
  });
}

// 新增項目後，把焦點移到它的名稱欄位並全選，方便直接改名
function focusField(view, field, id) {
  const input = view.el.querySelector(`[data-field="${field}"][data-id="${CSS.escape(id)}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

// ───────────── 讀取輸入值 ─────────────

// 讀金額；不合法時恢復原值並提示，回傳 null
function readAmount(input, current) {
  const n = parseAmount(input.value);
  if (n === null) {
    input.value = current === null ? '' : String(current);
    toast('請輸入 0 以上的整數', 'error');
    return null;
  }
  input.value = String(n);
  return n;
}

// 讀名稱；空白時恢復原值並提示，回傳 null
function readName(input, current) {
  const name = input.value.trim();
  if (name === '') {
    input.value = current;
    toast('名稱不能是空白', 'error');
    return null;
  }
  input.value = name;
  return name;
}

// 讀月份 "YYYY-MM"；不合法時恢復原值並提示，回傳 null
function readMonth(input, current) {
  const value = input.value.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    input.value = current;
    toast('月份格式是 YYYY-MM', 'error');
    return null;
  }
  return value;
}

// ───────────── 欄位變更 ─────────────

function handleChange(view, input) {
  const field = input.dataset.field;
  if (!field) return;
  if (field === 'importFile') {
    const file = input.files && input.files[0];
    input.value = ''; // 清掉，下次選同一個檔案也會觸發
    if (file) importBackupFile(view.ctx, file);
    return;
  }
  const { ctx } = view;
  const data = ctx.getData();
  const month = ctx.currentMonth;
  const id = input.dataset.id;
  let redraw = false;

  switch (field) {
    case 'startMonth': {
      const value = readMonth(input, data.settings.startMonth);
      if (value === null) return;
      if (value > month) {
        input.value = data.settings.startMonth;
        toast('開始使用月份不能晚於本月', 'error');
        return;
      }
      ctx.commit((d) => { d.settings.startMonth = value; });
      break;
    }

    case 'defaultSalary': {
      const n = readAmount(input, data.settings.defaultSalary);
      if (n === null) return;
      ctx.commit((d) => { d.settings.defaultSalary = n; });
      break;
    }

    case 'monthSalary': {
      const current = data.months[month] ? data.months[month].salary : null;
      if (input.value.trim() === '') {
        ctx.commit((d) => { ensureMonth(d, month).salary = null; });
        break;
      }
      const n = readAmount(input, current);
      if (n === null) return;
      ctx.commit((d) => { ensureMonth(d, month).salary = n; });
      break;
    }

    case 'extraName':
    case 'extraAmount': {
      const item = (data.months[month] ? data.months[month].extraIncome : []).find((x) => x.id === id);
      if (!item) return;
      if (field === 'extraName') {
        const name = readName(input, item.name);
        if (name === null) return;
        ctx.commit(() => { item.name = name; });
      } else {
        const n = readAmount(input, item.amount);
        if (n === null) return;
        ctx.commit(() => { item.amount = n; });
      }
      break;
    }

    case 'itemName':
    case 'itemAmount':
    case 'itemCycle':
    case 'itemDue': {
      const list = input.dataset.list;
      if (!LIST_LABEL[list]) return;
      const item = data[list].find((x) => x.id === id);
      if (!item) return;
      if (field === 'itemName') {
        const name = readName(input, item.name);
        if (name === null) return;
        ctx.commit(() => { item.name = name; });
      } else if (field === 'itemAmount') {
        const n = readAmount(input, item.amount);
        if (n === null) return;
        ctx.commit(() => { item.amount = n; });
      } else if (field === 'itemCycle') {
        const cycle = input.value === 'yearly' ? 'yearly' : 'monthly';
        ctx.commit(() => {
          item.cycle = cycle;
          // 改成每年時預設 1 月繳，使用者再自己改
          item.dueMonth = cycle === 'yearly' ? (item.dueMonth || 1) : null;
        });
        redraw = true;
      } else {
        const due = Number(input.value);
        ctx.commit(() => { item.dueMonth = due; });
      }
      break;
    }

    case 'dailyLiving': {
      const n = readAmount(input, data.settings.dailyLiving);
      if (n === null) return;
      ctx.commit((d) => { d.settings.dailyLiving = n; });
      break;
    }

    case 'instName':
    case 'instAmount':
    case 'instPeriods':
    case 'instFirst':
    case 'instOverride': {
      const inst = data.installments.find((x) => x.id === id);
      if (!inst) return;
      if (field === 'instName') {
        const name = readName(input, inst.name);
        if (name === null) return;
        ctx.commit(() => { inst.name = name; });
      } else if (field === 'instAmount') {
        const n = readAmount(input, inst.amountPerPeriod);
        if (n === null) return;
        ctx.commit(() => { inst.amountPerPeriod = n; });
      } else if (field === 'instPeriods') {
        const n = readAmount(input, inst.periods);
        if (n === null) return;
        if (n < 1) {
          input.value = String(inst.periods);
          toast('期數至少是 1', 'error');
          return;
        }
        ctx.commit(() => { inst.periods = n; });
        redraw = true;
      } else if (field === 'instFirst') {
        const value = readMonth(input, inst.firstMonth);
        if (value === null) return;
        ctx.commit(() => { inst.firstMonth = value; });
        redraw = true;
      } else {
        // 本月調整金額：留空 = 取消調整
        if (input.value.trim() === '') {
          ctx.commit(() => { if (inst.overrides) delete inst.overrides[month]; });
        } else {
          const current = inst.overrides && month in inst.overrides ? inst.overrides[month] : null;
          const n = readAmount(input, current);
          if (n === null) return;
          ctx.commit(() => {
            if (!inst.overrides) inst.overrides = {};
            inst.overrides[month] = n;
          });
        }
      }
      // 改了期數或第一期之後，如果已經繳完就會從清單消失，提示一下
      if (redraw && isInstallmentFinished(inst, month)) {
        toast(`「${inst.name}」已全部繳完，從清單隱藏`);
      }
      break;
    }

    case 'catName': {
      const cat = data.categories.find((x) => x.id === id);
      if (!cat) return;
      const name = readName(input, cat.name);
      if (name === null) return;
      const problem = categoryNameProblem(data, name, cat.id);
      if (problem) {
        input.value = cat.name;
        toast(problem, 'error');
        return;
      }
      ctx.commit(() => { cat.name = name; });
      break;
    }

    default:
      return;
  }

  if (redraw) draw(view);
  else refreshDerived(view);
}

// 檢查類別名稱能不能用；可以用回傳 null
function categoryNameProblem(data, name, selfId) {
  if (RESERVED_CATEGORY_NAMES.includes(name)) return `「${name}」是內建類別，請換一個名稱`;
  if (data.categories.some((c) => c.id !== selfId && c.name === name)) return `已經有「${name}」這個類別（包含已封存的）`;
  return null;
}

// ───────────── 按鈕 ─────────────

function handleAction(view, btn) {
  const { ctx } = view;
  const data = ctx.getData();
  const month = ctx.currentMonth;
  const id = btn.dataset.id;

  switch (btn.dataset.action) {
    case 'exportBackup':
      exportBackup(ctx);
      return;

    case 'clearAll':
      clearAllWithBackup(ctx);
      return;

    case 'addExtra': {
      const newItemId = newId();
      ctx.commit((d) => { ensureMonth(d, month).extraIncome.push({ id: newItemId, name: '額外收入', amount: 0 }); });
      draw(view);
      focusField(view, 'extraName', newItemId);
      return;
    }

    case 'deleteExtra': {
      const list = data.months[month] ? data.months[month].extraIncome : [];
      const item = list.find((x) => x.id === id);
      if (!item || !confirm(`刪除額外收入「${item.name}」？`)) return;
      ctx.commit(() => { list.splice(list.indexOf(item), 1); });
      break;
    }

    case 'addItem': {
      const list = btn.dataset.list;
      if (!LIST_LABEL[list]) return;
      const newItemId = newId();
      const maxOrder = data[list].reduce((max, f) => Math.max(max, f.order), -1);
      ctx.commit((d) => {
        d[list].push({
          id: newItemId, name: list === 'subscriptions' ? '新訂閱' : '新項目',
          amount: 0, cycle: 'monthly', dueMonth: null, order: maxOrder + 1,
        });
      });
      draw(view);
      focusField(view, 'itemName', newItemId);
      return;
    }

    case 'moveItem': {
      const list = btn.dataset.list;
      if (!LIST_LABEL[list]) return;
      const sorted = [...data[list]].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((x) => x.id === id);
      const target = index + Number(btn.dataset.dir);
      if (index < 0 || target < 0 || target >= sorted.length) return;
      [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
      // 重新編號，順序永遠是 0、1、2…
      ctx.commit(() => { sorted.forEach((f, i) => { f.order = i; }); });
      break;
    }

    case 'deleteItem': {
      const list = btn.dataset.list;
      if (!LIST_LABEL[list]) return;
      const item = data[list].find((x) => x.id === id);
      if (!item || !confirm(`刪除${LIST_LABEL[list]}「${item.name}」？\n已經結束的月份不受影響。`)) return;
      ctx.commit((d) => { d[list] = d[list].filter((x) => x.id !== id); });
      break;
    }

    case 'addInst': {
      const newItemId = newId();
      ctx.commit((d) => {
        d.installments.push({ id: newItemId, name: '新分期', amountPerPeriod: 0, periods: 1, firstMonth: month, overrides: {} });
      });
      draw(view);
      focusField(view, 'instName', newItemId);
      return;
    }

    case 'deleteInst': {
      const inst = data.installments.find((x) => x.id === id);
      if (!inst || !confirm(`刪除分期「${inst.name}」？\n注意：過去月份的計算也會一起改變（包含超支結轉）。`)) return;
      ctx.commit((d) => { d.installments = d.installments.filter((x) => x.id !== id); });
      break;
    }

    case 'addCat': {
      // 找一個沒用過的名稱：新類別、新類別 2、新類別 3…
      let name = '新類別';
      for (let n = 2; categoryNameProblem(data, name, null); n += 1) name = `新類別 ${n}`;
      const newItemId = newId();
      ctx.commit((d) => { d.categories.push({ id: newItemId, name, archived: false }); });
      draw(view);
      focusField(view, 'catName', newItemId);
      return;
    }

    case 'archiveCat': {
      const cat = data.categories.find((x) => x.id === id);
      if (!cat || !confirm(`封存「${cat.name}」？\n封存後不能再用來記帳，但舊記錄和計算都不受影響，之後可以取消封存。`)) return;
      ctx.commit(() => { cat.archived = true; });
      break;
    }

    case 'deleteCat': {
      const cat = data.categories.find((x) => x.id === id);
      if (!cat) return;
      // 再檢查一次：有記錄的類別不能刪除，只能封存
      if (categoryHasEntries(data.entries, cat.id)) {
        toast(`「${cat.name}」已經有記錄，只能封存`, 'error');
        break;
      }
      if (!confirm(`刪除類別「${cat.name}」？`)) return;
      ctx.commit((d) => { d.categories = d.categories.filter((x) => x.id !== id); });
      break;
    }

    case 'unarchiveCat': {
      const cat = data.categories.find((x) => x.id === id);
      if (!cat) return;
      ctx.commit(() => { cat.archived = false; });
      break;
    }

    default:
      return;
  }

  draw(view);
}
