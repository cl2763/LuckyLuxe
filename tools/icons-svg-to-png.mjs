/* 图标 SVG → PNG(**保留真透明**)。店主 2026-08-24:上一批转出来的 23 个图标四角是
   (255,255,255,255) 纯白不透明 —— 转换时铺了白底再画线条,原 SVG 本无底,深色背景上立刻现形。

   🔴 后端选择(顺序即优先级),qlmanage 明确禁用:
     ① rsvg-convert -b none      (librsvg;CI/生产装的就是它)
     ② magick -background none -alpha set
     ③ @resvg/resvg-js          (纯 Rust 渲染器,本机没有前两者时用;只在生成资产时需要,不进运行时依赖)
     ✗ qlmanage —— 它**铺白底**,图标一律不许用它;单据快照是白纸,不受此限(那条路在 apps/api/svg-raster.mjs)。

   转完**逐像素自检**:四角 alpha 必须为 0,不合格直接退出码 1(判据要能证伪你要证的那件事 ——
   上一批只验了「有 alpha 通道」,而白底图一样有 alpha 通道,所以自检绿了缺陷还在)。

   用法: node tools/icons-svg-to-png.mjs [--resvg <resvg-js 模块路径>]
*/
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import zlib from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICON_DIR = join(ROOT, 'miniprogram/assets/icons')
const WIDTH = 144
const resvgFlag = process.argv.indexOf('--resvg')
const RESVG_PATH = resvgFlag > -1 ? process.argv[resvgFlag + 1] : process.env.RESVG_PATH || ''

const has = (bin) => spawnSync('which', [bin], { encoding: 'utf8' }).status === 0
let backend = ''
let Resvg = null
if (has('rsvg-convert')) backend = 'rsvg-convert'
else if (has('magick')) backend = 'magick'
else if (RESVG_PATH) {
  try { ({ Resvg } = await import(RESVG_PATH)); backend = 'resvg-js' } catch (e) { /* 下面报错 */ }
}
if (!backend) {
  console.error('没有可用的渲染后端。装 librsvg(brew install librsvg)或传 --resvg <@resvg/resvg-js 路径>。')
  console.error('⚠️ qlmanage 会铺白底,图标一律不许用它。')
  process.exit(1)
}
console.log(`渲染后端:${backend}`)

function render(svgPath, pngPath, svgText) {
  if (backend === 'rsvg-convert') {
    const r = spawnSync('rsvg-convert', ['-b', 'none', '-w', String(WIDTH), '-o', pngPath, svgPath], { timeout: 20000 })
    return r.status === 0
  }
  if (backend === 'magick') {
    const r = spawnSync('magick', ['-background', 'none', '-alpha', 'set', '-density', '288', svgPath, '-resize', `${WIDTH}x`, pngPath], { timeout: 20000 })
    return r.status === 0
  }
  const img = new Resvg(svgText, { fitTo: { mode: 'width', value: WIDTH }, background: 'rgba(0,0,0,0)' })
  writeFileSync(pngPath, img.render().asPng())
  return true
}

/* 逐像素读四角(8bit RGBA 非隔行) */
function corners(buf) {
  let pos = 8; let w = 0; let h = 0; let bitDepth = 0; let colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (colorType !== 6 || bitDepth !== 8) return null
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = 4; const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p]; p += 1
    const line = raw.subarray(p, p + stride); p += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += Math.floor((a + b) / 2)
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[x] = v & 0xff
    }
  }
  const px = (x, y) => { const o = y * stride + x * bpp; return out[o + 3] }
  let opaquePixels = 0
  for (let i = 3; i < out.length; i += 4) if (out[i] > 0) opaquePixels += 1
  return { w, h, alphas: [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)], opaquePixels, total: w * h }
}

const svgs = readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg')).sort()
let bad = 0
for (const f of svgs) {
  const svgPath = join(ICON_DIR, f)
  const pngPath = svgPath.replace(/\.svg$/, '.png')
  const svgText = readFileSync(svgPath, 'utf8')
  if (!render(svgPath, pngPath, svgText)) { console.log(`❌ ${f} 渲染失败`); bad += 1; continue }
  const c = corners(readFileSync(pngPath))
  if (!c) { console.log(`❌ ${f} 输出不是 8bit RGBA`); bad += 1; continue }
  const cornerOk = c.alphas.every((a) => a === 0)
  // 线条图标:不透明像素占比应远小于整张(铺了底就会接近 100%)
  const inkRatio = c.opaquePixels / c.total
  const inkOk = inkRatio > 0 && inkRatio < 0.6
  if (!cornerOk || !inkOk) bad += 1
  console.log(`${cornerOk && inkOk ? '✅' : '❌'} ${f} → ${c.w}x${c.h} 四角 alpha=${c.alphas.join(',')} 着墨占比=${(inkRatio * 100).toFixed(1)}%`)
}
console.log(`\n合计 ${svgs.length} 个,不合格 ${bad} 个`)
process.exit(bad === 0 ? 0 : 1)
