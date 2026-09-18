#!/bin/bash
# 「还回去了」的判据 —— 🔴 **一个 200 只证明有东西在应答,不证明应答的是哪个版本。**
#
# 立件(店主 09p §五② 批,立为常驻):09p 批我为了做推前/推后对照,在 `285b20d` 的工作树里
# 跑了一次那一版的回归。那一版的 `restore_local` / `restore_sandbox` **从它自己那棵树**
# 把 4128 / 4310 拉了起来 —— 跑完之后两个端口都答 200、屏幕上写着「已把店主的本地服务重新拉起来」,
# **而里面跑的是三周前的 `local-server.mjs`**(`lsof` 现证 cwd 在 `/private/tmp/…/wt-285b20d/apps/api`)。
# 店主这时候打开后台,看到的是一个三周前的 app,**而且没有任何东西会告诉她**。
#
# 归族:J-74 的服务版 —— **字面对(200),印象错(以为是新代码)。**
# 老条款只管「活没活」,不管「是不是这一版」。
#
# 用法:bash tools/verify-restored.sh <端口> <期望的仓库根目录>
# 退出码:0 = 还对了;1 = 没还对(**当没还回去处理**,不许当成绿)
set -u
PORT="${1:?用法:verify-restored.sh <端口> <期望仓库根>}"
ROOT="${2:?用法:verify-restored.sh <端口> <期望仓库根>}"

BODY="$(curl -s --max-time 5 "http://127.0.0.1:${PORT}/health" || true)"
if [ -z "$BODY" ]; then
  echo "🔴 ${PORT}:没有应答 —— 连 200 都没有,更谈不上版本。" >&2
  exit 1
fi

# 三问,一问一答,**每一问都要能单独说出为什么红**。
# ⚠️ 这里不许用 `node - … <<NODE`:脚本本身和 /health 的正文会抢同一个 stdin。
# 把判据写进一个临时 .mjs,正文从 argv 传进去,两者各走各的。
CHK="$(mktemp /tmp/ll-verify-restored.XXXXXX.mjs)"
trap 'rm -f "$CHK"' EXIT
cat > "$CHK" <<'NODE'
const [port, root, s] = process.argv.slice(2)
;(() => {
  let h
  try { h = JSON.parse(s) } catch { console.error(`🔴 ${port}:/health 不是 JSON —— 这一版根本不是我们认识的那个服务。`); process.exit(1) }
  if (h.ok !== true) { console.error(`🔴 ${port}:/health.ok 不是 true(${JSON.stringify(h.ok)})。`); process.exit(1) }
  /* ① 字段集指纹:`dataFile` 是**这一版才有**的字段。
     285b20d 那一版没有它 —— 09p 那次就是靠「(没有这个字段)」才暴露的,
     而暴露它的是预检,不是 restore 本身。现在 restore 自己也得看。 */
  if (!h.dataFile) {
    console.error(`🔴 ${port}:/health 里没有 dataFile 字段 —— 这是**旧版本**在应答(本版一定有这个字段)。`)
    process.exit(1)
  }
  /* ② 来源指纹:库路径必须落在**期望的那棵树**里。
     同一版代码、跑在另一棵工作树上,①过不了②,这一条才是真正认「哪一份代码」的那一问。 */
  if (!String(h.dataFile).startsWith(root.replace(/\/+$/, '') + '/')) {
    console.error(`🔴 ${port}:库路径不在期望的树里 —— 期望 ${root} 下,实际 ${h.dataFile}`)
    console.error(`   这正是 09p 那一次的形态:200 是真的,版本是错的。`)
    process.exit(1)
  }
  console.log(`✅ ${port}:版本指纹对上了(dataFile=${h.dataFile})`)
})()
NODE
node "$CHK" "$PORT" "$ROOT" "$BODY"
