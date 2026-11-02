#!/bin/bash
# 构建 GitHub Pages 静态站点到 docs/（public/ + STATIC_MODE 标志）
set -e
cd "$(dirname "$0")"
rm -rf docs
mkdir docs
cp public/style.css public/app.js public/parser.js public/static.js docs/
python3 - <<'EOF'
html = open('public/index.html').read()
html = html.replace('<script src="./app.js"></script>',
  '<script>window.STATIC_MODE = true;</script>\n<script src="./app.js"></script>')
html = html.replace('<button id="btnChangeData" class="btn small ghost" hidden>更改数据目录</button>',
  '<button id="btnChangeData" class="btn small ghost" hidden>更改数据目录</button>')
# 静态模式下改一下页脚说明
html = html.replace('数据源是 pages/ 下的 markdown，改动直接写回，Logseq 实时同步',
  '数据只在你自己的浏览器里处理，不会上传到任何服务器')
open('docs/index.html','w').write(html)
print('docs/index.html built')
EOF
echo "构建完成:" && ls docs/