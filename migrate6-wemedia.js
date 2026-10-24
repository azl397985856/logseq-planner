#!/usr/bin/env node
/*
 * 一次性迁移 6：把清洗后的 wemedia.md 内容同步到
 * 5 个月份文件 + 月计划模板 的「自媒体」折叠分区里
 * （替换 migrate3 插入的旧内容，旧内容含空行和断行错误的列表）
 * 用法: node migrate6-wemedia.js /path/to/graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GRAPH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'logseq'));
const PAGES = path.join(GRAPH, 'pages');
const MONTHS = ['plan-2026-10', 'plan-2026-11', 'plan-2026-12', 'plan-2027-01', 'plan-2027-02', '月计划模板'];

const body = fs.readFileSync(path.join(PAGES, 'wemedia.md'), 'utf8').replace(/\n+$/, '');
const indent = s => s.split('\n').map(l => (l.trim() ? '  ' + l : '')).join('\n');

for (const month of MONTHS) {
  const file = path.join(PAGES, month + '.md');
  if (!fs.existsSync(file)) { console.log('跳过: ' + month); continue; }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex(l => /^- ##\s*自媒体\s*$/.test(l.trim()));
  if (start < 0) { console.log(month + ': 未找到自媒体分区'); continue; }
  // 找分区结束：下一个顶层行（不缩进）
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;
  const out = lines.slice(0, start + 1).concat([indent(body)], lines.slice(end));
  fs.writeFileSync(file, out.join('\n'));
  console.log(month + ': 自媒体内容已更新 (' + (end - start - 1) + ' 行 → ' + body.split('\n').length + ' 行)');
}
console.log('迁移 6 完成');
