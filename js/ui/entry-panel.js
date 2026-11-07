// 記帳面板：從下方滑出（SPEC 3.6、第 6 節「記帳」）
// 新增：打開 → 輸入金額 → 選類別 → 儲存
// 編輯：從明細頁點一筆打開，可以修改或刪除

import { parseAmount, entryDateProblem, weekdayLabel } from '../calc.js';
import { newId } from '../storage.js';
import { escapeHtml, toast } from './dom.js';

// 面板是否開著（關閉動畫期間也可以馬上再開）
let panelOpen = false;

// 記住上次選的類別（只是方便用的偏好，不是預算資料，所以不放進 headroom:data）
const LAST_CHOICE_KEY = 'headroom:lastChoice';

function readLastChoice() {
  try {
    return window.localStorage.getItem(LAST_CHOICE_KEY);
  } catch (err) {
    return null;
  }
}

function writeLastChoice(choice) {
  try {
    window.localStorage.setItem(LAST_CHOICE_KEY, choice);
  } catch (err) {
    // 存不了也沒關係，下次就預設選生活費
  }
}

// 記錄 → 類別選項代號：'living'、'flex'、'category:<id>'
function choiceOf(entry) {
  return entry.kind === 'category' ? `category:${entry.categoryId}` : entry.kind;
}

// 面板上可以選的類別
// 新增時：生活費、彈性、未封存的自訂類別
// 編輯時：另外保留原本的類別（即使已經封存），但不能改成其他已封存的類別
function choiceList(data, entry) {
  const list = [
    { value: 'living', label: '生活費' },
    { value: 'flex', label: '彈性' },
  ];
  for (const c of data.categories) {
    const isOriginal = entry && entry.kind === 'category' && entry.categoryId === c.id;
    if (!c.archived || isOriginal) {
      list.push({ value: `category:${c.id}`, label: c.archived ? `${c.name}（已封存）` : c.name });
    }
  }
  return list;
}

// 打開面板。options：{ entry: 要編輯的記錄（新增時不給）, onDone: 存檔或刪除後呼叫 }
export function openEntryPanel(ctx, { entry = null, onDone = () => {} } = {}) {
  // 已經開著就不要再開一個
  if (panelOpen) return;
  panelOpen = true;

  const data = ctx.getData();
  const isEdit = entry !== null;
  const choices = choiceList(data, entry);

  // 預設類別：編輯時用原本的；新增時用上次選的（還能選才用），否則生活費
  let selected = 'living';
  if (isEdit) {
    selected = choiceOf(entry);
  } else {
    const last = readLastChoice();
    if (last && choices.some((c) => c.value === last)) selected = last;
  }

  const today = ctx.today;
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', isEdit ? '編輯記錄' : '記一筆');

  sheet.innerHTML = `
    <div class="sheet-header">
      <button class="btn btn-text" data-action="cancel">取消</button>
      <div class="sheet-title">
        <div>${isEdit ? '編輯記錄' : '記一筆'}</div>
        <div class="hint">今天 <span class="num">${today}</span>（${weekdayLabel(today)}）</div>
      </div>
      <button class="btn btn-primary" data-action="save">儲存</button>
    </div>

    <input class="input amount-input num" type="text" inputmode="numeric" pattern="[0-9]*"
      autocomplete="off" placeholder="0" aria-label="金額" data-field="amount"
      value="${isEdit ? entry.amount : ''}">

    <div class="chips" role="radiogroup" aria-label="類別">
      ${choices.map((c) => `
        <button class="chip" role="radio" data-choice="${escapeHtml(c.value)}"
          aria-checked="${c.value === selected}">${escapeHtml(c.label)}</button>`).join('')}
    </div>

    <label class="field">
      <span class="field-label">日期</span>
      <input class="input num" type="date" data-field="date" value="${isEdit ? entry.date : today}"
        min="${data.settings.startMonth}-01" max="${today}" aria-describedby="date-error">
    </label>
    <p class="field-error" id="date-error" role="alert" hidden></p>
    <label class="field">
      <span class="field-label">備註（選填）</span>
      <input class="input" type="text" data-field="note" autocomplete="off"
        value="${isEdit ? escapeHtml(entry.note || '') : ''}">
    </label>

    ${isEdit ? '<button class="btn btn-danger btn-block" data-action="delete">刪除這筆記錄</button>' : ''}
  `;

  document.body.append(backdrop, sheet);
  document.body.classList.add('sheet-open');

  const amountInput = sheet.querySelector('[data-field="amount"]');
  const dateInput = sheet.querySelector('[data-field="date"]');
  const noteInput = sheet.querySelector('[data-field="note"]');
  const dateError = sheet.querySelector('#date-error');

  // 檢查日期，不行的話在日期欄下方顯示原因（不要讓人以為壞掉了）；回傳是否可以用
  function checkDate() {
    const latest = ctx.getData();
    const problem = entryDateProblem(dateInput.value, ctx.today, latest.settings.startMonth, isEdit ? entry.date : null);
    dateError.textContent = problem || '';
    dateError.hidden = !problem;
    dateInput.classList.toggle('invalid', !!problem);
    return !problem;
  }
  dateInput.addEventListener('change', checkDate);

  // 新增時馬上把游標放到金額欄，叫出數字鍵盤
  // （iPhone 只有在點擊的同一個動作裡呼叫 focus 才會跳出鍵盤，所以不能延後）
  if (!isEdit) amountInput.focus();
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  });

  function close() {
    panelOpen = false;
    backdrop.classList.remove('open');
    sheet.classList.remove('open');
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKeydown);
    // 等滑出動畫結束再移除
    setTimeout(() => { backdrop.remove(); sheet.remove(); }, 250);
  }

  function selectChoice(value) {
    selected = value;
    sheet.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('aria-checked', String(chip.dataset.choice === value));
    });
  }

  function save() {
    const amount = parseAmount(amountInput.value);
    if (amount === null || amount === 0) {
      toast('請輸入金額（1 以上的整數）', 'error');
      amountInput.focus();
      return;
    }
    if (!choices.some((c) => c.value === selected)) {
      toast('請選擇類別', 'error');
      return;
    }
    // 用最新的「今天」檢查（App 可能開著跨日）；原因顯示在日期欄下方
    if (!checkDate()) {
      dateInput.focus();
      return;
    }

    const kind = selected.startsWith('category:') ? 'category' : selected;
    const categoryId = kind === 'category' ? selected.slice(9) : null;
    const fields = { date: dateInput.value, amount, kind, categoryId, note: noteInput.value.trim() };

    const applied = ctx.commit((d) => {
      if (isEdit) {
        const target = d.entries.find((e) => e.id === entry.id);
        if (target) Object.assign(target, fields);
      } else {
        d.entries.push({ id: newId(), ...fields, createdAt: new Date().toISOString() });
      }
    });
    // 沒套用代表月份剛好換了，畫面已更新；面板留著讓使用者再按一次儲存
    if (!applied) return;

    if (!isEdit) writeLastChoice(selected);
    close();
    toast(isEdit ? '已更新' : '已記一筆');
    onDone();
  }

  function remove() {
    if (!confirm('刪除這筆記錄？')) return;
    const applied = ctx.commit((d) => {
      d.entries = d.entries.filter((e) => e.id !== entry.id);
    });
    if (!applied) return;
    close();
    toast('已刪除');
    onDone();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  sheet.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      selectChoice(chip.dataset.choice);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'cancel') close();
    else if (btn.dataset.action === 'save') save();
    else if (btn.dataset.action === 'delete') remove();
  });
  // 在金額或備註欄按 Enter（鍵盤上的「完成」）就儲存
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target === amountInput || e.target === noteInput)) {
      e.preventDefault();
      save();
    }
  });
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
}
