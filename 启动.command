#!/bin/bash
# 打开 Logseq 计划助手（服务已由 launchd 常驻，本脚本只负责打开浏览器；
# 若服务意外没跑，会先尝试拉起）
URL="http://127.0.0.1:5217"
if ! curl -s -m 2 "$URL/api/data" > /dev/null 2>&1; then
  # 尝试用 launchd 拉起常驻服务
  launchctl kickstart -k "gui/$(id -u)/com.azl.logseq-planner" 2>/dev/null
  sleep 1
  if ! curl -s -m 2 "$URL/api/data" > /dev/null 2>&1; then
    # 兜底：前台运行
    cd "$(dirname "$0")"
    echo "launchd 服务不可用，直接前台启动（关掉窗口服务会停）..."
    node server.js
    exit 0
  fi
fi
open "$URL"
