#!/bin/bash
# 洗衣房管理系统：在 Linux 服务器上安装或升级（腾讯云 / 阿里云 + 宝塔面板都可以）。
#
# 用 root 在服务器终端里运行（宝塔「终端」、腾讯云控制台「登录」都行）：
#   cd /tmp && rm -rf xiyifang-main && curl -fsSL https://codeload.github.com/2770419748-lgtm/xiyifang/tar.gz/refs/heads/main | tar xz \
#     && sudo bash xiyifang-main/deploy/install.sh
#
# 它会：
#   - 找一个 22.13 以上的 Node.js（宝塔装的、系统里的都行；都没有就从国内镜像下载一个，只给本系统用）
#   - 把程序放到 /www/wwwroot/xiyifang/app，数据放到 /www/wwwroot/xiyifang/data
#   - 建系统服务 xiyifang：开机自动启动，崩了 3 秒后自动拉起来；只监听本机 127.0.0.1:3100，
#     外面通过宝塔反向代理 + HTTPS 访问，不用在防火墙放行端口
#   - 第一次安装时导入店里电脑的数据：把「系统设置 → 数据备份」下载的「洗衣房数据备份-*.db」
#     先上传到 /www/wwwroot/xiyifang/，会自动导入最新的一份（也可以用 --import 指定文件）
#   - 再运行就是升级：换程序，数据不动，换之前先备份一份数据库；新程序启动不了会自动退回上一版
#
# 选项：
#   --import 文件   用这个备份文件作为系统数据（已经有数据时，原来的数据会先挪到一边留底）
#   --port 端口     本机端口，默认 3100（第一次定了以后会记住）
#
# 不会动服务器上的其他网站和程序，不改 nginx、不改防火墙。
set -euo pipefail
umask 022

SRC=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)

if [ -d /www/wwwroot ]; then ROOT=/www/wwwroot/xiyifang; else ROOT=/opt/xiyifang; fi
APP_DIR=$ROOT/app
DATA_DIR=$ROOT/data
ENV_FILE=$ROOT/xiyifang.env
SAFE_DIR=$ROOT/before-upgrade
SERVICE=xiyifang
UNIT_FILE=/etc/systemd/system/$SERVICE.service
NODE_BIN=/usr/local/bin/xiyifang-node
MIN_NODE=22.13.0
DEFAULT_PORT=3100
MIRROR=https://registry.npmmirror.com

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() { printf '\n错误：%s\n' "$*" >&2; exit 1; }
stamp() { date '+%Y%m%d-%H%M%S'; }
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]; }

IMPORT=""
PORT=""
while [ $# -gt 0 ]; do
  case $1 in
    --import) IMPORT=${2:-}; shift 2 ;;
    --port) PORT=${2:-}; shift 2 ;;
    -h | --help) sed -n '2,24p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "不认识的选项：$1（--help 看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash $0"
command -v systemctl >/dev/null 2>&1 || die "这台服务器没有 systemd，本脚本不支持"
[ -f "$SRC/server/index.js" ] && grep -q '"name": "laundry-system"' "$SRC/package.json" 2>/dev/null ||
  die "$SRC 不是完整的洗衣房系统程序（要从下载解压出来的文件夹里运行本脚本）"
if [ -n "$PORT" ]; then
  [[ $PORT =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "端口要是 1024~65535 的数字"
fi

exec 9>/run/xiyifang-install.lock
flock -n 9 || die "另一个安装正在运行，等它结束再试"

VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -n 1)
say "洗衣房管理系统 v$VERSION → $ROOT"

# ---------- Node.js ----------

node_ok() { [ -x "$1" ] && ver_ge "$("$1" -p 'process.versions.node' 2>/dev/null || echo 0)" "$MIN_NODE"; }

find_node() {
  local n best="" bestv="" v
  if [ -e "$NODE_BIN" ] && node_ok "$(readlink -f "$NODE_BIN")"; then
    readlink -f "$NODE_BIN"
    return 0
  fi
  for n in /www/server/nodejs/*/bin/node "$(command -v node 2>/dev/null || true)" /usr/local/bin/*-node; do
    [ -n "$n" ] && [ -x "$n" ] || continue
    n=$(readlink -f "$n")
    node_ok "$n" || continue
    v=$("$n" -p 'process.versions.node')
    if [ -z "$best" ] || ! ver_ge "$bestv" "$v"; then
      best=$n
      bestv=$v
    fi
  done
  [ -n "$best" ] || return 1
  printf '%s\n' "$best"
}

# 下载过程的提示写到 stderr，stdout 只输出装好的 node 路径
download_node() {
  local arch base sums line file sum tmp
  case $(uname -m) in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "不支持的 CPU 架构：$(uname -m)" ;;
  esac
  tmp=$(mktemp -d)
  for base in "$MIRROR/-/binary/node" https://nodejs.org/dist; do
    sums=$(curl -fsSL --max-time 30 "$base/latest-v22.x/SHASUMS256.txt" 2>/dev/null) || continue
    line=$(printf '%s\n' "$sums" | grep -E " node-v22\.[0-9.]+-linux-$arch\.tar\.gz$" | head -n 1) || continue
    sum=${line%% *}
    file=${line##* }
    say "下载 $file（$base）" >&2
    curl -fL --max-time 600 --retry 2 -o "$tmp/$file" "$base/latest-v22.x/$file" || continue
    printf '%s  %s\n' "$sum" "$tmp/$file" | sha256sum -c - >/dev/null 2>&1 || { say "校验没通过，换一个地址" >&2; continue; }
    rm -rf "$ROOT/node.new"
    mkdir -p "$ROOT/node.new"
    tar -xzf "$tmp/$file" -C "$ROOT/node.new" --strip-components=1
    rm -rf "$ROOT/node"
    mv "$ROOT/node.new" "$ROOT/node"
    rm -rf "$tmp"
    printf '%s\n' "$ROOT/node/bin/node"
    return 0
  done
  rm -rf "$tmp"
  return 1
}

step "准备 Node.js"
mkdir -p "$ROOT"
NODE=$(find_node || true)
if [ -z "$NODE" ]; then
  say "没找到 $MIN_NODE 以上的 Node.js，下载一个只给洗衣房系统用（不影响服务器上的其他程序）"
  NODE=$(download_node) || die "Node.js 下载失败。可以在宝塔「网站 → Node 项目 → Node 版本管理器」装一个 v22 或 v24，再运行本脚本"
fi
node_ok "$NODE" || die "Node.js 不能运行：$NODE"
ln -sfn "$NODE" "$NODE_BIN"
say "用 $NODE（$("$NODE_BIN" -v)）"

NPM_CLI=$(dirname "$NODE")/../lib/node_modules/npm/bin/npm-cli.js
[ -f "$NPM_CLI" ] || NPM_CLI=$(readlink -f "$(command -v npm 2>/dev/null || echo /nonexistent)" 2>/dev/null || true)
[ -n "$NPM_CLI" ] && [ -f "$NPM_CLI" ] || die "找不到 npm（和 $NODE 一起装的那个）"
npm_run() { PATH="$(dirname "$NODE"):$PATH" "$NODE" "$NPM_CLI" "$@"; }

# ---------- 运行账号 ----------

if id www >/dev/null 2>&1; then
  RUN_USER=www
else
  RUN_USER=xiyifang
  id "$RUN_USER" >/dev/null 2>&1 ||
    useradd --system --home-dir "$ROOT" --shell "$(command -v nologin || echo /bin/false)" "$RUN_USER"
fi
RUN_GROUP=$(id -gn "$RUN_USER")

# ---------- 准备新程序（旧的照常运行） ----------

step "准备程序文件、安装依赖"
NEW=$ROOT/app.new
rm -rf "$NEW"
mkdir -p "$NEW"
tar -C "$SRC" --exclude=./.git --exclude=./node_modules --exclude=./data --exclude=./data-demo --exclude=./test -cf - . |
  tar -C "$NEW" -xf -
if ! (cd "$NEW" && npm_run ci --omit=dev --no-audit --no-fund --registry="$MIRROR" >/dev/null 2>&1); then
  say "国内镜像安装失败，换官方源再试"
  (cd "$NEW" && npm_run ci --omit=dev --no-audit --no-fund) || die "依赖安装失败（服务器连不上 npm）"
fi
(cd "$NEW" && "$NODE_BIN" --input-type=module -e "await import('express')") || die "依赖装好了但加载不了"
chown -R root:root "$NEW"

# ---------- 端口和配置 ----------

if [ -z "$PORT" ] && [ -f "$ENV_FILE" ]; then PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -n 1); fi
PORT=${PORT:-$DEFAULT_PORT}

port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

WAS_ACTIVE=0
systemctl is-active -q "$SERVICE" 2>/dev/null && WAS_ACTIVE=1

# ---------- 要导入的数据 ----------

if [ -z "$IMPORT" ] && [ ! -f "$DATA_DIR/laundry.db" ]; then
  IMPORT=$(ls -t "$ROOT"/*.db 2>/dev/null | head -n 1 || true)
  [ -n "$IMPORT" ] && say "找到上传的数据备份：$IMPORT"
fi

check_db() {
  "$NODE_BIN" --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const n = (sql) => db.prepare(sql).get().n;
    const users = n("SELECT COUNT(*) AS n FROM users");
    if (!users) { console.error("备份里没有账号"); process.exit(1); }
    const last = db.prepare("SELECT MAX(received_at) AS t FROM orders").get().t || "无";
    console.log(`账号 ${users} 个，客户 ${n("SELECT COUNT(*) AS n FROM customers")} 位，订单 ${n("SELECT COUNT(*) AS n FROM orders")} 单，最后一单送来时间 ${last}`);
  ' "$1"
}

if [ -n "$IMPORT" ]; then
  [ -f "$IMPORT" ] || die "找不到备份文件：$IMPORT"
  [ "$(head -c 15 "$IMPORT")" = "SQLite format 3" ] || die "$IMPORT 不是洗衣房系统的数据备份"
  step "检查要导入的数据"
  check_db "$IMPORT" || die "$IMPORT 读不出来，可能不是洗衣房系统的数据备份或文件不完整"
fi

# ---------- 停旧程序、换新程序 ----------

if [ "$WAS_ACTIVE" = 1 ]; then
  step "停止正在运行的洗衣房系统"
  systemctl stop "$SERVICE"
fi
if port_busy "$PORT"; then
  [ "$WAS_ACTIVE" = 1 ] && systemctl start "$SERVICE"
  rm -rf "$NEW"
  die "端口 $PORT 已经被别的程序占用了，换一个再运行：加上 --port 3200"
fi

install -d -m 750 -o "$RUN_USER" -g "$RUN_GROUP" "$DATA_DIR"
install -d -m 700 "$SAFE_DIR"

if [ -f "$DATA_DIR/laundry.db" ]; then
  # 换程序（或导入）之前先留一份现在的数据库
  keep=$SAFE_DIR/laundry-$(stamp)
  mkdir -p "$keep"
  for f in laundry.db laundry.db-wal laundry.db-shm; do
    [ -f "$DATA_DIR/$f" ] && cp -p "$DATA_DIR/$f" "$keep/"
  done
  say "现在的数据库已备份到 $keep"
  # 只留最近 10 份
  ls -1dt "$SAFE_DIR"/laundry-* 2>/dev/null | tail -n +11 | xargs -r rm -rf
fi

if [ -n "$IMPORT" ]; then
  step "导入数据"
  rm -f "$DATA_DIR/laundry.db" "$DATA_DIR/laundry.db-wal" "$DATA_DIR/laundry.db-shm"
  install -m 640 -o "$RUN_USER" -g "$RUN_GROUP" "$IMPORT" "$DATA_DIR/laundry.db"
  say "已导入 $IMPORT"
fi
chown -R "$RUN_USER:$RUN_GROUP" "$DATA_DIR"

rm -rf "$ROOT/app.prev"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$ROOT/app.prev"
mv "$NEW" "$APP_DIR"

cat >"$ENV_FILE" <<EOF
# 洗衣房管理系统的运行配置，改了以后：systemctl restart $SERVICE
PORT=$PORT
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
APP_TIMEZONE=Asia/Shanghai
EOF

cat >"$UNIT_FILE" <<EOF
# 洗衣房管理系统。由 $APP_DIR/deploy/install.sh 生成，端口等配置在 $ENV_FILE
[Unit]
Description=Laundry management system (xiyifang)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

# ---------- 启动并检查 ----------

step "启动"
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE" || true

STATUS=""
for _ in $(seq 1 20); do
  sleep 1
  STATUS=$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/auth/status" 2>/dev/null) && break
  STATUS=""
done

if [ -z "$STATUS" ]; then
  say "新程序启动不了，最近的日志："
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  if [ -d "$ROOT/app.prev" ]; then
    say "退回上一版程序"
    rm -rf "$APP_DIR"
    mv "$ROOT/app.prev" "$APP_DIR"
    systemctl restart "$SERVICE" || true
  else
    systemctl stop "$SERVICE" || true
  fi
  die "安装没完成。把上面的日志截图发给 Claude"
fi

say ""
say "洗衣房管理系统 v$VERSION 已经在运行：本机 127.0.0.1:$PORT，系统服务 $SERVICE，开机自动启动。"
say "  数据：$DATA_DIR/laundry.db（每天自动备份到 $DATA_DIR/backups/，留 30 天）"
say "  看状态：systemctl status $SERVICE    看日志：journalctl -u $SERVICE -n 100"
if printf '%s' "$STATUS" | grep -q '"need_setup":true'; then
  say ""
  say "注意：现在系统里还没有账号，谁先打开网页谁就能创建店长账号。"
  say "绑好域名后请马上自己打开创建；要用店里的数据，就把备份上传到 $ROOT/ 后用 --import 再运行一次。"
fi
say ""
say "还没绑定域名的话，在宝塔里做：网站 → 反向代理 → 添加反代，域名填 xiyi.你的域名，"
say "目标 URL 填 http://127.0.0.1:$PORT；再到这个站点的「SSL」申请 Let's Encrypt 证书，打开「强制 HTTPS」。"
