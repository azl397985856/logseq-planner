#!/usr/bin/env node
/*
 * 一次性迁移 7：
 *  - 月度计划里的「工作」「自媒体」分区恢复为链接形式（内容分别在 工作.md / wemedia.md）
 *    `- ## 工作` + 折叠内容 → `## 工作 [[工作]]`；`- ## 自媒体` + 内容 → `## 自媒体 [[wemedia]]`
 *  - 模板里对应标题补上 [[链接]]
 * 用法: node migrate7-links.js /path/to/graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GRAPH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'logseq'));
const PAGES = path.join(GRAPH, 'pages');
/* 只处理被我复制过内容的文件，不动任何历史月份 */
const FILES = ['plan-2026-10', '月计划模板'];

for (const month of FILES) {
  const file = path.join(PAGES, month + '.md');
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let skipping = false, changed = { work: false, wemedia: false };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (/^- ##\s*工作(\s*\[\[工作\]\])?\s*$/.test(t)) {
      out.push('## 工作 [[工作]]');
      skipping = true; changed.work = true;
      continue;
    }
    if (/^##\s*工作\s*$/.test(t)) { // 模板里的空标题，直接补链接
      out.push('## 工作 [[工作]]');
      changed.work = true;
      continue;
    }
    if (/^- ##\s*自媒体(\s*\[\[wemedia\]\])?\s*$/.test(t)) {
      out.push('## 自媒体 [[wemedia]]');
      skipping = true; changed.wemedia = true;
      continue;
    }
    if (/^##\s*自媒体\s*$/.test(t)) {
      out.push('## 自媒体 [[wemedia]]');
      changed.wemedia = true;
      continue;
    }
    if (skipping) {
      if (t === '' || /^\s/.test(l)) continue;
      skipping = false;
    }
    out.push(l);
  }
  const compact = [];
  for (const l of out) {
    if (!l.trim() && compact.length && !compact[compact.length - 1].trim()) continue;
    compact.push(l);
  }
  fs.writeFileSync(file, compact.join('\n'));
  console.log(month + ': 工作=' + changed.work + ' 自媒体=' + changed.wemedia);
}
console.log('迁移 7 完成');
