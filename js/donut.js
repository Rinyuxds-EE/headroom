// 圓環圖（SPEC 4.3）：自己用 SVG 畫，不用圖表函式庫
// 只負責畫圖；分塊的金額和百分比由 calc.js 的 donutSegments 算好

import { formatAmount } from './calc.js';
import { escapeHtml } from './ui/dom.js';

// 各區塊的顏色
// 順序經過色盲模擬驗證：相鄰的兩塊（包含沒有上月超支、沒有自訂類別時）都分得開
// 固定支出各項用同一組灰色的深淺（由深到淺），讓人看得出是同一組；
// 分期用低調的藍綠色，接在最淺的灰色後面；彈性剩餘用綠色；彈性已花用洋紅，跟綠色在色盲下也分得開
const COLORS = {
  installments: '#1f8a7a',
  prevOverspend: '#d95926',
  living: '#3987e5',
  flexSpent: '#d55181',
  flexRemaining: '#2ea043',
};
const FIXED_DARK = [0x57, 0x60, 0x6a];  // #57606a
const FIXED_LIGHT = [0xc9, 0xd1, 0xd9]; // #c9d1d9
// 自訂類別依它在類別清單裡的位置固定配色（顏色跟著類別走，不會因為其他類別有沒有花費而改變）
const CATEGORY_COLORS = ['#c98500', '#9085e9', '#199e70'];

// 固定支出第 i 項（共 n 項）的灰色：第一項最深、最後一項最淺
function fixedShade(i, n) {
  const t = n <= 1 ? 0.5 : i / (n - 1);
  const rgb = FIXED_DARK.map((d, k) => Math.round(d + (FIXED_LIGHT[k] - d) * t));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// 算出每一塊的顏色，回傳 Map（key → 顏色）
// categoryIndex(id) 回傳類別在清單裡的位置
export function segmentColors(donut, categoryIndex) {
  const colors = new Map();
  const fixedSegs = donut.segments.filter((s) => s.group === 'fixed');
  fixedSegs.forEach((s, i) => colors.set(s.key, fixedShade(i, fixedSegs.length)));
  for (const s of donut.segments) {
    if (colors.has(s.key)) continue;
    if (s.key.startsWith('category:')) {
      const index = Math.max(0, categoryIndex(s.key.slice(9)));
      // 超過 3 個類別時顏色會重複，靠圖例的文字分辨
      colors.set(s.key, CATEGORY_COLORS[index % CATEGORY_COLORS.length]);
    } else {
      colors.set(s.key, COLORS[s.key]);
    }
  }
  // 圖例小標題「固定支出」用中間的灰色
  colors.set('fixed', fixedShade(0, 1));
  return colors;
}

const SIZE = 200;
const RADIUS = 78;
const STROKE = 24;
const GAP = 2; // 相鄰兩塊之間的間隙（SVG 單位）

// 產生圓環圖的 SVG 字串
// donut：donutSegments 的結果；center：{ label, value, className }
// selectedKey：目前點選的區塊（其他區塊會變淡），沒有就是 null
// selectedKey 是 'fixed' 時，強調整組固定支出
export function donutSvg(donut, center, colors, selectedKey = null) {
  const circumference = 2 * Math.PI * RADIUS;
  const isSelected = (seg) => seg.key === selectedKey || (selectedKey === 'fixed' && seg.group === 'fixed');
  const visible = donut.segments.filter((s) => s.amount > 0);
  const useGap = visible.length > 1;

  let offset = 0;
  const arcs = visible.map((seg) => {
    const length = (seg.amount / donut.denominator) * circumference;
    const drawn = Math.max(0.5, useGap ? length - GAP : length);
    const dim = selectedKey && !isSelected(seg);
    // stroke-dasharray 畫出這一段弧，stroke-dashoffset 決定它從哪裡開始
    const arc = `<circle class="donut-arc${dim ? ' dim' : ''}" data-key="${escapeHtml(seg.key)}"
      cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}" fill="none"
      stroke="${colors.get(seg.key)}" stroke-width="${STROKE}"
      stroke-dasharray="${drawn} ${circumference - drawn}" stroke-dashoffset="${-offset}">
      <title>${escapeHtml(seg.label)} ${seg.percent}%（${formatAmount(seg.amount)}）</title>
    </circle>`;
    offset += length;
    return arc;
  });

  // 超支時圓環外圈加紅色細框
  const outerRing = donut.overspend > 0
    ? `<circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS + STROKE / 2 + 4}" fill="none" stroke="var(--red)" stroke-width="2"/>`
    : '';

  // 中心數字依長度縮小，避免超出圓環
  const valueText = center.value;
  const fontSize = Math.min(30, 120 / (valueText.length * 0.62));

  return `
  <svg class="donut" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${escapeHtml(center.label)} ${escapeHtml(valueText)}">
    <g transform="rotate(-90 ${SIZE / 2} ${SIZE / 2})">
      <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}" fill="none" stroke="var(--border)" stroke-width="${STROKE}" opacity="0.4"/>
      ${arcs.join('')}
    </g>
    ${outerRing}
    <text class="donut-label" x="${SIZE / 2}" y="${SIZE / 2 - 18}" text-anchor="middle">${escapeHtml(center.label)}</text>
    <text class="donut-value num ${center.className || ''}" x="${SIZE / 2}" y="${SIZE / 2 + 12}" text-anchor="middle"
      style="font-size:${fontSize.toFixed(1)}px">${escapeHtml(valueText)}</text>
  </svg>`;
}
