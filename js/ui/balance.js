// 餘額頁（SPEC 3.8、第 6 節「餘額」）
// 輸入帳戶餘額、跟上月比較、最近 12 個月趨勢線，旁邊放彈性剩餘當對照（不做任何計算連動）

import {
  formatAmount, parseAmount, balanceComparison, balanceTrend, calcMonth, entryMonthRange,
} from '../calc.js';
import { ensureMonth } from '../storage.js';
import { trendSvg } from '../trend.js';
import { escapeHtml, toast } from './dom.js';
import { monthSwitchHtml, nextViewMonth } from './month-switch.js';

// 切換分頁再回來時，保留看的月份；趨勢圖點選的月份
const view = { month: null, selectedIndex: null };

// ctx：{ getData(), commit(), today, currentMonth }
export function renderBalance(root, ctx) {
  const el = document.createElement('div');
  root.replaceChildren(el);

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const data = ctx.getData();
      const range = entryMonthRange(data.entries, data.settings.startMonth, ctx.currentMonth);
      const next = nextViewMonth(btn.dataset.action, view.month, range, data.settings.startMonth);
      if (next) {
        view.month = next;
        draw(el, ctx);
      }
      return;
    }
    // 點趨勢圖的某個月：顯示數值，再點一次取消
    const hit = e.target.closest('[data-index]');
    if (hit) {
      const index = Number(hit.getAttribute('data-index'));
      view.selectedIndex = view.selectedIndex === index ? null : index;
      draw(el, ctx);
    }
  });

  el.addEventListener('change', (e) => {
    if (e.target.dataset.field !== 'balance') return;
    const input = e.target;
    const month = view.month;
    const current = balanceComparison(ctx.getData(), month).balance;
    // 留空 = 清除這個月的餘額
    if (input.value.trim() === '') {
      if (!ctx.commit((d) => { ensureMonth(d, month).balance = null; })) return;
    } else {
      const n = parseAmount(input.value);
      if (n === null) {
        input.value = current === null ? '' : String(current);
        toast('請輸入 0 以上的整數', 'error');
        return;
      }
      if (!ctx.commit((d) => { ensureMonth(d, month).balance = n; })) return;
      toast('已儲存');
    }
    draw(el, ctx);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  draw(el, ctx);
}

function draw(el, ctx) {
  const data = ctx.getData();
  const range = entryMonthRange(data.entries, data.settings.startMonth, ctx.currentMonth);
  if (!view.month || view.month < range.min || view.month > range.max) view.month = range.max;
  const month = view.month;

  const cmp = balanceComparison(data, month);
  const flexRemaining = calcMonth(data, month).flexRemaining;
  const trend = balanceTrend(data, ctx.currentMonth, 12);
  if (view.selectedIndex !== null && !trend[view.selectedIndex]) view.selectedIndex = null;
  const chart = trendSvg(trend, view.selectedIndex);

  let diffHtml;
  if (cmp.diff === null) {
    diffHtml = `<span class="text-secondary">${cmp.balance === null ? '輸入後會跟上個月比較' : '上個月沒有輸入，無法比較'}</span>`;
  } else if (cmp.diff > 0) {
    diffHtml = `<span class="positive">▲ 增加 <span class="num">${formatAmount(cmp.diff)}</span></span>`;
  } else if (cmp.diff < 0) {
    diffHtml = `<span class="negative">▼ 減少 <span class="num">${formatAmount(-cmp.diff)}</span></span>`;
  } else {
    diffHtml = '<span class="text-secondary">跟上個月一樣</span>';
  }

  el.innerHTML = `
  <div class="page">
    <h1 class="page-title">餘額</h1>
    ${monthSwitchHtml(month, range, ctx.currentMonth)}

    <section class="card">
      <label class="field">
        <span class="field-label">帳戶餘額（<span class="num">${month}</span>）</span>
        <input class="input num balance-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
          data-field="balance" placeholder="尚未輸入" value="${cmp.balance === null ? '' : cmp.balance}">
      </label>
      <p class="hint">建議每月 26 號以後輸入（信用卡 25 號扣款後的餘額最準）。留空 = 清除。</p>
      <div class="balance-row">
        <span class="text-secondary">跟上個月比</span>
        ${diffHtml}
      </div>
      <div class="balance-row">
        <span class="text-secondary">對照：${month === ctx.currentMonth ? '本月' : '該月'}彈性剩餘</span>
        <span class="num ${flexRemaining < 0 ? 'negative' : ''}">${formatAmount(flexRemaining)}</span>
      </div>
    </section>

    <section class="card">
      <h2 class="section-title">最近 12 個月</h2>
      ${chart || '<p class="empty">還沒有輸入過帳戶餘額。</p>'}
      ${chart ? `
        <details class="trend-table">
          <summary>以表格顯示</summary>
          <table>
            ${trend.slice().reverse().map((p) => `
              <tr><td class="num">${escapeHtml(p.month)}</td>
                <td class="num">${p.balance === null ? '<span class="text-secondary">未輸入</span>' : formatAmount(p.balance)}</td></tr>`).join('')}
          </table>
        </details>` : ''}
    </section>
  </div>`;
}
