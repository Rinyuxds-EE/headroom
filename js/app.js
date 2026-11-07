// Headroom 進入點：啟動流程、畫面切換
// 啟動順序（SPEC 4.2）：讀資料 → 凍結月份快照 → 存檔 → 才開始渲染畫面
// 之後在「設定儲存前」和「從背景切回前景」時都會再做凍結檢查

import { toDateString, monthOf } from './calc.js';
import {
  loadData, saveData, checkMonth, applyChange, preserveCorrupted, createDefaultData, stashBeforeImport,
  clearAllData,
} from './storage.js';
import { renderSettings } from './ui/settings.js';
import { renderEntries } from './ui/entries.js';
import { renderHome } from './ui/home.js';
import { renderBalance } from './ui/balance.js';
import { openEntryPanel } from './ui/entry-panel.js';
import { escapeHtml, toast, copyText } from './ui/dom.js';

const app = document.getElementById('app');

// data：目前的資料（整份），所有畫面都透過 getData / commit 存取
// today / checkedMonth：上次凍結檢查時的今天和月份，畫面上的「本月」以它為準
const state = { data: null, today: null, checkedMonth: null };

// 現在的日期和月份（每次呼叫都重新讀時鐘）
function nowToday() {
  return toDateString(new Date());
}

// 啟動時的今天和本月（在凍結檢查之前，只給錯誤畫面和預設資料用）
const startToday = nowToday();
const currentMonth = monthOf(startToday);

const TABS = [
  { key: 'home', label: '首頁' },
  { key: 'entries', label: '明細' },
  { key: 'balance', label: '餘額' },
  { key: 'settings', label: '設定' },
];

function save() {
  if (!saveData(state.data)) {
    toast('儲存失敗，請確認手機儲存空間', 'error');
  }
}

// 修改資料並立刻存檔（SPEC 4.2）：
// 先用現在的月份凍結；如果月份已經換了，這次修改不套用，改成重新渲染畫面。
// 回傳是否套用了修改。
function commit(mutator) {
  const today = nowToday();
  const result = applyChange(state.data, state.checkedMonth, monthOf(today), mutator);
  if (result.applied || result.frozen > 0) save();
  if (result.monthChanged) {
    state.today = today;
    state.checkedMonth = monthOf(today);
    renderPage();
    toast(`已經換到 ${state.checkedMonth}，畫面已更新，請重新輸入`, 'error');
  }
  return result.applied;
}

// 從背景切回前景時（SPEC 4.2 時機 4）：月份變了就先凍結，再重新渲染畫面
function onVisible() {
  if (document.visibilityState !== 'visible' || !state.data) return;
  const today = nowToday();
  const result = checkMonth(state.data, state.checkedMonth, monthOf(today));
  if (result.frozen > 0) save();
  const dayChanged = today !== state.today;
  state.today = today;
  state.checkedMonth = monthOf(today);
  // 換日也重新渲染，讓畫面上的「今天」正確
  if (result.monthChanged || dayChanged) renderPage();
}

const ctx = {
  getData: () => state.data,
  commit,
  get today() { return state.today; },
  get currentMonth() { return state.checkedMonth; },
  // 資料改變後重畫目前的分頁，保留捲動位置
  refresh: () => renderPage(true),
  replaceData,
  resetAll,
};

// 清除所有資料（SPEC 3.9）：刪掉所有 headroom: 開頭的項目，回到第一次開啟的狀態（開始使用月份 = 當月）
// 回傳是否完成
function resetAll() {
  if (!clearAllData()) {
    toast('清除失敗', 'error');
    return false;
  }
  state.today = nowToday();
  state.checkedMonth = monthOf(state.today);
  state.data = createDefaultData(state.checkedMonth);
  save();
  if (location.hash === '#home') renderPage();
  else location.hash = 'home'; // hashchange 會重畫
  return true;
}

// 匯入備份（SPEC 3.9、4.2 時機 2）：先另存目前的資料，換成備份的資料，凍結快照，存檔，重畫
// 回傳是否完成
function replaceData(newData) {
  if (!stashBeforeImport(state.data)
    && !confirm('無法先另存目前的資料（儲存空間可能不足）。仍要匯入並覆蓋嗎？')) {
    return false;
  }
  state.data = newData;
  state.today = nowToday();
  state.checkedMonth = monthOf(state.today);
  checkMonth(state.data, state.checkedMonth, state.checkedMonth);
  if (!saveData(state.data)) {
    toast('儲存失敗，請確認手機儲存空間', 'error');
    return false;
  }
  renderPage();
  return true;
}

// ───────────── 主畫面 ─────────────

function currentTab() {
  const key = location.hash.replace('#', '');
  return TABS.some((t) => t.key === key) ? key : 'home';
}

function renderShell() {
  app.innerHTML = `
    <main id="page" class="app-content"></main>
    <button class="fab" data-action="add" aria-label="記一筆">＋</button>
    <nav class="tabbar">
      ${TABS.map((t) => `<a class="tab" href="#${t.key}" data-tab="${t.key}">${t.label}</a>`).join('')}
    </nav>
  `;
  // 右下角的＋：任何分頁都可以記帳
  app.querySelector('.fab').addEventListener('click', () => {
    openEntryPanel(ctx, { onDone: ctx.refresh });
  });
  window.addEventListener('hashchange', () => renderPage());
  document.addEventListener('visibilitychange', onVisible);
  renderPage();
}

// 渲染目前的分頁；keepScroll = true 時保留捲動位置（例如記完一筆後更新畫面）
function renderPage(keepScroll = false) {
  const tab = currentTab();
  app.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  const page = document.getElementById('page');
  const scrollY = window.scrollY;

  if (tab === 'settings') renderSettings(page, ctx);
  else if (tab === 'entries') renderEntries(page, ctx);
  else if (tab === 'balance') renderBalance(page, ctx);
  else renderHome(page, ctx);

  window.scrollTo(0, keepScroll ? scrollY : 0);
}

// ───────────── 錯誤畫面 ─────────────

// 無法存取 localStorage
function renderUnavailable(error) {
  app.innerHTML = `
    <div class="page">
      <h1 class="page-title negative">無法存取儲存空間</h1>
      <div class="card">
        <p>這個瀏覽器不允許 App 儲存資料（例如正在使用私密瀏覽）。請改用一般模式開啟。</p>
        <p class="hint num">${escapeHtml(error)}</p>
      </div>
    </div>`;
}

// 資料損壞：不覆蓋，讓使用者先複製或另存（SPEC 第 5 節）
function renderCorrupt(raw, error) {
  app.innerHTML = `
    <div class="page">
      <h1 class="page-title negative">資料無法讀取</h1>
      <div class="card">
        <p>儲存的資料損壞了，App 沒有覆蓋它。你可以先複製原始資料保存，或另存一份後重新開始。</p>
        <p class="hint num">原因：${escapeHtml(error)}</p>
        <textarea class="input raw-data num" readonly>${escapeHtml(raw)}</textarea>
        <div class="row">
          <button class="btn" data-action="copy">複製原始資料</button>
          <button class="btn btn-danger" data-action="restart">另存舊資料後重新開始</button>
        </div>
      </div>
    </div>`;

  app.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    const ok = await copyText(raw);
    toast(ok ? '已複製' : '複製失敗，請手動選取上面的文字', ok ? 'info' : 'error');
  });

  app.querySelector('[data-action="restart"]').addEventListener('click', () => {
    if (!confirm('舊資料會另存一份在手機裡，然後用空白資料重新開始。確定嗎？')) return;
    if (!preserveCorrupted(raw)) {
      alert('另存舊資料失敗，為了保護資料，沒有重新開始。請先用「複製原始資料」保存。');
      return;
    }
    startWith(createDefaultData(currentMonth), true);
  });
}

// ───────────── 啟動 ─────────────

// 用一份資料啟動（SPEC 4.2 時機 1）：先凍結快照、存檔，再渲染畫面
function startWith(data, mustSave) {
  state.data = data;
  state.today = nowToday();
  state.checkedMonth = monthOf(state.today);
  const { frozen } = checkMonth(state.data, state.checkedMonth, state.checkedMonth);
  if (mustSave || frozen > 0) save();
  renderShell();
}

function start() {
  const result = loadData(currentMonth);
  if (result.status === 'unavailable') renderUnavailable(result.error);
  else if (result.status === 'corrupt') renderCorrupt(result.raw, result.error);
  else startWith(result.data, result.status === 'new');
}

// ───────────── 離線（PWA） ─────────────

// 註冊 Service Worker，讓 App 沒網路也能開。只有 https 或 localhost 才能用
// （用區網 IP 在手機上測試時沒有，這是正常的）
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  // 已經有舊版本在運作時，新版本裝好後提示一下
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('已下載新版本，下次開啟 App 時生效');
  });

  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 註冊失敗不影響使用，只是不能離線
  });

  // 請瀏覽器不要自動清掉這個 App 的資料（瀏覽器可以拒絕，不影響使用）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

start();
registerServiceWorker();
