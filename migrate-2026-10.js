#!/usr/bin/env node
/*
 * 一次性迁移：
 *  1. 把 plan-2026-10 ~ plan-2027-02 里的 6 条工作待办移到 pages/工作.md
 *  2. 把 Bonus 分区内容移到 pages/Bonus.md
 *  3. 原处标题改为 `## 工作 [[工作]]` / `## Bonus [[Bonus]]`
 *  4. 创建 pages/月计划模板.md（骨架，供「生成新月计划」使用）
 * 用法: node migrate-2026-10.js /path/to/graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GRAPH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'logseq'));
const PAGES = path.join(GRAPH, 'pages');

const TASK_RE = /^(\s*)-\s+(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED)\s*(\[#([A-C])\])?\s*(.*?)\s*$/;
const HEADING_RE = /^\s*(?:-\s+)?(#{1,6})\s+(.*?)\s*$/;

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

/* ---------- 1&2. 移出工作待办和 Bonus ---------- */
const WORK_PREFIXES = ['周会使用 context sync bot', '周会改为使用 backlog', '接上，将 perf skill', '盘点所有的需求', '注入上下文：', 'AI 写代码能力很强了'];
const MONTHS = ['plan-2026-10', 'plan-2026-11', 'plan-2026-12', 'plan-2027-01', 'plan-2027-02'];

let workExport = null, bonusExport = null;

for (const month of MONTHS) {
  const file = path.join(PAGES, month + '.md');
  if (!fs.existsSync(file)) { console.log('跳过(不存在): ' + month); continue; }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const blocks = fillPseudo(lines, splitBlocks(lines));
  const drop = new Set();
  let workBlocks = [], bonusBlocks = [];
  let inBonus = false;

  for (const b of blocks) {
    const first = lines[b.start];
    const hm = HEADING_RE.exec(first);
    if (hm && hm[1].length <= 2) {
      inBonus = hm[2].trim() === 'Bonus';
      if (inBonus) {
        // 重命名标题
        lines[b.start] = first.replace(/##\s+Bonus\s*$/, '## Bonus [[Bonus]]');
        continue;
      }
      if (hm[2].trim() === '工作') {
        lines[b.start] = first.replace(/##\s+工作\s*$/, '## 工作 [[工作]]');
      }
      continue;
    }
    const tm = TASK_RE.exec(first);
    const text = tm ? tm[5] : first.replace(/^(\s*)-\s?/, '').trim();
    if (tm && WORK_PREFIXES.some(p => text.startsWith(p))) {
      drop.add(b);
      workBlocks.push(b);
      continue;
    }
    if (inBonus) {
      // Bonus 分区里的实质内容（普通 bullet、TODO 都算），空块留下
      const isEmpty = /^-\s*$/.test(first.trim()) || (!tm && !text);
      if (!isEmpty) { drop.add(b); bonusBlocks.push(b); }
    }
  }

  const extract = bs => bs.map(b => lines.slice(b.start, b.end + 1).join('\n')).join('\n');
  if (!workExport && workBlocks.length) workExport = extract(workBlocks);
  if (!bonusExport && bonusBlocks.length) bonusExport = extract(bonusBlocks);

  const out = lines.filter((_, i) => {
    for (const b of drop) if (i >= b.start && i <= b.end) return false;
    return true;
  });
  fs.writeFileSync(file, out.join('\n'));
  console.log(month + ': 移出工作 ' + workBlocks.length + ' 条, Bonus ' + bonusBlocks.length + ' 块');
}

if (workExport) {
  fs.writeFileSync(path.join(PAGES, '工作.md'), '- 从月度计划移出的工作待办（暂时不做）\n' + workExport + '\n');
  console.log('已创建 pages/工作.md');
}
if (bonusExport) {
  fs.writeFileSync(path.join(PAGES, 'Bonus.md'), '- 从月度计划移出的 Bonus 清单\n' + bonusExport + '\n');
  console.log('已创建 pages/Bonus.md');
}

/* ---------- 3. 创建月计划模板 ---------- */
const src = path.join(PAGES, 'plan-2026-10.md');
const tplFile = path.join(PAGES, '月计划模板.md');
if (fs.existsSync(src) && !fs.existsSync(tplFile)) {
  const lines = fs.readFileSync(src, 'utf8').split('\n');
  const meditation = lines.findIndex(l => /^##\s*冥想\s*$/.test(l.trim()));
  if (meditation < 0) { console.error('找不到 `## 冥想` 分割线，模板生成失败'); process.exit(1); }
  // 头部：[[monthly plan]] + 健康 + 理财参考行（去掉空占位 `-` 行）
  const head = lines.slice(0, meditation).filter(l => l.trim() !== '-');
  const tail = [
    '## 冥想',
    '## 自媒体 [[wemedia]]',
    '## 工作 [[工作]]',
    '## 学习',
    '## 在线课程 or 私人教练课程',
    '## book',
    '### open source',
    '## 电影',
    '## 娱乐',
    '### Mos',
    '## Bonus [[Bonus]]'
  ];
  fs.writeFileSync(tplFile, head.join('\n') + '\n' + tail.join('\n') + '\n');
  console.log('已创建 pages/月计划模板.md');
} else {
  console.log('模板已存在或找不到 plan-2026-10，跳过模板创建');
}
console.log('迁移完成');
