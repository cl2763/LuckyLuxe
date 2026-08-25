/* 顶层函数真实长度(按 } 收在第 0 列判定函数结束)——
   上一版体检用的是「到下一个 function 声明的距离」,那不是函数长度:
   函数后面跟一大段非函数代码时,距离会把那段全算进去(updateWechatMock 被算成 892 行就是这么来的)。 */
import { readFileSync } from 'node:fs'
const file = process.argv[2]
const lines = readFileSync(file, 'utf8').split('\n')
const out = []
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^(async )?function ([A-Za-z0-9_$]+)/)
  if (!m) continue
  let end = i
  for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[j] === '}') { end = j; break }
    if (/^(async )?function /.test(lines[j])) { end = j - 1; break }
  }
  out.push([m[2], i + 1, end + 1, end - i + 1])
}
out.sort((a, b) => b[3] - a[3])
console.log(`${file}:顶层函数 ${out.length} 个`)
for (const [n, s, e, c] of out.slice(0, 12)) console.log(`  ${String(c).padStart(4)} 行  ${n}  (${s}-${e})`)
