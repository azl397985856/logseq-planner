#!/usr/bin/env node
/*
 * 一次性清理：删除 plan-*.md 里的两类噪音块
 *  1. 纯日志空块：文字被删掉、只剩 :LOGBOOK:/CLOCK 计时残留的块
 *  2. 空占位块：内容只有 `-` 的块
 * 仅处理 pages/plan-*.md，其他页面不动。
 * 用法: node migrate4-clean-noise.js /path/to/graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GRAPH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'logseq'));
const PAGES = path.join(GRAPH, 'pages');

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

const TASK_RE = /^\s*-\s+(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED)\b/;
const META_RE = /^\s*(?::LOGBOOK:|:END:|CLOCK:|\* State |SCHEDULED:|DEADLINE:)/;

const files = fs.readdirSync(PAGES).filter(f => /^plan-\d{4}-\d{2}\.md$/.test(f));
let totalMeta = 0, totalEmpty = 0;

for (const f of files) {
  const file = path.join(PAGES, f);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const blocks = splitBlocks(lines);
  const drop = new Set();
  for (const b of blocks) {
    const first = lines[b.start];
    if (TASK_RE.test(first)) continue;
    const firstText = first.replace(/^\s*-\s?/, '').trim();
    let hasReal = firstText && firstText !== ':LOGBOOK:';
    let hasMeta = firstText === ':LOGBOOK:';
    for (let k = b.start + 1; k <= b.end; k++) {
      const l = lines[k];
      if (!l.trim()) continue;
      if (META_RE.test(l)) { hasMeta = true; continue; }
      hasReal = true;
    }
    if (hasReal) continue;
    if (hasMeta) { // 纯日志壳
      for (let k = b.start; k <= b.end; k++) drop.add(k);
      totalMeta++;
    } else if (!firstText && b.start === b.end) { // 裸空 `-`
      drop.add(b.start);
      totalEmpty++;
    }
  }
  if (drop.size) {
    const out = lines.filter((_, i) => !drop.has(i));
    const compact = [];
    for (const l of out) {
      if (!l.trim() && compact.length && !compact[compact.length - 1].trim()) continue;
      compact.push(l);
    }
    fs.writeFileSync(file, compact.join('\n'));
  }
  console.log(f + ': 日志壳 ' + (drop.size ? '已清理' : '无'));
}
console.log('共删除纯日志块 ' + totalMeta + ' 个、空占位块 ' + totalEmpty + ' 个');
