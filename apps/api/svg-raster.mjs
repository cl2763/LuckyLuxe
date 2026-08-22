/* 签署快照栅格化(真机 SVG 空白件,店主 2026-08-23)。
   背景:小程序 <image> 在**真机**上渲染不了带 <text> 的 SVG(开发者工具的浏览器内核认,手机不认)——
   店主真机实测:壳全对、图全空白。修法=图源换 PNG,**契约不动**(snapshotUrl 与 groupSheetLinks
   唯一出口原样),八处入口三端动线零改动。

   零依赖红线照守:不引 npm 包。栅格化按可用后端择一(装了哪个用哪个):
     ① rsvg-convert(librsvg;生产 Railway 由 nixpacks 装,尺寸精确)
     ② magick / convert(ImageMagick)
     ③ qlmanage(macOS 自带 Quick Look;输出是正方形画布,用下面的纯 JS 裁边裁回真实高度)
   PNG 的解码/裁剪/编码用 node:zlib 手写(8-bit RGBA 非隔行,正是上面几个后端的输出格式),
   顺带给出 pngSize() 供断言核尺寸。 */
import { spawnSync } from 'node:child_process'
import { deflateSync, inflateSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function has(cmd) {
  try { return spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0 } catch (e) { return false }
}

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// PNG 尺寸(IHDR 前 8 字节),断言与裁边都用它
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/* 把 8-bit RGBA 非隔行 PNG 裁到指定高度(qlmanage 会把图放进正方形画布,下方是透明留白)。
   解码=拼 IDAT→inflate→逐行去滤波;编码=每行 filter 0 + deflate。 */
export function pngCropHeight(buf, keepHeight) {
  const size = pngSize(buf)
  if (!size || keepHeight >= size.height || keepHeight <= 0) return buf
  let pos = 8
  let ihdr = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') ihdr = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (!ihdr || !idat.length) return buf
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const interlace = ihdr[12]
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return buf   // 只处理 8-bit RGBA 非隔行,其余原样返回
  const w = size.width
  const bpp = 4
  const stride = w * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(keepHeight * (stride + 1))
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  for (let y = 0; y < keepHeight; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += Math.floor((a + b) / 2)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[x] = v & 0xff
    }
    out[y * (stride + 1)] = 0
    cur.copy(out, y * (stride + 1) + 1)
    cur.copy(prev)
  }
  const newIhdr = Buffer.from(ihdr)
  newIhdr.writeUInt32BE(keepHeight, 4)
  return Buffer.concat([PNG_SIG, chunk('IHDR', newIhdr), chunk('IDAT', deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

export function rasterBackend() {
  if (has('rsvg-convert')) return 'rsvg-convert'
  if (has('magick')) return 'magick'
  if (has('convert')) return 'convert'
  if (has('qlmanage')) return 'qlmanage'
  return ''
}

/* SVG → PNG。width=输出像素宽(默认 2 倍图,手机上放大看不糊);
   拿不到任何后端时返回 null(调用方回落原 SVG,绝不因转换失败挡住看单)。 */
export function svgToPng(svg, { width = 1440 } = {}) {
  const backend = rasterBackend()
  if (!backend || !svg) return null
  const dir = mkdtempSync(join(tmpdir(), 'llsnap-'))
  const src = join(dir, 'a.svg')
  const dst = join(dir, 'a.png')
  try {
    writeFileSync(src, svg)
    // 原始视口:按它算目标高度(等比),qlmanage 的正方形留白也按这个裁回去
    const m = /<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"[^>]*\bheight="(\d+(?:\.\d+)?)"/.exec(svg)
      || /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg)
    const vw = m ? Number(m[1]) : 720
    const vh = m ? Number(m[2]) : 0
    const targetH = vh ? Math.round(width * (vh / vw)) : 0
    if (backend === 'rsvg-convert') {
      spawnSync('rsvg-convert', ['-w', String(width), '-o', dst, src], { timeout: 20000 })
    } else if (backend === 'magick' || backend === 'convert') {
      spawnSync(backend, ['-background', 'white', '-density', '288', src, '-resize', `${width}x`, dst], { timeout: 20000 })
    } else {
      spawnSync('qlmanage', ['-t', '-s', String(width), '-o', dir, src], { timeout: 20000, stdio: 'ignore' })
      try { writeFileSync(dst, readFileSync(join(dir, 'a.svg.png'))) } catch (e) { /* 没出图=下面返回 null */ }
    }
    let png = null
    try { png = readFileSync(dst) } catch (e) { return null }
    if (!png || !png.length || !pngSize(png)) return null
    // qlmanage 输出正方形画布:把下方透明留白裁掉,回到单据真实比例
    if (targetH) {
      const got = pngSize(png)
      if (got.height > targetH + 2) png = pngCropHeight(png, Math.min(targetH, got.height))
    }
    return png
  } catch (e) {
    return null
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch (e) { /* 临时目录清不掉不影响 */ }
  }
}
