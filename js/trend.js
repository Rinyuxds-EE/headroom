// 帳戶餘額趨勢線（SPEC 3.8）：自己用 SVG 畫
// 只有一條線，所以不需要圖例，標題就說明了它是什麼

import { formatAmount } from './calc.js';
import { escapeHtml } from './ui/dom.js';

const W = 340;
const H = 190;
const PAD = { left: 46, right: 14, top: 30, bottom: 26 };
const LINE_COLOR = '#3987e5';

// 座標軸用的簡短金額：1 萬以上顯示「12.3萬」
function compactAmount(v) {
  if (Math.abs(v) >= 10000) return `${+(v / 10000).toFixed(1)}萬`;
  return formatAmount(v);
}

// 取一個好看的刻度間距（1、2、5 × 10 的次方）
function niceStep(raw) {
  if (raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

// points：[{ month, balance }]（由舊到新）；selectedIndex：點選的月份，沒有就是 null
// 全部都沒有資料時回傳 null
export function trendSvg(points, selectedIndex = null) {
  const values = points.map((p) => p.balance).filter((v) => v !== null);
  if (values.length === 0) return null;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1000);
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / 3);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const x = (i) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

  // 線：遇到沒輸入的月份就斷開
  let path = '';
  let penDown = false;
  points.forEach((p, i) => {
    if (p.balance === null) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`;
    penDown = true;
  });

  const grid = ticks.map((v) => `
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="trend-grid"/>
    <text x="${PAD.left - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" class="trend-axis">${compactAmount(v)}</text>`).join('');

  const xLabels = points.map((p, i) => `
    <text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="trend-axis${i === selectedIndex ? ' trend-axis-selected' : ''}">${Number(p.month.slice(5))}月</text>`).join('');

  const dots = points.map((p, i) => (p.balance === null ? '' : `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.balance).toFixed(1)}" r="${i === selectedIndex ? 5 : 4}"
      fill="${LINE_COLOR}" stroke="var(--card)" stroke-width="2"/>`)).join('');

  // 點選的月份：垂直參考線 + 數值
  let selected = '';
  if (selectedIndex !== null && points[selectedIndex]) {
    const p = points[selectedIndex];
    const sx = x(selectedIndex);
    const label = `${p.month}  ${p.balance === null ? '未輸入' : formatAmount(p.balance)}`;
    const anchor = sx < W * 0.3 ? 'start' : sx > W * 0.7 ? 'end' : 'middle';
    selected = `
      <line x1="${sx.toFixed(1)}" x2="${sx.toFixed(1)}" y1="${PAD.top - 4}" y2="${PAD.top + plotH}" class="trend-cross"/>
      <text x="${sx.toFixed(1)}" y="${PAD.top - 12}" text-anchor="${anchor}" class="trend-value">${escapeHtml(label)}</text>`;
  }

  // 點擊範圍：每個月一整條直欄，比點本身大很多，手指比較好點
  const colW = n === 1 ? plotW : plotW / (n - 1);
  const hits = points.map((p, i) => `
    <rect class="trend-hit" data-index="${i}" x="${(x(i) - colW / 2).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${H}">
      <title>${p.month} ${p.balance === null ? '未輸入' : formatAmount(p.balance)}</title>
    </rect>`).join('');

  return `
  <svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="最近 ${n} 個月的帳戶餘額趨勢">
    ${grid}
    ${selected}
    <path d="${path}" fill="none" stroke="${LINE_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
    ${hits}
  </svg>`;
}
