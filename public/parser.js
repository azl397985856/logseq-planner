'use strict';
/* markdown 解析与月计划生成（浏览器版，逻辑与 server.js 保持一致） */
(function () {
  const TASK_RE = /^(\s*)-\s+(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED)\s*(\[#([A-C])\])?\s*(.*?)\s*$/;
  const BULLET_RE = /^(\s*)-(?:\s(.*))?$/;
  const NUM_RE = /^(\s*)(\d+[.)]\s+)(.*)$/;
  const HEADING_RE = /^\s*(?:-\s+)?(#{1,6})\s+(.*?)\s*$/;
  const CLOCK_RE = /CLOCK:\s*\[([^\]]+)\](?:--\[([^\]]+)\]\s*=>\s*(\d+):(\d{2}):(\d{2}))?/;
  const OPEN_CLOCK_RE = /^\s*CLOCK:\s*\[[^\]]+\]\s*$/;

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
      const hm = HEADING_RE.exec(lines[b.start]);
      if (hm && hm[1].length <= 2) cur = { title: hm[2].trim(), level: hm[1].length };
      blocks.push(blockInfo(lines, b, cur));
    }
    return { lines: lines, blocks: blocks };
  }

  function normalizeTitle(t) {
    return String(t).replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function blockContaining(blocks, idx) {
    for (const b of blocks) { if (idx >= b.start && idx <= b.end) return b; }
    return null;
  }

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

  /* 整块编辑：首行 + 子行重写，LOGBOOK 等元数据保留在首行后 */
  function applyEdit(text, lines, b) {
    const parts = String(text == null ? '' : text).replace(/\r/g, '').split('\n')
      .map(function (l) { return l.replace(/\s+$/, '').slice(0, 5000); });
    while (parts.length && !parts[parts.length - 1].trim()) parts.pop();
    const firstText = (parts.shift() || '').trim();
    if (!firstText && !parts.length) return { error: '内容不能为空' };
    const nl = rebuildFirstLine(lines[b.start], firstText || ' ');
    if (!nl) return { error: '该行不支持编辑' };
    if (!parts.length) { lines[b.start] = nl; return { ok: true }; }
    const meta = [];
    for (let k = b.start + 1; k <= b.end; k++) {
      if (/^\s*(:LOGBOOK:|:END:|CLOCK:|\* State |SCHEDULED:|DEADLINE:)/.test(lines[k])) meta.push(lines[k]);
    }
    const newBlock = [nl].concat(meta);
    parts.forEach(function (l) { newBlock.push(l.trim() ? '  ' + l.replace(/^\s+/, '') : ''); });
    lines.splice(b.start, b.end - b.start + 1, ...newBlock);
    return { ok: true };
  }

  function applyAdd(lines, afterLine, status, priority, text) {
    let at = afterLine | 0;
    if (isNaN(at) || at < -1) at = -1;
    if (at > lines.length - 1) at = lines.length - 1;
    const clean = String(text).replace(/\s*\n\s*/g, '  ').trim().slice(0, 5000);
    if (!clean) return { error: '内容不能为空' };
    const nb = '- ' + (status ? status + (priority ? ' [#' + priority + ']' : '') + '  ' : '') + clean;
    lines.splice(at + 1, 0, nb);
    return { ok: true, line: at + 1 };
  }

  function applyDelete(lines, idx) {
    const blocks = fillPseudoBlocks(lines, splitBlocks(lines));
    const b = blockContaining(blocks, idx);
    if (!b) return { error: 'STALE' };
    if (idx === b.start) lines.splice(b.start, b.end - b.start + 1);
    else lines.splice(idx, 1);
    return { ok: true };
  }

  function applyStatus(lines, idx, status) {
    const line = lines[idx];
    const tm = TASK_RE.exec(line);
    let newLine;
    if (tm) {
      if (!status) newLine = tm[1] + '- ' + (tm[3] ? tm[3] + ' ' : '') + tm[5];
      else newLine = tm[1] + '- ' + status + (tm[3] ? ' ' + tm[3] : '') + ' ' + tm[5];
    } else {
      const bl = BULLET_RE.exec(line);
      if (!bl || !status) return { error: '该行不是可修改状态的任务' };
      newLine = bl[1] + '- ' + status + '  ' + (bl[2] || '');
    }
    lines[idx] = newLine;
    return { ok: true };
  }

  /* 从源月份收集未完成任务块（含子行；cleanOpen 清理未关闭 CLOCK） */
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

  /* 模板 + 携带 → 新月计划（模板里与携带重复的条目跳过模板份，保留携带的历史） */
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

    const carriedTexts = new Set(carried.map(function (c) { return normalizeTitle(c.text); }));
    const tplSkip = new Set();
    for (const b of blocks) {
      const info = blockInfo(lines, b, { title: '', level: 0 });
      if (info.kind === 'task' && info.text && carriedTexts.has(normalizeTitle(info.text))) {
        for (let k = b.start; k <= b.end; k++) tplSkip.add(k);
      }
    }

    const out = [];
    const used = new Set();
    for (const sp of spans) {
      for (let k = sp.start; k <= sp.end; k++) {
        if (!tplSkip.has(k)) out.push(lines[k]);
      }
      carried.forEach(function (c, i) {
        if (used.has(i)) return;
        if (normalizeTitle(c.section) !== normalizeTitle(sp.title)) return;
        out.push.apply(out, c.lines);
        used.add(i);
      });
    }
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

  window.LspParser = {
    parsePage: parsePage,
    splitBlocks: splitBlocks,
    fillPseudoBlocks: fillPseudoBlocks,
    blockInfo: blockInfo,
    blockContaining: blockContaining,
    normalizeTitle: normalizeTitle,
    applyEdit: applyEdit,
    applyAdd: applyAdd,
    applyDelete: applyDelete,
    applyStatus: applyStatus,
    collectCarried: collectCarried,
    buildFromTemplate: buildFromTemplate
  };
})();
