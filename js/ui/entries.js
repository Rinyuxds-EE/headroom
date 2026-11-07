// 明細頁（SPEC 第 6 節「明細」）
// 某個月的所有記錄，日期由新到舊，同一天放在一起並顯示當日小計；可以依類別篩選；點一筆可以編輯或刪除

import {
  formatAmount, filterEntries, groupEntriesByDay, entryMonthRange, weekdayLabel,
} from '../calc.js';
import { escapeHtml } from './dom.js';
import { monthSwitchHtml, nextViewMonth } from './month-switch.js';
import { openEntryPanel } from './entry-panel.js';

// 切換分頁再回來時，保留看的月份和篩選
const view = { month: null, filter: 'all' };

// ctx：{ getData(), commit(), today, currentMonth, refresh() }
export function renderEntries(root, ctx) {
  const el = document.createElement('div');
  root.replaceChildren(el);

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'prevMonth' || btn.dataset.action === 'nextMonth') {
      const data = ctx.getData();
      const range = entryMonthRange(data.entries, data.settings.startMonth, ctx.currentMonth);
      const next = nextViewMonth(btn.dataset.action, view.month, range, data.settings.startMonth);
      if (next) {
        view.month = next;
        draw(el, ctx);
      }
    } else if (btn.dataset.action === 'edit') {
      const entry = ctx.getData().entries.find((x) => x.id === btn.dataset.id);
      if (entry) openEntryPanel(ctx, { entry, onDone: ctx.refresh });
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.field === 'filter') {
      view.filter = e.target.value;
      draw(el, ctx);
    }
  });

  draw(el, ctx);
}

// 類別顯示名稱
function categoryLabel(entry, categories) {
  if (entry.kind === 'living') return '生活費';
  if (entry.kind === 'flex') return '彈性';
  const cat = categories.find((c) => c.id === entry.categoryId);
  return cat ? cat.name : '（未知類別）';
}

function draw(el, ctx) {
  const data = ctx.getData();
  const range = entryMonthRange(data.entries, data.settings.startMonth, ctx.currentMonth);

  // 看的月份超出範圍（例如第一次進來，或月份換了）就回到本月
  if (!view.month || view.month < range.min || view.month > range.max) view.month = range.max;

  // 篩選的類別被刪掉了，就回到「全部」
  const filterOptions = [
    { value: 'all', label: '全部類別' },
    { value: 'living', label: '生活費' },
    { value: 'flex', label: '彈性' },
    ...data.categories.map((c) => ({
      value: `category:${c.id}`,
      label: c.archived ? `${c.name}（已封存）` : c.name,
    })),
  ];
  if (!filterOptions.some((o) => o.value === view.filter)) view.filter = 'all';

  const groups = groupEntriesByDay(filterEntries(data.entries, view.month, view.filter));
  const monthTotal = groups.reduce((sum, g) => sum + g.total, 0);

  el.innerHTML = `
  <div class="page">
    <h1 class="page-title">明細</h1>

    ${monthSwitchHtml(view.month, range, ctx.currentMonth)}

    <select class="input select" data-field="filter" aria-label="依類別篩選">
      ${filterOptions.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === view.filter ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>

    ${groups.length === 0
      ? `<p class="empty">${view.filter === 'all' ? '這個月還沒有記錄，按右下角的＋記一筆。' : '這個類別這個月沒有記錄。'}</p>`
      : `
      <div class="total">合計 <span class="num">${formatAmount(monthTotal)}</span></div>
      ${groups.map((g) => `
        <section class="day-group">
          <div class="day-header">
            <span><span class="num">${g.date.slice(5).replace('-', '/')}</span>（${weekdayLabel(g.date)}）</span>
            <span>小計 <span class="num">${formatAmount(g.total)}</span></span>
          </div>
          ${g.entries.map((e) => `
            <button class="entry-row" data-action="edit" data-id="${escapeHtml(e.id)}">
              <span class="entry-main">
                <span class="entry-cat">${escapeHtml(categoryLabel(e, data.categories))}</span>
                ${e.note ? `<span class="entry-note">${escapeHtml(e.note)}</span>` : ''}
              </span>
              <span class="num entry-amount">${formatAmount(e.amount)}</span>
            </button>`).join('')}
        </section>`).join('')}`}
  </div>`;
}
