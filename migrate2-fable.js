#!/usr/bin/env node
/*
 * 一次性迁移 2：把工作分区残留的 Fable 範本笔记（Establish a method、範本 1-8、
 * "3 步驟 checklist" 分区）从 plan-2026-10 ~ plan-2027-02 移到 pages/工作.md 末尾。
 * 用法: node migrate2-fable.js /path/to/graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GRAPH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'logseq'));
const PAGES = path.join(GRAPH, 'pages');
const MONTHS = ['plan-2026-10', 'plan-2026-11', 'plan-2026-12', 'plan-2027-01', 'plan-2027-02'];

function indentWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\t') w += 4; else if (ch === ' ') w++; else break;
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
    } else i++;
  }
  return blocks;
}
function fillPseudo(lines, blocks) {
  const covered = new Array(lines.length).fill(false);
  blocks.forEach(b => { for (let k = b.start; k <= b.end; k++) covered[k] = true; });
  for (let i = 0; i < lines.length; i++) if (!covered[i] && lines[i].trim()) blocks.push({ start: i, end: i });
  return blocks.sort((a, b) => a.start - b.start);
}
const HEADING_RE = /^\s*(?:-\s+)?(#{1,6})\s+(.*?)\s*$/;

let fableExport = null;

for (const month of MONTHS) {
  const file = path.join(PAGES, month + '.md');
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const blocks = fillPseudo(lines, splitBlocks(lines));
  const drop = new Set();
  let removed = [];
  let mode = null; // null | '工作' | '3步驟'

  for (const b of blocks) {
    const first = lines[b.start];
    const hm = HEADING_RE.exec(first);
    if (hm && hm[1].length <= 2) {
      const title = hm[2].trim();
      if (title === '工作' || title === '工作 [[工作]]') { mode = '工作'; continue; }
      if (/^3\s*步驟/.test(title)) { mode = '3步驟'; drop.add(b); removed.push(b); continue; }
      mode = null;
      continue;
    }
    if (mode) { drop.add(b); removed.push(b); }
  }

  if (removed.length && !fableExport) {
    fableExport = removed.map(b => lines.slice(b.start, b.end + 1).join('\n')).filter(s => s.trim() && s.trim() !== '-').join('\n');
  }
  const out = lines.filter((_, i) => {
    for (const b of drop) if (i >= b.start && i <= b.end) return false;
    return true;
  });
  // 压掉连续空行
  const compact = [];
  for (const l of out) {
    if (!l.trim() && compact.length && !compact[compact.length - 1].trim()) continue;
    compact.push(l);
  }
  fs.writeFileSync(file, compact.join('\n'));
  console.log(month + ': 移出 ' + removed.length + ' 块');
}

if (fableExport) {
  const wf = path.join(PAGES, '工作.md');
  const prev = fs.existsSync(wf) ? fs.readFileSync(wf, 'utf8') : '';
  fs.writeFileSync(wf, prev.replace(/\n*$/, '\n\n') + fableExport + '\n');
  console.log('Fable 範本已追加到 pages/工作.md');
}
console.log('迁移 2 完成');
