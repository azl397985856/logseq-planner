'use strict';
/* 静态模式数据层：数据只在浏览器本地处理，不上传任何服务器 */
window.StaticData = (function () {
  let dirHandle = null;
  let pagesDirHandle = null;
  let writable = false;
  let source = 'none'; // none | dir | upload
  let files = new Map();   // name(无.md) -> {handle|null, file|null, text}
  let assets = new Map();  // 文件名 -> handle
  let dataCache = null;
  const urlCache = new Map();

  /* ---------- IndexedDB：记住目录句柄 ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      const r = indexedDB.open('logseq-planner', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  async function idbPut(key, val) {
    const db = await idb();
    return new Promise(function (res, rej) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
      tx.onerror = function () { rej(tx.error); };
    });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise(function (res) {
      const tx = db.transaction('kv', 'readonly');
      const rq = tx.objectStore('kv').get(key);
      rq.onsuccess = function () { res(rq.result || null); };
      rq.onerror = function () { res(null); };
    });
  }
  async function idbDel(key) {
    const db = await idb();
    return new Promise(function (res) {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = res;
      tx.onerror = res;
    });
  }

  /* ---------- 数据装载 ---------- */
  async function loadFromDir() {
    files.clear(); assets.clear();
    pagesDirHandle = await dirHandle.getDirectoryHandle('pages');
    for await (const entry of pagesDirHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        const f = await entry.getFile();
        files.set(entry.name.slice(0, -3), { handle: entry, file: null, text: await f.text() });
      }
    }
    try {
      const ad = await dirHandle.getDirectoryHandle('assets');
      for await (const entry of ad.values()) {
        if (entry.kind === 'file') assets.set(entry.name, entry);
      }
    } catch (e) { /* 没有 assets 目录也没关系 */ }
    writable = true;
    source = 'dir';
    buildData();
  }

  async function pickDirectory() {
    dirHandle = await window.showDirectoryPicker({ id: 'logseq-graph', mode: 'readwrite' });
    await idbPut('dir', dirHandle);
    await loadFromDir();
  }

  /* 启动时尝试恢复上次的数据目录；返回 'loaded' | 'need-permission' | 'none' */
  async function tryRestore() {
    if (!('showDirectoryPicker' in window)) return 'none';
    dirHandle = await idbGet('dir');
    if (!dirHandle) return 'none';
    let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return 'need-permission';
    await loadFromDir();
    return 'loaded';
  }
  /* 用户点击按钮时调用（需要手势才能授权） */
  async function reconnect() {
    if (!dirHandle) dirHandle = await idbGet('dir');
    if (!dirHandle) return false;
    const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    await loadFromDir();
    return true;
  }
  async function disconnect() {
    await idbDel('dir');
    dirHandle = null; pagesDirHandle = null;
    files.clear(); assets.clear(); dataCache = null;
    writable = false; source = 'none';
  }

  /* 上传文件（只读模式） */
  function importFiles(fileList) {
    files.clear(); assets.clear();
    for (const f of fileList) {
      const rel = f.webkitRelativePath || f.name;
      if (f.name.endsWith('.md')) {
        if (rel.includes('/') && !/(^|\/)pages\//.test(rel)) continue;
        const name = f.name.slice(0, -3);
        files.set(name, { handle: null, file: f, text: null });
      } else if (/\/assets\/|(^assets\/)/.test(rel)) {
        assets.set(f.name, { getFile: function () { return Promise.resolve(f); } });
      }
    }
    writable = false;
    source = 'upload';
    buildData();
  }

  function buildData() {
    const months = [], pages = [];
    for (const name of files.keys()) {
      const m = /^plan-(\d{4})-(\d{2})$/.exec(name);
      if (m) months.push({ name: name, year: +m[1], month: +m[2] });
      else pages.push(name);
    }
    months.sort(function (a, b) { return (a.year - b.year) || (a.month - b.month); });
    pages.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
    const now = new Date();
    dataCache = {
      graphName: source === 'dir' ? dirHandle.name : '上传的数据',
      months: months, pages: pages,
      today: { year: now.getFullYear(), month: now.getMonth() + 1, date: now.getDate() }
    };
  }

  function shape() { return dataCache || { graphName: '', months: [], pages: [], today: { year: 0, month: 0, date: 0 } }; }

  async function recText(rec) {
    if (rec.text == null) rec.text = await rec.file.text();
    return rec.text;
  }
  async function writeBack(name, lines) {
    const rec = files.get(name);
    if (!rec) return;
    rec.text = lines.join('\n');
    if (writable && rec.handle) {
      const w = await rec.handle.createWritable();
      await w.write(rec.text);
      await w.close();
    }
  }

  /* ---------- 对外接口（返回 {ok, body} 与服务端接口同形） ---------- */
  async function data() {
    if (source === 'none') return { ok: true, body: { noData: true, months: [], pages: [], graphName: '', today: { year: 0, month: 0, date: 0 } } };
    return { ok: true, body: shape() };
  }

  async function page(name) {
    const rec = files.get(name);
    if (!rec) return { ok: false, body: { error: '页面不存在' } };
    const p = LspParser.parsePage(await recText(rec));
    return { ok: true, body: { name: name, lines: p.lines, blocks: p.blocks } };
  }

  async function status(p) {
    const rec = files.get(p.name);
    if (!rec) return { ok: false, body: { error: '页面不存在' } };
    const lines = (await recText(rec)).split('\n');
    const r = LspParser.applyStatus(lines, p.line | 0, p.status);
    if (!r.ok) return { ok: false, body: r };
    await writeBack(p.name, lines);
    return { ok: true, body: { ok: true } };
  }

  async function edit(p) {
    const rec = files.get(p.name);
    if (!rec) return { ok: false, body: { error: '页面不存在' } };
    const lines = (await recText(rec)).split('\n');
    const blocks = LspParser.fillPseudoBlocks(lines, LspParser.splitBlocks(lines));
    const b = LspParser.blockContaining(blocks, p.line | 0);
    if (!b || (p.line | 0) !== b.start) return { ok: false, body: { error: 'STALE', message: '文件已变化，请刷新后重试' } };
    const r = LspParser.applyEdit(p.text, lines, b);
    if (!r.ok) return { ok: false, body: r };
    await writeBack(p.name, lines);
    return { ok: true, body: { ok: true } };
  }

  async function add(p) {
    const rec = files.get(p.name);
    if (!rec) return { ok: false, body: { error: '页面不存在' } };
    const lines = (await recText(rec)).split('\n');
    const r = LspParser.applyAdd(lines, p.afterLine, p.status, p.priority, p.text);
    if (!r.ok) return { ok: false, body: r };
    await writeBack(p.name, lines);
    return { ok: true, body: { ok: true, line: r.line } };
  }

  async function del(p) {
    const rec = files.get(p.name);
    if (!rec) return { ok: false, body: { error: '页面不存在' } };
    const lines = (await recText(rec)).split('\n');
    const r = LspParser.applyDelete(lines, p.line | 0);
    if (!r.ok) return { ok: false, body: { error: r.error, message: '文件已变化，请刷新后重试' } };
    await writeBack(p.name, lines);
    return { ok: true, body: { ok: true } };
  }

  async function deletePage(p) {
    const name = String(p.name || '');
    if (!files.has(name)) return { ok: false, body: { error: '页面不存在' } };
    files.delete(name);
    if (writable && pagesDirHandle) {
      try { await pagesDirHandle.removeEntry(name + '.md'); } catch (e) { /* 已不存在 */ }
    }
    buildData();
    return { ok: true, body: { ok: true } };
  }

  async function createPage(p) {
    const name = String(p.name || '').trim();
    if (!name || name.length > 100 || /[/\\\0]/.test(name)) return { ok: false, body: { error: '页面名不合法' } };
    if (!files.has(name)) {
      files.set(name, { handle: null, file: null, text: '' });
      if (writable && pagesDirHandle) {
        try {
          const h = await pagesDirHandle.getFileHandle(name + '.md', { create: true });
          files.get(name).handle = h;
          files.get(name).text = '';
        } catch (e) { /* 只读模式下留在内存 */ }
      }
      buildData();
    }
    return { ok: true, body: { ok: true } };
  }

  function prepareGen(body) {
    const tplRec = files.get('月计划模板');
    if (!tplRec) return { error: '模板不存在：pages/月计划模板.md' };
    let res = { carried: [], droppedDone: [] };
    if (body.source) {
      const src = files.get(body.source);
      if (!src) return { error: '来源月份不存在' };
      res = LspParser.collectCarried(src.text == null ? '' : src.text, body.cleanOpen !== false);
    }
    const outLines = LspParser.buildFromTemplate(tplRec.text || '', res.carried);
    return { carried: res.carried, droppedDone: res.droppedDone, outLines: outLines };
  }

  async function preview(body) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.target || '')) return { ok: false, body: { error: '目标月份格式应为 YYYY-MM' } };
    const g = prepareGen(body);
    if (g.error) return { ok: false, body: { error: g.error } };
    return { ok: true, body: { carried: g.carried, droppedDone: g.droppedDone, targetExists: files.has('plan-' + body.target), lineCount: g.outLines.length } };
  }

  async function generate(body) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.target || '')) return { ok: false, body: { error: '目标月份格式应为 YYYY-MM' } };
    const dstName = 'plan-' + body.target;
    if (files.has(dstName) && !body.overwrite) return { ok: false, body: { error: 'EXISTS' } };
    const g = prepareGen(body);
    if (g.error) return { ok: false, body: { error: g.error } };
    const rec = { handle: null, file: null, text: g.outLines.join('\n') };
    files.set(dstName, rec);
    if (writable && pagesDirHandle) {
      try {
        rec.handle = await pagesDirHandle.getFileHandle(dstName + '.md', { create: true });
        const w = await rec.handle.createWritable();
        await w.write(rec.text);
        await w.close();
      } catch (e) { /* 内存中保留 */ }
    }
    buildData();
    return { ok: true, body: { ok: true, target: body.target, carried: g.carried.length, droppedDone: g.droppedDone, lineCount: g.outLines.length } };
  }

  async function books() {
    const names = [...files.keys()].filter(function (n) { return /^plan-\d{4}-\d{2}$/.test(n); }).sort();
    const books = [];
    for (const name of names) {
      const rec = files.get(name);
      const p = LspParser.parsePage(await recText(rec));
      for (const b of p.blocks) {
        if (b.kind !== 'task' || b.status !== 'DONE' || !b.text) continue;
        if (!/book|书/i.test(b.section || '')) continue;
        if (/^\d+\s*本/.test(b.text.trim())) continue;
        books.push({ text: b.text, month: name.slice(5, 12), seconds: b.seconds || 0, file: name });
      }
    }
    return { ok: true, body: { total: books.length, books: books } };
  }

  /* ---------- 图片 ---------- */
  async function imageURL(rel) {
    const fn = decodeURIComponent(rel).replace(/^assets\//, '');
    const entry = assets.get(fn);
    if (!entry) return null;
    if (urlCache.has(fn)) return urlCache.get(fn);
    const f = await entry.getFile();
    const u = URL.createObjectURL(f);
    urlCache.set(fn, u);
    return u;
  }
  function hydrateImages(root) {
    root.querySelectorAll('img[data-asset]').forEach(function (img) {
      imageURL(img.dataset.asset).then(function (u) { if (u) img.src = u; });
    });
  }

  return {
    pickDirectory: pickDirectory,
    tryRestore: tryRestore,
    reconnect: reconnect,
    disconnect: disconnect,
    importFiles: importFiles,
    data: data,
    page: page,
    status: status,
    edit: edit,
    add: add,
    del: del,
    deletePage: deletePage,
    createPage: createPage,
    preview: preview,
    generate: generate,
    books: books,
    hydrateImages: hydrateImages,
    hasData: function () { return files.size > 0; },
    isWritable: function () { return writable; },
    source: function () { return source; }
  };
})();
