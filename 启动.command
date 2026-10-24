#!/bin/bash
# 双击启动 Logseq 计划助手
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js: https://nodejs.org"
  read -p "按回车关闭…"
  exit 1
fi
node server.js
