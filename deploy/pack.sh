#!/usr/bin/env bash
# 生成 Linux 部署包：先构建后台静态页，再发布 linux-x64 框架依赖包，最后打 tar.gz
# 用法：bash deploy/pack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/deploy/dist"
STAGE="$DIST/sp-server"
STAMP="$(date +%Y%m%d-%H%M)"

if command -v npm >/dev/null 2>&1; then
  echo "== 构建后台静态页 =="
  (cd "$ROOT/admin" && npm run build:server)
elif [ ! -f "$ROOT/server/wwwroot/admin/index.html" ]; then
  echo "缺少 npm 且 server/wwwroot/admin/index.html 不存在，无法打包" >&2
  exit 1
else
  echo "未找到 npm，沿用已有的 server/wwwroot/admin" >&2
fi

echo "== 发布 linux-x64 =="
rm -rf "$STAGE"
dotnet publish "$ROOT/server/SpServer.csproj" -c Release -r linux-x64 --self-contained false -o "$STAGE"

echo "== 附加部署文件 =="
mkdir -p "$STAGE/deploy"
cp "$ROOT/deploy/sp.service" "$ROOT/deploy/nginx-sp.conf" "$ROOT/deploy/nginx-admin.conf" "$ROOT/deploy/sp.env.example" "$STAGE/deploy/"
cp "$ROOT/deploy/DEPLOY.md" "$STAGE/DEPLOY.md"
chmod +x "$STAGE/SpServer"

TARBALL="$DIST/sp-server-linux-x64-$STAMP.tar.gz"
tar -czf "$TARBALL" -C "$DIST" sp-server

echo
echo "完成：$TARBALL"
echo "大小：$(du -h "$TARBALL" | cut -f1)"
