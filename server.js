#!/usr/bin/env node
/*
 * Logseq 月度计划助手
 * 零依赖本地服务：读取/写回 Logseq 库中的 markdown 文件。
 *   用法: node server.js [graph目录] [--port N] [--no-open]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const execFile = require('child_process').execFile;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
const graphArg = argv.find(function (a) { return !a.startsWith('--'); });
function defaultGraph() {
  if (process.env.LOGSEQ_HOME) return process.env.LOGSEQ_HOME;
  const sibling = path.join(__dirname, '..', 'logseq');           // 工具与 logseq 库同级时
  if (fs.existsSync(path.join(sibling, 'pages'))) return sibling;
  return path.join(os.homedir(), 'Documents', 'logseq');          // 本机默认位置
}
const GRAPH = path.resolve(graphArg || defaultGraph());
const PAGES = path.join(GRAPH, 'pages');
const BAK = path.join(GRAPH, 'logseq', 'bak', 'pages');
const PUBLIC = path.join(__dirname, 'public');
const PORT = parseInt(argValue('--port') || process.env.PORT || '5217', 10);
const NO_OPEN = argv.indexOf('--no-open') >= 0 || !!process.env.NO_OPEN;

if (!fs.existsSync(PAGES)) {
  console.error('找不到 Logseq 库目录: ' + PAGES);
  console.error('用法: node server.js /path/to/logseq-graph');
  process.exit(1);
}

// ---------- 解析 ----------
const STATUSES = ['NOW', 'LATER', 'TODO', 'DOING', 'DONE', 'WAITING', 'CANCELED'];
const TASK_RE = /^(\s*)-\s+(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED)\s*(\[#([A-C])\])?\s*(.*?)\s*$/;
const BULLET_RE = /^(\s*)-(?:\s(.*))?$/;
const NUM_RE = /^(\s*)(\d+[.)]\s+)(.*)$/;
const CLOCK_RE = /CLOCK:\s*\[([^\]]+)\](?:--\[([^\]]+)\]\s*=>\s*(\d+):(\d{2}):(\d{2}))?/;
const OPEN_CLOCK_RE = /^\s*CLOCK:\s*\[[^\]]+\]\s*$/;
const HEADING_RE = /^\s*(?:-\s+)?(#{1,6})\s+(.*?)\s*$/;

function indentWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\t') w += 4;
    else if (ch === ' ') w++;
    else break;
  }
  return w;
}

/* 把文件切成"块"：一个块 = 一条顶层 bullet 及其所有更深缩进的后续行。
 * 返回 [{start, end}]；未被任何块覆盖的非空行（如裸标题 `## x`）由调用方补成伪块。 */
function splitBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^(\s*)(?:-\s|-$|\*\s|\d+[.)]\s)/.exec(lines[i]);
    if (m) {
      const indent = indentWidth(m[1]);
      let j = i + 1;
      while (j < lines.length) {
        const lj = lines[j];
        if (!lj.trim()) {
          let k = j + 1;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && indentWidth(lines[k]) > indent) { j = k; continue; }
          break;
        }
        if (indentWidth(lj) <= indent) break;
        j++;
      }
      blocks.push({ start: i, end: j - 1 });
      i = j;
    } else {
      i++;
    }
  }
  return blocks;
}

function fillPseudoBlocks(lines, blocks) {
  const covered = new Array(lines.length).fill(false);
  blocks.forEach(function (b) { for (let k = b.start; k <= b.end; k++) covered[k] = true; });
  for (let i = 0; i < lines.length; i++) {
    if (!covered[i] && lines[i].trim()) blocks.push({ start: i, end: i });
  }
  blocks.sort(function (a, b) { return a.start - b.start; });
  return blocks;
}

function blockInfo(lines, b, section) {
  const first = lines[b.start];
  const info = { start: b.start, end: b.end, section: section.title, sectionLevel: section.level };
  const hm = HEADING_RE.exec(first);
  const tm = hm ? null : TASK_RE.exec(first);
  if (hm) {
    info.kind = 'heading';
    info.level = hm[1].length;
    info.text = hm[2];
  } else if (tm) {
    info.kind = 'task';
    info.status = tm[2];
    info.priority = tm[4] || null;
    info.text = tm[5];
  } else {
    const bl = BULLET_RE.exec(first);
    const nm = bl ? null : NUM_RE.exec(first);
    info.kind = 'bullet';
    info.text = bl ? (bl[2] || '') : (nm ? nm[3] : first.trim());
    info.text = info.text.trim();
    if (bl && (!bl[2] || /^:LOGBOOK:\s*$/.test(bl[2].trim()))) info.empty = true;
  }
  if (info.kind === 'task' && !info.text) info.empty = true;

  let seconds = 0, running = null;
  for (let k = b.start; k <= b.end; k++) {
    const cm = CLOCK_RE.exec(lines[k]);
    if (!cm) continue;
    if (cm[2]) seconds += (+cm[3]) * 3600 + (+cm[4]) * 60 + (+cm[5]);
    else if (!running) running = { start: cm[1] };
  }
  info.seconds = seconds;
  info.running = running;
  return info;
}

function parsePage(text) {
  const lines = text.split('\n');
  const raw = fillPseudoBlocks(lines, splitBlocks(lines));
  const blocks = [];
  let cur = { title: '', level: 0 };
  for (const b of raw) {
    const first = lines[b.start];
    const hm = HEADING_RE.exec(first);
    if (hm) {
      const level = hm[1].length;
      if (level <= 2) cur = { title: hm[2].trim(), level: level };
    }
    blocks.push(blockInfo(lines, b, cur));
  }
  return { lines: lines, blocks: blocks };
}

// ---------- 月计划生成（模板 + 携带未完成事项） ----------
const TEMPLATE_PAGE = '月计划模板';

function normalizeTitle(t) {
  return String(t).replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
}

/* 从源月份收集未完成任务块（含子行；cleanOpen 清理未关闭 CLOCK），DONE 单独列出 */
function collectCarried(sourceText, cleanOpen) {
  const lines = sourceText.split('\n');
  const blocks = fillPseudoBlocks(lines, splitBlocks(lines));
  const carried = [], droppedDone = [];
  let cur = { title: '', level: 0 };
  for (const b of blocks) {
    const info = blockInfo(lines, b, cur);
    if (info.kind === 'heading' && info.level <= 2) cur = { title: info.text, level: info.level };
    if (info.kind !== 'task' || !info.text) continue;
    if (info.status === 'DONE' || info.status === 'CANCELED') {
      droppedDone.push({ text: info.text, section: info.section });
      continue;
    }
    let idxs = [];
    for (let k = b.start; k <= b.end; k++) idxs.push(k);
    if (cleanOpen) {
      const openLines = idxs.filter(function (k) { return OPEN_CLOCK_RE.test(lines[k]); });
      if (openLines.length) {
        const hasClosed = idxs.some(function (k) { return /CLOCK:\s*\[[^\]]+\]--/.test(lines[k]); });
        const drop = new Set(openLines);
        if (!hasClosed) {
          idxs.forEach(function (k) {
            if (/^\s*:(LOGBOOK|END):\s*$/.test(lines[k])) drop.add(k);
          });
        }
        idxs = idxs.filter(function (k) { return !drop.has(k); });
      }
    }
    carried.push({
      section: info.section, status: info.status, priority: info.priority, text: info.text,
      lines: idxs.map(function (k) { return lines[k]; })
    });
  }
  return { carried: carried, droppedDone: droppedDone };
}

/* 模板内容 + 未完成事项（插入对应分区末尾）→ 新月计划的行 */
function buildFromTemplate(templateText, carried) {
  const lines = templateText.split('\n');
  const blocks = fillPseudoBlocks(lines, splitBlocks(lines));
  const spans = [];
  let cur = { title: '', start: 0 };
  for (const b of blocks) {
    const hm = HEADING_RE.exec(lines[b.start]);
    if (hm && hm[1].length <= 2) {
      spans.push({ title: cur.title, start: cur.start, end: b.start - 1 });
      cur = { title: hm[2].trim(), start: b.start };
    }
  }
  spans.push({ title: cur.title, start: cur.start, end: lines.length - 1 });

  const out = [];
  const used = new Set();
  for (const sp of spans) {
    for (let k = sp.start; k <= sp.end; k++) out.push(lines[k]);
    carried.forEach(function (c, i) {
      if (used.has(i)) return;
      if (normalizeTitle(c.section) !== normalizeTitle(sp.title)) return;
      out.push.apply(out, c.lines);
      used.add(i);
    });
  }
  // 模板里没有的分区 → 原样追加到末尾
  const bySec = new Map();
  carried.forEach(function (c, i) {
    if (used.has(i)) return;
    const key = c.section || '';
    if (!bySec.has(key)) bySec.set(key, []);
    bySec.get(key).push(c);
  });
  for (const [title, items] of bySec) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    if (title) out.push('## ' + title);
    items.forEach(function (c) { out.push.apply(out, c.lines); });
  }
  return out;
}

// ---------- 文件操作 ----------
function safeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length < 200 && !/[/\\\0]/.test(name) && name.endsWith('.md');
}
function pagePath(name) { return path.join(PAGES, name); }

function listData() {
  const files = fs.readdirSync(PAGES).filter(function (f) { return f.endsWith('.md'); });
  const months = [], pages = [];
  for (const f of files) {
    const name = f.slice(0, -3);
    const mm = /^plan-(\d{4})-(\d{2})$/.exec(name);
    if (mm) months.push({ name: name, year: +mm[1], month: +mm[2] });
    else pages.push(name);
  }
  months.sort(function (a, b) { return (a.year - b.year) || (a.month - b.month); });
  pages.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
  const now = new Date();
  return {
    graphName: path.basename(GRAPH),
    months: months,
    pages: pages,
    today: { year: now.getFullYear(), month: now.getMonth() + 1, date: now.getDate() }
  };
}

function timestampForBak() {
  return new Date().toISOString().replace(/:/g, '_');
}

/* ---------- 编辑 / 新增 / 删除（直接写回 md） ---------- */
function findBlockAt(blocks, line) {
  for (const b of blocks) { if (b.start === line) return b; }
  return null;
}

function sanitizeText(t) {
  return String(t == null ? '' : t).replace(/\s*\n\s*/g, '  ').trim().slice(0, 5000);
}

/* 按块的种类重写首行文本，保留状态/优先级/缩进等结构 */
function rebuildFirstLine(firstLine, text) {
  const tm = TASK_RE.exec(firstLine);
  if (tm) return tm[1] + '- ' + tm[2] + (tm[3] ? ' ' + tm[3] : '') + '  ' + text;
  const hm = HEADING_RE.exec(firstLine);
  if (hm) {
    const ind = (/^\s*/.exec(firstLine) || [''])[0];
    const dash = /^\s*-\s/.test(firstLine);
    return ind + (dash ? '- ' : '') + hm[1] + ' ' + text;
  }
  const nm = NUM_RE.exec(firstLine);
  if (nm) return nm[1] + nm[2] + text;
  const bl = BULLET_RE.exec(firstLine);
  if (bl) return bl[1] + '- ' + text;
  return null;
}

/* ---------- SSE：md 文件变化时通知前端刷新 ---------- */
const sseClients = new Set();
function broadcastFile(filename) {
  const msg = 'data: ' + JSON.stringify({ file: filename }) + '\n\n';
  sseClients.forEach(function (res) { try { res.write(msg); } catch (e) {} });
}
try {
  let watchTimer = null;
  fs.watch(PAGES, function (evt, filename) {
    if (!filename || !/\.md$/.test(filename)) return;
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(function () { broadcastFile(filename); }, 350);
  });
} catch (e) {
  console.error('文件监听不可用: ' + e.message);
}

// ---------- HTTP ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let data = '';
    req.on('data', function (c) { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', function () {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  if (p.startsWith('/api/')) {
    handleApi(req, res, p, u).catch(function (e) {
      json(res, 500, { error: String(e && e.message || e) });
    });
    return;
  }
  let file = p === '/' ? '/index.html' : p;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
});

async function handleApi(req, res, p, u) {
  if (p === '/api/data' && req.method === 'GET') {
    return json(res, 200, listData());
  }
  if (p === '/api/page' && req.method === 'GET') {
    const name = u.searchParams.get('name') || '';
    if (!safeName(name + '.md')) return json(res, 400, { error: 'bad name' });
    const full = pagePath(name + '.md');
    if (!fs.existsSync(full)) return json(res, 404, { error: '页面不存在: ' + name });
    const page = parsePage(fs.readFileSync(full, 'utf8'));
    return json(res, 200, { name: name, lines: page.lines, blocks: page.blocks });
  }
  if (p === '/api/create-page' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!safeName(name + '.md')) return json(res, 400, { error: '页面名不合法' });
    const full = pagePath(name + '.md');
    if (!fs.existsSync(full)) fs.writeFileSync(full, '');
    return json(res, 200, { ok: true, created: true });
  }
  function prepareGen(body) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.target || '')) return { error: '目标月份格式应为 YYYY-MM' };
    const tplPath = pagePath(TEMPLATE_PAGE + '.md');
    if (!fs.existsSync(tplPath)) return { error: '模板不存在：pages/' + TEMPLATE_PAGE + '.md' };
    const tpl = fs.readFileSync(tplPath, 'utf8');
    let res2 = { carried: [], droppedDone: [] };
    if (body.source) {
      if (!safeName(body.source + '.md')) return { error: 'bad source' };
      const src = pagePath(body.source + '.md');
      if (!fs.existsSync(src)) return { error: '来源月份不存在' };
      res2 = collectCarried(fs.readFileSync(src, 'utf8'), body.cleanOpen !== false);
    }
    const outLines = buildFromTemplate(tpl, res2.carried);
    return { tpl: tpl, carried: res2.carried, droppedDone: res2.droppedDone, outLines: outLines };
  }
  if (p === '/api/preview' && req.method === 'POST') {
    const body = await readBody(req);
    const g = prepareGen(body);
    if (g.error) return json(res, 400, { error: g.error });
    return json(res, 200, {
      carried: g.carried,
      droppedDone: g.droppedDone,
      targetExists: fs.existsSync(pagePath('plan-' + body.target + '.md')),
      lineCount: g.outLines.length
    });
  }
  if (p === '/api/generate' && req.method === 'POST') {
    const body = await readBody(req);
    const dst = pagePath('plan-' + body.target + '.md');
    if (fs.existsSync(dst) && !body.overwrite) return json(res, 409, { error: 'EXISTS' });
    const g = prepareGen(body);
    if (g.error) return json(res, 400, { error: g.error });
    if (fs.existsSync(dst)) {
      fs.mkdirSync(BAK, { recursive: true });
      fs.copyFileSync(dst, path.join(BAK, timestampForBak() + '.' + body.target + '.md'));
    }
    fs.writeFileSync(dst, g.outLines.join('\n'));
    return json(res, 200, {
      ok: true, target: body.target,
      carried: g.carried.length, droppedDone: g.droppedDone.length, lineCount: g.outLines.length
    });
  }
  if (p === '/api/status' && req.method === 'POST') {
    const body = await readBody(req);
    if (!safeName(body.name + '.md')) return json(res, 400, { error: 'bad name' });
    if (body.status && STATUSES.indexOf(body.status) < 0) return json(res, 400, { error: 'bad status' });
    const full = pagePath(body.name + '.md');
    if (!fs.existsSync(full)) return json(res, 404, { error: '页面不存在' });
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const i = body.line | 0;
    if (!(i >= 0 && i < lines.length)) return json(res, 400, { error: 'bad line' });
    const line = lines[i];
    const tm = TASK_RE.exec(line);
    let newLine;
    if (tm) {
      if (!body.status) newLine = tm[1] + '- ' + (tm[3] ? tm[3] + ' ' : '') + tm[5];
      else newLine = tm[1] + '- ' + body.status + (tm[3] ? ' ' + tm[3] : '') + ' ' + tm[5];
    } else {
      const bl = BULLET_RE.exec(line);
      if (!bl || !body.status) return json(res, 400, { error: '该行不是可修改状态的任务' });
      newLine = bl[1] + '- ' + body.status + '  ' + (bl[2] || '');
    }
    lines[i] = newLine;
    fs.writeFileSync(full, lines.join('\n'));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', function () { sseClients.delete(res); });
    return;
  }
  if (p === '/api/edit' && req.method === 'POST') {
    const body = await readBody(req);
    if (!safeName(body.name + '.md')) return json(res, 400, { error: 'bad name' });
    const text = sanitizeText(body.text);
    if (!text) return json(res, 400, { error: '内容不能为空' });
    const full = pagePath(body.name + '.md');
    if (!fs.existsSync(full)) return json(res, 404, { error: '页面不存在' });
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const blocks = fillPseudoBlocks(lines, splitBlocks(lines));
    const b = findBlockAt(blocks, body.line | 0);
    if (!b) return json(res, 409, { error: 'STALE', message: '文件已变化，请刷新后重试' });
    const nl = rebuildFirstLine(lines[b.start], text);
    if (!nl) return json(res, 400, { error: '该行不支持编辑' });
    lines[b.start] = nl;
    fs.writeFileSync(full, lines.join('\n'));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/add' && req.method === 'POST') {
    const body = await readBody(req);
    if (!safeName(body.name + '.md')) return json(res, 400, { error: 'bad name' });
    if (body.status && STATUSES.indexOf(body.status) < 0) return json(res, 400, { error: 'bad status' });
    if (body.priority && !/^[A-C]$/.test(body.priority)) return json(res, 400, { error: 'bad priority' });
    const text = sanitizeText(body.text);
    if (!text) return json(res, 400, { error: '内容不能为空' });
    const full = pagePath(body.name + '.md');
    if (!fs.existsSync(full)) return json(res, 404, { error: '页面不存在' });
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    let at = body.afterLine | 0;
    if (isNaN(at) || at < -1) at = -1;
    if (at > lines.length - 1) at = lines.length - 1;
    const nb = '- ' + (body.status ? body.status + (body.priority ? ' [#' + body.priority + ']' : '') + '  ' : '') + text;
    lines.splice(at + 1, 0, nb);
    fs.writeFileSync(full, lines.join('\n'));
    return json(res, 200, { ok: true, line: at + 1 });
  }
  if (p === '/api/delete' && req.method === 'POST') {
    const body = await readBody(req);
    if (!safeName(body.name + '.md')) return json(res, 400, { error: 'bad name' });
    const full = pagePath(body.name + '.md');
    if (!fs.existsSync(full)) return json(res, 404, { error: '页面不存在' });
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const blocks = fillPseudoBlocks(lines, splitBlocks(lines));
    const b = findBlockAt(blocks, body.line | 0);
    if (!b) return json(res, 409, { error: 'STALE', message: '文件已变化，请刷新后重试' });
    lines.splice(b.start, b.end - b.start + 1);
    fs.writeFileSync(full, lines.join('\n'));
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'no such api' });
}

server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    const next = PORT + 1;
    console.error('端口 ' + PORT + ' 被占用，改用 ' + next);
    server.listen(next, '127.0.0.1');
    return;
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', function () {
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('Logseq 计划助手已启动: ' + url);
  console.log('库目录: ' + GRAPH);
  if (!NO_OPEN && process.platform === 'darwin') {
    execFile('open', [url], function () {});
  }
});
