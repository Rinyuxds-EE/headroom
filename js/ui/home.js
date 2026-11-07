// 首頁（SPEC 第 6 節「首頁」）
// 今天日期、月份切換、提醒、圓環圖（中心是彈性剩餘）、今天還能花、生活費進度條、圖例

import {
  calcMonth, donutSegments, todayAllowance, remainingDaysInMonth, formatAmount,
  yearlyDueThisMonth, resolveMonthConfig, entryMonthRange, weekdayLabel,
  balanceReminderDue, backupReminderDue,
} from '../calc.js';
import { donutSvg, segmentColors } from '../donut.js';
import { escapeHtml } from './dom.js';
import { monthSwitchHtml, nextViewMonth } from './month-switch.js';

// 切換分頁再回來時，保留看的月份；點選的圓環區塊
const view = { month: null, selectedKey: null };

// ctx：{ getData(), today, currentMonth }
export function renderHome(root, ctx) {
  const el = document.createElement('div');
  root.replaceChildren(el);

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      if (btn.dataset.action === 'prevMonth' || btn.dataset.action === 'nextMonth') {
        const data = ctx.getData();
        const range = entryMonthRange(data.entries, data.settings.startMonth, ctx.currentMonth);
        const next = nextViewMonth(btn.dataset.action, view.month, range, data.settings.startMonth);
        if (next) {
          view.month = next;
          view.selectedKey = null;
          draw(el, ctx);
        }
      }
      return;
    }
    // 點圓環的一塊或圖例的一行：強調那一塊，再點一次取消
    const target = e.target.closest('[data-key]');
    if (target) {
      const key = target.getAttribute('data-key');
      view.selectedKey = view.selectedKey === key ? null : key;
      draw(el, ctx);
    }
  });

  draw(el, ctx);
}

function draw(el, ctx) {
  const data = ctx.getData();
  const range = entryMonthRange(data.entries, data.settings.startMonth, ctx.currentMonth);
  if (!view.month || view.month < range.min || view.month > range.max) view.month = range.max;

  const month = view.month;
  const isCurrent = month === ctx.currentMonth;
  const result = calcMonth(data, month);
  const donut = donutSegments(result);
  const categoryIndex = (id) => data.categories.findIndex((c) => c.id === id);
  const colors = donut ? segmentColors(donut, categoryIndex) : null;
  if (donut && view.selectedKey && view.selectedKey !== 'fixed' && view.selectedKey !== 'subscription'
    && !donut.segments.some((s) => s.key === view.selectedKey)) view.selectedKey = null;

  el.innerHTML = `
  <div class="page">
    <div class="home-today">今天 <span class="num">${ctx.today}</span>（${weekdayLabel(ctx.today)}）</div>

    ${monthSwitchHtml(month, range, ctx.currentMonth)}

    ${isCurrent ? remindersHtml(data, month, ctx.today) : ''}

    <section class="card donut-card">
      ${donut
        ? donutSvg(donut, {
            label: '彈性剩餘',
            value: formatAmount(result.flexRemaining),
            className: result.flexRemaining < 0 ? 'negative' : result.flexRemaining > 0 ? 'positive' : '',
          }, colors, view.selectedKey)
        : `<div class="empty">
             <p>請先設定月薪</p>
             <a class="btn" href="#settings">前往設定</a>
           </div>`}
    </section>

    ${isCurrent ? allowanceHtml(result.flexRemaining, ctx.today) : ''}

    ${livingHtml(result)}

    ${donut ? legendHtml(donut, colors) : ''}
  </div>`;
}

// 提醒區：年繳提醒、26 號後的餘額提醒、太久沒備份（有才顯示）
function remindersHtml(data, month, today) {
  const config = resolveMonthConfig(data, month);
  const due = [...yearlyDueThisMonth(config.fixedExpenses, month), ...yearlyDueThisMonth(config.subscriptions, month)];
  const items = due.map((f) => `
    <div class="reminder">本月需繳 ${escapeHtml(f.name)} <span class="num">${formatAmount(f.amount)}</span> 元（已按月攤提）</div>`);

  if (balanceReminderDue(data, today)) {
    items.push('<a class="reminder reminder-link" href="#balance">輸入本月帳戶餘額 ›</a>');
  }
  if (backupReminderDue(data.settings.lastBackupAt, Date.now(), data.entries.length > 0)) {
    items.push(`<a class="reminder reminder-link" href="#settings">${data.settings.lastBackupAt
      ? '已經超過 30 天沒備份' : '還沒備份過'}，到設定匯出備份 ›</a>`);
  }

  return items.length ? `<section class="reminders">${items.join('')}</section>` : '';
}

// 今天還能花（只在看本月時顯示）
function allowanceHtml(flexRemaining, today) {
  const days = remainingDaysInMonth(today);
  const amount = todayAllowance(flexRemaining, today);
  return `
    <section class="card allowance">
      <div class="allowance-label">今天還能花</div>
      <div class="allowance-value num ${amount > 0 ? 'positive' : ''}">${formatAmount(amount)}</div>
      <div class="hint">彈性剩餘 <span class="num">${formatAmount(flexRemaining)}</span> ÷ 本月剩 <span class="num">${days}</span> 天</div>
    </section>`;
}

// 生活費：已花 / 預算 的進度條
function livingHtml(result) {
  const spent = result.livingSpent;
  const budget = result.livingBudget;
  const ratio = budget > 0 ? spent / budget : (spent > 0 ? 1 : 0);
  const over = result.livingOverspend > 0;
  return `
    <section class="card">
      <div class="living-head">
        <span class="section-title">生活費</span>
        <span><span class="num">${formatAmount(spent)}</span> / <span class="num">${formatAmount(budget)}</span></span>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${budget}" aria-valuenow="${spent}" aria-label="生活費已花">
        <div class="progress-fill${over ? ' over' : ''}" style="width:${Math.min(ratio, 1) * 100}%"></div>
      </div>
      <div class="hint">${over
        ? `<span class="negative">超支 <span class="num">${formatAmount(result.livingOverspend)}</span>，從彈性扣</span>`
        : `剩 <span class="num">${formatAmount(budget - spent)}</span>`}</div>
    </section>`;
}

// 圖例：每一塊的名稱、百分比、金額；超支時最後多一行紅字
// 固定支出、會員訂閱各自放在小標題下面，小標題顯示合計和百分比
function legendHtml(donut, colors) {
  const sel = view.selectedKey;
  const isDim = (s) => sel && sel !== s.key && !(s.group && s.group === sel);
  const row = (s, extraClass = '') => `
    <button class="legend-row${extraClass}${isDim(s) ? ' dim' : ''}" data-key="${escapeHtml(s.key)}">
      <span class="swatch" style="background:${colors.get(s.key)}"></span>
      <span class="legend-name">${escapeHtml(s.label)}</span>
      <span class="num legend-percent">${s.percent}%</span>
      <span class="num legend-amount">（${formatAmount(s.amount)}）</span>
    </button>`;

  const fixedSegs = donut.segments.filter((s) => s.group === 'fixed');
  const subSegs = donut.segments.filter((s) => s.group === 'subscription');
  const others = donut.segments.filter((s) => !s.group);
  const fixedHeader = {
    key: 'fixed', label: '固定支出', amount: donut.fixedGroup.amount, percent: donut.fixedGroup.percent,
  };
  const subHeader = {
    key: 'subscription', label: '會員訂閱', amount: donut.subscriptionGroup.amount, percent: donut.subscriptionGroup.percent,
  };

  return `
    <section class="card legend">
      ${row(fixedHeader, ' legend-group')}
      ${fixedSegs.map((s) => row(s, ' legend-child')).join('')}
      ${subSegs.length > 0 ? row(subHeader, ' legend-group') : ''}
      ${subSegs.map((s) => row(s, ' legend-child')).join('')}
      ${others.map((s) => row(s)).join('')}
      ${donut.overspend > 0 ? `<div class="legend-overspend negative">超支 <span class="num">${formatAmount(donut.overspend)}</span> 元</div>` : ''}
    </section>`;
}
