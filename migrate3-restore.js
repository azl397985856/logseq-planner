#!/usr/bin/env node
/*
 * 一次性迁移 3（恢复）：自媒体/工作/Bonus 内容放回月计划里
 *  - 5 个月份文件 + 月计划模板：`## 自媒体 [[wemedia]]` → `## 自媒体` 等
 *  - 自媒体分区下折叠加回 wemedia.md 内容
 *  - 工作分区下折叠加回 工作.md 内容（TODO 等状态前缀去掉，变成普通笔记折叠）
 *  - Bonus 分区下折叠加回 Bonus.md 内容
 * 用法: node migrate3-restore.js /path/to/graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GRAPH = path.resolve(process.argv[2] || path.join(__dirname, '..', 'logseq'));
const PAGES = path.join(GRAPH, 'pages');
const MONTHS = ['plan-2026-10', 'plan-2026-11', 'plan-2026-12', 'plan-2027-01', 'plan-2027-02'];
const TASK_STRIP_RE = /^(\s*)-\s+(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED)\s*(\[#([A-C])\])?\s*/;

function readTrim(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\n+$/, '') : '';
}

/* 工作.md 里的任务行转普通笔记行（去状态/优先级，保留 LOGBOOK） */
function toPlainNotes(text) {
  return text.split('\n').map(function (l) {
    const m = TASK_STRIP_RE.exec(l);
    return m ? m[1] + '- ' + l.slice(m[0].length) : l;
  }).join('\n');
}

const wemediaBody = readTrim(path.join(PAGES, 'wemedia.md'));
const workBody = toPlainNotes(readTrim(path.join(PAGES, '工作.md')))
  .replace(/^- 从月度计划移出的工作待办（暂时不做）\n?/, '');
const bonusBody = readTrim(path.join(PAGES, 'Bonus.md'))
  .replace(/^- 从月度计划移出的 Bonus 清单\n?/, '');

function sectionBlock(header, body) {
  // 返回要插入到分区标题后的行数组（内容作为普通 bullet 折叠显示）
  if (!body || !body.trim()) return [];
  return ['', body.split('\n')];
}

/* 分区内容折叠显示：写成 `- ## 标题` + 缩进子行（与健康分区相同的结构） */
function indentBody(body) {
  return body.split('\n').map(l => (l.trim() ? '  ' + l : '')).join('\n');
}

for (const month of MONTHS.concat(['月计划模板'])) {
  const file = path.join(PAGES, month + '.md');
  if (!fs.existsSync(file)) { console.log('跳过(不存在): ' + month); continue; }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let inserted = { wemedia: false, work: false, bonus: false };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (/^##\s*自媒体(\s*\[\[wemedia\]\])?\s*$/.test(t) && !inserted.wemedia && wemediaBody.trim()) {
      out.push('- ## 自媒体', indentBody(wemediaBody));
      inserted.wemedia = true;
      continue;
    }
    if (/^##\s*工作(\s*\[\[工作\]\])?\s*$/.test(t) && !inserted.work && workBody.trim()) {
      out.push('- ## 工作', indentBody(workBody));
      inserted.work = true;
      continue;
    }
    if (/^##\s*Bonus(\s*\[\[Bonus\]\])?\s*$/.test(t) && !inserted.bonus && bonusBody.trim()) {
      out.push('- ## Bonus', indentBody(bonusBody));
      inserted.bonus = true;
      continue;
    }
    out.push(l);
  }
  fs.writeFileSync(file, out.join('\n'));
  console.log(month + ': 自媒体=' + inserted.wemedia + ' 工作=' + inserted.work + ' Bonus=' + inserted.bonus);
}
console.log('迁移 3 完成（自媒体/工作/Bonus 已放回，折叠笔记形式）');
