// 月份切換（‹ 2026-11 ›）：首頁、明細、餘額共用
// 不能切換時按鈕變灰，但仍然可以點，點了會說明原因（不要讓人以為壞掉了）

import { addMonths } from '../calc.js';
import { toast } from './dom.js';

// range：{ min, max }（由 calc.entryMonthRange 算出）
export function monthSwitchHtml(month, range, currentMonth) {
  const atMin = month <= range.min;
  const atMax = month >= range.max;
  return `
    <div class="month-switch">
      <button class="btn btn-icon" data-action="prevMonth" aria-label="上個月" aria-disabled="${atMin}">‹</button>
      <span class="num month-label">${month}${month === currentMonth ? '<span class="hint">（本月）</span>' : ''}</span>
      <button class="btn btn-icon" data-action="nextMonth" aria-label="下個月" aria-disabled="${atMax}">›</button>
    </div>`;
}

// 處理 ‹ › 按鈕；可以切換就回傳新的月份，不能切換就提示原因並回傳 null
export function nextViewMonth(action, month, range, startMonth) {
  if (action === 'prevMonth') {
    if (month <= range.min) {
      toast(range.min === startMonth ? '已是開始使用月份，可到設定修改' : '已是最早有記錄的月份');
      return null;
    }
    return addMonths(month, -1);
  }
  if (action === 'nextMonth') {
    if (month >= range.max) {
      toast('已是本月，不能看未來的月份');
      return null;
    }
    return addMonths(month, 1);
  }
  return null;
}
