'use strict';
/* Logseq 计划助手 - 前端 */
const $ = s => document.querySelector(s);

let DATA = null;        // /api/data 结果
let VIEW = null;        // {type:'page', name}
let PAGE = null;        // 当前页面数据 {name, lines, blocks}

const STATUS_ORDER = ['NOW', 'LATER', 'TODO', 'DOING', 'DONE', 'CANCELED', ''];
const ADD_STATUS = ['', 'TODO', 'NOW', 'LATER'];

function api(path, opts) {
  return fetch(path, opts).then(r => r.json().then(j => ({ ok: r.ok, status: r.status, body: j })));
}
function post(path, data) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 渲染块文本：[[页面链接]]、URL、**加粗** */
function renderText(text) {
  let h = escapeHtml(text);
  h = h.replace(/\[\[([^\]]+)\]\]/g, (m, p) => `<a class="wikilink" data-page="${escapeHtml(p.trim())}" href="#">${p.trim()}</a>`);
  h = h.replace(/https?:\/\/[^\s<>"）】]+[^\s<>"）】.,;、。，；]/g, u => {
    const esc = escapeHtml(u);
    return `<a class="ext" href="${esc}" target="_blank" rel="noreferrer" title="${esc}">${esc.length > 52 ? esc.slice(0, 52) + '…' : esc}</a>`;
  });
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}

function monthZh(name) {
  const m = /^plan-(\d{4})-(\d{2})$/.exec(name);
  return m ? `${m[1]} 年 ${+m[2]} 月` : name;
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.hidden = false;
  t.classList.remove('pop');
  void t.offsetWidth;
  t.classList.add('pop');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ---------- 侧边栏 ---------- */
function renderSidebar() {
  $('#graphName').textContent = DATA.graphName;
  const curKey = `plan-${DATA.today.year}-${String(DATA.today.month).padStart(2, '0')}`;
  const byYear = new Map();
  for (const m of DATA.months.slice().reverse()) {
    if (!byYear.has(m.year)) byYear.set(m.year, []);
    byYear.get(m.year).push(m);
  }
  let html = '';
  for (const [year, list] of byYear) {
    html += `<div class="year">${year}</div>`;
    for (const m of list) {
      const cls = [];
      if (m.name === curKey) cls.push('current');
      if (VIEW && VIEW.type === 'page' && VIEW.name === m.name) cls.push('active');
      html += `<a class="nav-item month ${cls.join(' ')}" data-name="${m.name}"><span class="m-name">${+m.month} 月</span>${m.name === curKey ? '<span class="dot" title="当前月"></span>' : ''}</a>`;
    }
  }
  $('#monthList').innerHTML = html;
  $('#monthList').querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => loadPage(a.dataset.name)));
  renderPageList();
}

function renderPageList() {
  const q = ($('#pageFilter').value || '').toLowerCase();
  let html = '';
  for (const p of DATA.pages) {
    if (q && !p.toLowerCase().includes(q)) continue;
    const active = VIEW && VIEW.type === 'page' && VIEW.name === p;
    html += `<a class="nav-item page ${active ? 'active' : ''}" data-name="${escapeHtml(p)}">${escapeHtml(p)}</a>`;
  }
  $('#pageList').innerHTML = html || '<div class="muted-small" style="padding:4px 10px">无匹配</div>';
  $('#pageList').querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => loadPage(a.dataset.name)));
}

/* ---------- 页面加载与渲染 ---------- */
async function loadPage(name) {
  const keepScroll = PAGE && PAGE.name === name;
  const y = keepScroll ? window.scrollY : 0;
  const r = await api('/api/page?name=' + encodeURIComponent(name));
  if (!r.ok) { toast(r.body.error || '加载失败', true); return; }
  PAGE = r.body;
  VIEW = { type: 'page', name: name };
  location.hash = name;
  renderSidebar();
  renderPage();
  if (keepScroll) window.scrollTo(0, y);
}

/* 分区配色：让不同板块一眼可辨 */
const SECTION_COLORS = [
  [/健康|health/i, '#3f9160', '#2c6b45'],
  [/学习|课程|course/i, '#3b74d1', '#2b59a6'],
  [/book|书/i, '#7a5bc4', '#5b419c'],
  [/电影|movie/i, '#c2567e', '#9c3a60'],
  [/娱乐|game|Mos/i, '#d0772d', '#a55a17'],
  [/工作|jobs/i, '#2588a2', '#1a677e'],
  [/自媒体|wemedia/i, '#c04f98', '#973874'],
  [/Bonus|理财|money/i, '#b08a2e', '#82651b'],
  [/冥想/i, '#64748b', '#49586b'],
];
const FALLBACK_COLORS = [['#3b74d1', '#2b59a6'], ['#c2567e', '#9c3a60'], ['#2588a2', '#1a677e'], ['#d0772d', '#a55a17'], ['#7a5bc4', '#5b419c'], ['#3f9160', '#2c6b45'], ['#c04f98', '#973874'], ['#64748b', '#49586b']];
function sectionColor(title) {
  const t = String(title || '').replace(/\[\[|\]\]/g, '');
  for (const [re, a, i] of SECTION_COLORS) if (re.test(t)) return { a: a, i: i };
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const p = FALLBACK_COLORS[h % FALLBACK_COLORS.length];
  return { a: p[0], i: p[1] };
}
const GOLD = { a: '#b08a2e', i: '#82651b' };

let plainBuf = [], plainLines = 0;

function renderPage() {
  hideMetaPanel();
  const name = PAGE.name;
  const isPlan = /^plan-\d{4}-\d{2}$/.test(name);
  $('#pageTitle').innerHTML = isPlan ? monthZh(name) + ' <span class="title-suffix">计划</span>' : escapeHtml(name);
  const isCur = name === `plan-${DATA.today.year}-${String(DATA.today.month).padStart(2, '0')}`;

  const tasks = PAGE.blocks.filter(b => b.kind === 'task' && b.text);
  const open = tasks.filter(b => b.status && b.status !== 'DONE' && b.status !== 'CANCELED');
  const done = tasks.filter(b => b.status === 'DONE' || b.status === 'CANCELED');
  $('#pageMeta').innerHTML =
    `<span class="meta-chip on link" data-kind="open">${open.length} 项进行中</span>` +
    `<span class="meta-chip ok link" data-kind="done">${done.length} 项已完成</span>` +
    (isCur ? '<span class="meta-chip cur">当前月</span>' : '');

  const total = open.length + done.length;
  const pct = total ? Math.round(done.length / total * 100) : 0;
  $('#progress').hidden = !total;
  $('#progress').innerHTML = `<div class="progress-bar" style="width:${pct}%"></div><span class="progress-label">${pct}%</span>`;

  $('#btnGen').hidden = !isPlan;
  $('#btnOpenLogseq').hidden = false;
  $('#btnOpenLogseq').onclick = () => {
    window.open(`logseq://graph/${encodeURIComponent(DATA.graphName)}?page=${encodeURIComponent(name)}`);
  };

  const curName = `plan-${DATA.today.year}-${String(DATA.today.month).padStart(2, '0')}`;
  const curExists = DATA.months.some(m => m.name === curName);
  if (isPlan && !curExists) {
    $('#banner').innerHTML = `<div class="banner">📌 本月（${monthZh(curName)}）还没有计划。<button class="btn small primary" id="bannerGen">立即生成</button></div>`;
    $('#bannerGen').addEventListener('click', openGenDialog);
  } else {
    $('#banner').innerHTML = '';
  }

  const c = $('#content');
  c.innerHTML = '';
  let sectionEl = null, lastSection = null;
  plainBuf = []; plainLines = 0;
  let secState = null; // {badge, total, done}

  // 预处理：把连续的"数字型小节标题"（理财参考表）合并成一条
  const blocks = mergeRefTables(PAGE.blocks);

  const flushPlain = () => {
    if (!plainBuf.length) return;
    const wrap = document.createElement('div');
    if (plainLines > 8) {
      const d = document.createElement('details');
      d.className = 'plain-details';
      d.innerHTML = `<summary>📄 模板 / 笔记（${plainLines} 行）</summary>`;
      const inner = document.createElement('div');
      inner.className = 'plain-body';
      inner.innerHTML = plainBuf.join('');
      d.appendChild(inner);
      wrap.appendChild(d);
    } else {
      wrap.className = 'plain-inline';
      wrap.innerHTML = plainBuf.join('');
    }
    sectionEl.appendChild(wrap);
    plainBuf = []; plainLines = 0;
  };

  const newSection = (title) => {
    sectionEl = document.createElement('section');
    sectionEl._lastEnd = -1;
    sectionEl._taskCount = 0;
    sectionEl._hasContent = false;
    sectionEl._linked = false;
    sectionEl._untitled = !title;
    if (!title) sectionEl.classList.add('no-title');
    const color = sectionColor(title);
    sectionEl.style.setProperty('--sec', color.a);
    sectionEl.style.setProperty('--sec-ink', color.i);
    let badge = null;
    if (title) {
      const h = document.createElement('h2');
      h.innerHTML = renderText(title) + ' <span class="sec-badge"></span>';
      badge = h.querySelector('.sec-badge');
      sectionEl.appendChild(h);
    }
    c.appendChild(sectionEl);
    secState = { badge: badge, total: 0, done: 0 };
    lastSection = title;
  };

  const ensureSection = (title) => {
    if (sectionEl && title === lastSection) return;
    flushPlain();
    newSection(title);
  };

  const bumpTask = (b) => {
    if (!secState) return;
    secState.total++;
    if (b.status === 'DONE' || b.status === 'CANCELED') secState.done++;
    sectionEl._taskCount = secState.total;
    if (secState.badge) {
      const left = secState.total - secState.done;
      secState.badge.textContent = left > 0 ? left + ' 项待办' : (secState.total ? '全部完成 ✓' : '');
      secState.badge.classList.toggle('all-done', left === 0 && secState.total > 0);
    }
  };

  for (const b of blocks) {
    if (b.kind === 'refblock') {
      flushPlain();
      ensureSection(b.title);
      sectionEl._noAdd = true;
      sectionEl.style.setProperty('--sec', GOLD.a);
      sectionEl.style.setProperty('--sec-ink', GOLD.i);
      const d = document.createElement('details');
      d.className = 'plain-details ref-table';
      d.innerHTML = `<summary>📑 参考表（${b.items.length} 条）</summary><div class="plain-body">${
        b.items.map(x => `<div class="plain-line">${renderText(x.text)}</div>`).join('')}</div>`;
      sectionEl.appendChild(d);
      continue;
    }
    if (b.kind === 'heading' && b.level <= 2) {
      ensureSection(b.text);
      sectionEl._linked = /\[\[/.test(b.text);
      sectionEl._lastEnd = b.end;
      if (childLines(b).length) sectionEl._hasContent = true;
      pushChildPlain(b);
      continue;
    }
    if (!sectionEl) newSection('');
    ensureSection(b.section || '');
    if (b.kind === 'heading') {
      flushPlain();
      const h = document.createElement('h3');
      h.innerHTML = renderText(b.text);
      sectionEl.appendChild(h);
      sectionEl._hasContent = true;
      sectionEl._lastEnd = b.end;
      pushChildPlain(b);
      continue;
    }
    if (b.kind === 'task' || (b.kind === 'bullet' && b.text)) {
      flushPlain();
      const wrap = blockEl(b);
      sectionEl.appendChild(wrap);
      if (b.kind === 'task') bumpTask(b);
      else sectionEl._hasContent = true;
      sectionEl._lastEnd = b.end;
    } else if (b.kind === 'bullet') {
      if (childLines(b).length) sectionEl._hasContent = true;
      pushChildPlain(b);
      sectionEl._lastEnd = b.end;
    }
  }
  flushPlain();

  // 添加入口：只出现在真正记任务的地方
  // （链接型分区如 [[工作]]、模板型分区如健康、开头区、利息表都不显示）
  const sections = c.querySelectorAll('section');
  sections.forEach((sec) => {
    if (sec._noAdd || sec._untitled || sec._linked) return;
    if (sec._taskCount === 0 && sec._hasContent) return;
    attachAddBar(sec);
  });
}

/* 连续的、标题含数字的二级标题（如 `## 1kw * 8% / 12 = 6.67W`）合并为一条参考表 */
function isRefHead(b) {
  return b.kind === 'heading' && b.level <= 2 && /\d/.test(b.text);
}
function mergeRefTables(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const b = raw[i];
    if (isRefHead(b)) {
      const group = [b];
      let j = i + 1;
      while (j < raw.length) {
        const n = raw[j];
        if (isRefHead(n)) { group.push(n); j++; continue; }
        if (n.kind === 'bullet' && !n.text) { j++; continue; } // 空占位行
        break;
      }
      if (group.length >= 2) {
        out.push({ kind: 'refblock', title: '利息表', items: group.slice(1) });
        i = j;
        continue;
      }
    }
    out.push(b);
    i++;
  }
  return out;
}

function pushChildPlain(b) {
  const sub = childLines(b);
  if (!sub.length) return;
  plainBuf.push(sub.map(l => `<div class="plain-line">${renderText(l.replace(/\t/g, '    '))}</div>`).join(''));
  plainLines += sub.length;
}

function childLines(b) {
  const out = [];
  for (let k = b.start + 1; k <= b.end; k++) {
    const l = PAGE.lines[k];
    if (!l.trim()) continue;
    if (/^\s*:(LOGBOOK|END):\s*$/.test(l)) continue;
    if (/^\s*CLOCK:/.test(l)) continue;
    if (/^\s*\* State /.test(l)) continue;
    out.push(l);
  }
  return out;
}

/* ---------- 块渲染（含悬浮编辑/删除） ---------- */
function blockEl(b) {
  const isHigh = b.priority === 'A';
  const wrap = document.createElement('div');
  wrap.className = 'block' + (b.status === 'DONE' || b.status === 'CANCELED' ? ' is-done' : '') + (isHigh ? ' high-prio' : '');
  wrap.dataset.line = b.start;

  const row = document.createElement('div');
  row.className = b.kind === 'task' ? 'task' : 'plainline';
  if (b.kind === 'task') {
    row.innerHTML =
      `<span class="chip st-${b.status || 'none'}" data-line="${b.start}">${b.status || '·'}</span>` +
      (b.priority ? `<span class="prio p-${b.priority}" title="优先级 ${b.priority}">${isHigh ? '❗' : ''}${b.priority}</span>` : '') +
      `<span class="task-text">${renderText(b.text)}</span>`;
  } else {
    row.innerHTML = `<span class="task-text">${renderText(b.text)}</span>`;
  }
  wrap.appendChild(row);

  const sub = childLines(b);
  if (sub.length) {
    const d = document.createElement('div');
    d.className = 'task-sub';
    d.innerHTML = sub.map(l => `<div>${renderText(l.replace(/\t/g, '    '))}</div>`).join('');
    wrap.appendChild(d);
  }

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.innerHTML = `<button class="ra ra-edit" title="编辑">✎</button><button class="ra ra-del" title="删除">✕</button>`;
  wrap.appendChild(actions);

  actions.querySelector('.ra-edit').addEventListener('click', e => { e.stopPropagation(); startEdit(wrap, b); });
  actions.querySelector('.ra-del').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('删除这条内容？（连同其子内容，旧月份数据建议保留）')) return;
    const r = await post('/api/delete', { name: PAGE.name, line: b.start });
    if (!r.ok) { toast(r.body.message || r.body.error || '删除失败', true); return; }
    noteSelfWrite(PAGE.name);
    toast('已删除');
    loadPage(PAGE.name);
  });

  const chip = row.querySelector('.chip');
  if (chip) chip.addEventListener('click', e => { e.stopPropagation(); showStatusMenu(e.clientX, e.clientY, b); });
  return wrap;
}

/* ---------- 行内编辑 ---------- */
function startEdit(wrap, b) {
  if (wrap.querySelector('.editor')) return;
  const editor = document.createElement('div');
  editor.className = 'editor';
  editor.innerHTML =
    `<textarea spellcheck="false"></textarea>
     <div class="editor-actions">
       <span class="muted-small">Enter 保存 · Esc 取消</span>
       <button class="btn small ghost ed-cancel">取消</button>
       <button class="btn small primary ed-save">保存</button>
     </div>`;
  const ta = editor.querySelector('textarea');
  ta.value = b.text;
  wrap.style.display = 'none';
  wrap.parentNode.insertBefore(editor, wrap.nextSibling);
  ta.focus();
  ta.selectionStart = ta.value.length;

  const cancel = () => { editor.remove(); wrap.style.display = ''; };
  const save = async () => {
    const text = ta.value.trim();
    if (!text) { toast('内容不能为空', true); return; }
    const r = await post('/api/edit', { name: PAGE.name, line: b.start, text: text });
    if (!r.ok) { toast(r.body.message || r.body.error || '保存失败', true); return; }
    noteSelfWrite(PAGE.name);
    toast('已保存');
    loadPage(PAGE.name);
  };
  editor.querySelector('.ed-cancel').addEventListener('click', cancel);
  editor.querySelector('.ed-save').addEventListener('click', save);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') cancel();
  });
}

/* ---------- 分区末尾新增 ---------- */
function attachAddBar(sectionEl) {
  const bar = document.createElement('div');
  bar.className = 'add-bar';
  bar.innerHTML = `<button class="add-btn">＋ 添加</button>
    <div class="add-form" hidden>
      <select class="add-status">${ADD_STATUS.map(s => `<option value="${s}">${s === '' ? '无状态' : s}</option>`).join('')}</select>
      <input class="add-input" placeholder="新条目内容，Enter 添加…">
      <button class="btn small primary add-ok">添加</button>
      <button class="btn small ghost add-cancel">取消</button>
    </div>`;
  sectionEl.appendChild(bar);
  const btn = bar.querySelector('.add-btn');
  const form = bar.querySelector('.add-form');
  const input = bar.querySelector('.add-input');
  const show = () => {
    btn.hidden = true; form.hidden = false; input.focus();
  };
  const hide = () => { btn.hidden = false; form.hidden = true; input.value = ''; };
  btn.addEventListener('click', show);
  bar.querySelector('.add-cancel').addEventListener('click', hide);
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    const afterLine = sectionEl._lastEnd != null ? sectionEl._lastEnd : -1;
    const r = await post('/api/add', {
      name: PAGE.name, afterLine: afterLine,
      status: bar.querySelector('.add-status').value, text: text
    });
    if (!r.ok) { toast(r.body.error || '添加失败', true); return; }
    noteSelfWrite(PAGE.name);
    toast('已添加');
    loadPage(PAGE.name);
  };
  bar.querySelector('.add-ok').addEventListener('click', submit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') hide();
  });
}

/* ---------- 进行中 / 已完成 清单面板 ---------- */
function hideMetaPanel() {
  const p = document.querySelector('#metaPanel');
  if (p) p.remove();
}
function toggleMetaPanel(kind) {
  const existing = document.querySelector('#metaPanel');
  if (existing) {
    if (existing.dataset.kind === kind) { existing.remove(); return; }
    existing.remove();
  }
  const tasks = PAGE.blocks.filter(b => b.kind === 'task' && b.text);
  const list = kind === 'open'
    ? tasks.filter(b => b.status && b.status !== 'DONE' && b.status !== 'CANCELED')
    : tasks.filter(b => b.status === 'DONE' || b.status === 'CANCELED');
  const panel = document.createElement('div');
  panel.id = 'metaPanel';
  panel.dataset.kind = kind;
  let html = `<div class="mp-title">${kind === 'open' ? '进行中' : '已完成'} · ${list.length}</div>`;
  html += list.map(b =>
    `<div class="mp-row" data-line="${b.start}">
       <span class="chip st-${b.status || 'none'}">${b.status || '·'}</span>
       ${b.priority ? `<span class="prio p-${b.priority}">${b.priority}</span>` : ''}
       <span class="mp-text">${renderText(b.text)}</span>
       ${b.section ? `<span class="mp-sec">${escapeHtml(b.section.replace(/\[\[|\]\]/g, ''))}</span>` : ''}
     </div>`).join('');
  if (!list.length) html += '<div class="mp-empty">暂无</div>';
  panel.innerHTML = html;
  panel.addEventListener('click', e => {
    const row = e.target.closest('.mp-row');
    if (!row) return;
    hideMetaPanel();
    scrollToBlock(parseInt(row.dataset.line, 10));
  });
  document.querySelector('.head-titles').appendChild(panel);
}
function scrollToBlock(line) {
  const el = document.querySelector('.block[data-line="' + line + '"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/* ---------- 状态菜单 ---------- */
function showStatusMenu(x, y, block) {
  const menu = $('#statusMenu');
  let html = '';
  for (const s of STATUS_ORDER) {
    const cur = (block.status || '') === s;
    html += `<div class="sm-item ${cur ? 'cur' : ''}" data-s="${s}">${s ? `<span class="chip st-${s}">${s}</span>` : '<span class="chip st-none">无状态</span>'}</div>`;
  }
  menu.innerHTML = html;
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y + 6, window.innerHeight - rect.height - 8) + 'px';
  menu.querySelectorAll('.sm-item').forEach(item => {
    item.addEventListener('click', async () => {
      menu.hidden = true;
      const r = await post('/api/status', { name: PAGE.name, line: block.start, status: item.dataset.s });
      if (!r.ok) { toast(r.body.error || '修改失败', true); return; }
      noteSelfWrite(PAGE.name);
      toast('已更新状态');
      loadPage(PAGE.name);
    });
  });
}
document.addEventListener('click', e => {
  $('#statusMenu').hidden = true;
  if (!e.target.closest('#metaPanel') && !e.target.closest('.meta-chip.link')) hideMetaPanel();
});
// 顶部统计 chip：点击在当前位置展开清单
document.addEventListener('click', e => {
  const chip = e.target.closest('.meta-chip.link');
  if (!chip) return;
  e.stopPropagation();
  toggleMetaPanel(chip.dataset.kind);
});

/* ---------- wikilink 跳转（页面不存在则创建，和 logseq 行为一致） ---------- */
document.addEventListener('click', async e => {
  const a = e.target.closest('a.wikilink');
  if (!a) return;
  e.preventDefault();
  const name = a.dataset.page;
  if (!name) return;
  if (DATA.months.some(m => m.name === name) || DATA.pages.includes(name)) {
    loadPage(name);
    return;
  }
  const r = await post('/api/create-page', { name: name });
  if (!r.ok) { toast(r.body.error || '创建失败', true); return; }
  await refreshData();
  toast('已创建页面：' + name);
  loadPage(name);
});

/* ---------- 实时同步（SSE） ---------- */
let lastSelfWrite = { file: null, at: 0 };
function noteSelfWrite(name) { lastSelfWrite = { file: name + '.md', at: Date.now() }; }
let reloadTimer = null;
function scheduleReload(file) {
  if (!PAGE || file !== PAGE.name + '.md') return;
  if (file === lastSelfWrite.file && Date.now() - lastSelfWrite.at < 2000) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadPage(PAGE.name), 400);
}
function connectEvents() {
  const dot = $('#syncDot'), txt = $('#syncText');
  const es = new EventSource('/api/events');
  es.onopen = () => { dot.className = 'sync-dot on'; txt.textContent = '已连接，自动同步'; };
  es.onerror = () => { dot.className = 'sync-dot off'; txt.textContent = '连接断开，重试中…'; };
  es.onmessage = e => {
    try { scheduleReload(JSON.parse(e.data).file); } catch (_) {}
  };
  // 从别的窗口切回来时也刷新一次
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && PAGE) loadPage(PAGE.name);
  });
}

/* ---------- 生成新月计划 ---------- */
function nextMonth(ym) {
  const m = /^plan-(\d{4})-(\d{2})$/.exec(ym);
  let y = +m[1], mo = +m[2] + 1;
  if (mo > 12) { mo = 1; y++; }
  return y + '-' + String(mo).padStart(2, '0');
}

function openGenDialog() {
  if (!DATA.months.length) { toast('还没有任何月度计划', true); return; }
  const dlg = $('#genDialog');
  const sel = $('#genSource');
  sel.innerHTML = `<option value="">不携带（纯模板）</option>` +
    DATA.months.slice().reverse()
      .map(m => `<option value="${m.name}">${monthZh(m.name)}</option>`).join('');
  sel.value = DATA.months[DATA.months.length - 1].name;
  $('#genTarget').value = nextMonth(sel.value === '' ? DATA.months[DATA.months.length - 1].name : sel.value);
  $('#genPreview').hidden = true;
  $('#genPreview').innerHTML = '';
  $('#genOverwrite').hidden = true;
  $('#genGo').disabled = true;
  $('#genPreviewBtn').textContent = '预览';
  dlg.showModal();
  sel.onchange = () => {
    const base = sel.value === '' ? DATA.months[DATA.months.length - 1].name : sel.value;
    $('#genTarget').value = nextMonth(base);
    $('#genPreview').hidden = true;
    $('#genGo').disabled = true;
  };
}

async function previewGen() {
  const source = $('#genSource').value;
  const target = $('#genTarget').value.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(target)) { toast('目标月份格式应为 YYYY-MM', true); return; }
  const r = await post('/api/preview', { source: source, target: target, cleanOpen: $('#genClean').checked });
  if (!r.ok) { toast(r.body.error || '预览失败', true); return; }
  const d = r.body;
  const carried = d.carried, done = d.droppedDone;
  let html =
    `<div class="pv-row ok">✓ 模板 + ${carried.length} 项未完成事项</div>
     <div class="pv-row bad">✕ 跳过 ${done.length} 项已完成</div>`;
  if (carried.length) {
    html += `<details class="pv-details"><summary>携带的条目（按分区）</summary><ul>${carried.map(x =>
      `<li>${x.section ? `<span class="pv-sec">${escapeHtml(x.section.replace(/\[\[|\]\]/g, ''))}</span>` : ''}<span class="chip st-${x.status}">${x.status}</span> ${renderText(x.text)}</li>`).join('')}</ul></details>`;
  }
  if (done.length) {
    html += `<details class="pv-details"><summary>跳过的已完成条目</summary><ul>${done.map(x =>
      `<li><s>${renderText(x.text)}</s></li>`).join('')}</ul></details>`;
  }
  const pv = $('#genPreview');
  pv.innerHTML = html;
  pv.hidden = false;
  $('#genOverwrite').hidden = !d.targetExists;
  $('#genGo').disabled = false;
  $('#genGo').dataset.target = target;
  $('#genGo').dataset.source = source;
}

async function submitGen() {
  if ($('#genOverwrite').hidden === false && !$('#genOverwriteChk').checked) {
    toast('请先勾选确认覆盖', true); return;
  }
  const r = await post('/api/generate', {
    source: $('#genGo').dataset.source,
    target: $('#genGo').dataset.target,
    cleanOpen: $('#genClean').checked,
    overwrite: !$('#genOverwrite').hidden && $('#genOverwriteChk').checked
  });
  if (!r.ok) { toast(r.body.error === 'EXISTS' ? '目标已存在，请勾选覆盖' : (r.body.error || '生成失败'), true); return; }
  $('#genDialog').close();
  toast(`已生成 ${$('#genGo').dataset.target}：模板 + 携带 ${r.body.carried} 项`);
  await refreshData();
  loadPage('plan-' + $('#genGo').dataset.target);
}

/* ---------- 初始化 ---------- */
async function refreshData() {
  const r = await api('/api/data');
  DATA = r.body;
}

async function init() {
  await refreshData();
  renderSidebar();
  $('#pageFilter').addEventListener('input', renderPageList);
  $('#btnGen').addEventListener('click', openGenDialog);
  $('#genPreviewBtn').addEventListener('click', previewGen);
  $('#genGo').addEventListener('click', submitGen);
  $('#genCancel').addEventListener('click', () => $('#genDialog').close());
  $('#btnReload').addEventListener('click', () => {
    if (PAGE) loadPage(PAGE.name);
    refreshData().then(renderSidebar);
  });
  connectEvents();

  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && (DATA.months.some(m => m.name === hash) || DATA.pages.includes(hash))) {
    loadPage(hash);
  } else if (DATA.months.length) {
    // 默认打开当前月；没有则打开最近一个已过去的月份
    const curName = `plan-${DATA.today.year}-${String(DATA.today.month).padStart(2, '0')}`;
    let openName = curName;
    if (!DATA.months.some(m => m.name === curName)) {
      const past = DATA.months.filter(m =>
        m.year < DATA.today.year || (m.year === DATA.today.year && m.month <= DATA.today.month));
      openName = past.length ? past[past.length - 1].name : DATA.months[DATA.months.length - 1].name;
    }
    loadPage(openName);
  } else {
    $('#pageTitle').textContent = 'Logseq 计划助手';
    $('#content').innerHTML = '<div class="banner">pages/ 下还没有任何页面</div>';
  }
}

init();
