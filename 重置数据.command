#!/bin/bash
# Lucky Luxe 本地数据一键清零(正式上线前使用)
# 会先把当前数据库完整备份到 apps/api/local-data/backups/,然后删除,
# 下次启动服务器时自动生成全新空库(只含出厂种子数据)。
cd "$(dirname "$0")"
echo "⚠️  即将清空所有本地业务数据(订单/会话/财务/储值/会员...)"
echo "    当前数据会先备份到 apps/api/local-data/backups/,可随时找回。"
read -p "确认请输入 YES 后回车(其他任意输入取消): " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "已取消,什么都没有改动。"
  exit 0
fi
echo "正在停止服务器..."
pkill -f "local-server.mjs" 2>/dev/null
sleep 1
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p apps/api/local-data/backups
if [ -f apps/api/local-data/lucky-luxe.sqlite ]; then
  mv apps/api/local-data/lucky-luxe.sqlite "apps/api/local-data/backups/lucky-luxe-$STAMP.sqlite"
  rm -f apps/api/local-data/lucky-luxe.sqlite-journal
  echo "✅ 已备份到 backups/lucky-luxe-$STAMP.sqlite 并清空当前数据。"
else
  echo "没有找到数据库文件,无需清空。"
fi
echo "现在双击「启动服务器.command」即可以全新空库启动。"
