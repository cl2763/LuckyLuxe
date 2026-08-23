/* 手写笔迹 → **透明底** PNG(零依赖,纯 JS)。

   为什么单独写一条路(店主 2026-08-24 图标白底件的连带发现):
   笔迹图原来走 svgToPng —— 那条路是给**单据**用的,单据是白纸所以刻意铺白底
   (magick -background white / qlmanage 天生铺白)。笔迹是要**叠在单据上**的透明线条,
   铺了白底就是一块白方块;现在没露馅只因为 sign.html 给它加了 mix-blend-mode:multiply
   (白×白=看不见)——换个非白背景、或换个不支持混合模式的渲染层,白块立刻现形。

   笔迹数据本身只有 M/L 两种指令(折线),用不着 SVG 渲染器:
   这里直接按折线画,圆头圆角靠"沿线铺圆点"实现,2 倍超采样抗锯齿,输出 8-bit RGBA。
   好处不只是透明:本机/CI/生产都不再依赖 librsvg 装没装。 */
import { deflateSync } from 'node:zlib'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(rgba, w, h) {
  const stride = w * 4
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* d="M x,y L x,y ..." → 点序列(只认 M/L,笔迹就这两种) */
function parsePolyline(d) {
  const out = []
  let cur = null
  const re = /([ML])\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g
  let m = re.exec(d)
  while (m) {
    const [, cmd, xs, ys] = m
    const pt = [Number(xs), Number(ys)]
    if (cmd === 'M') { cur = [pt]; out.push(cur) } else if (cur) cur.push(pt)
    m = re.exec(d)
  }
  return out.filter((seg) => seg.length)
}

/* 画一支笔:沿折线铺半径 r 的圆(圆头圆角天然成立) */
function strokePolyline(buf, w, h, pts, r, rgb) {
  const dot = (cx, cy) => {
    const x0 = Math.max(0, Math.floor(cx - r)); const x1 = Math.min(w - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r)); const y1 = Math.min(h - 1, Math.ceil(cy + r))
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx; const dy = y + 0.5 - cy
        if (dx * dx + dy * dy > r * r) continue
        const o = (y * w + x) * 4
        buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2]; buf[o + 3] = 255
      }
    }
  }
  if (pts.length === 1) { dot(pts[0][0], pts[0][1]); return }
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]
    const dist = Math.hypot(bx - ax, by - ay)
    const steps = Math.max(1, Math.ceil(dist * 2))
    for (let s = 0; s <= steps; s += 1) dot(ax + (bx - ax) * (s / steps), ay + (by - ay) * (s / steps))
  }
}

/* 主出口:paths(SVG d 字符串数组)+ 视口 → 透明底 PNG。
   viewBox 用调用方算好的 x0/y0/w/h(与 /signature.svg 同一套取值),保证 PNG 与 SVG 同框。 */
export function inkToPng(paths, { x0, y0, w, h, width = 720, strokeWidth = 2, color = '#241f1d' } = {}) {
  if (!Array.isArray(paths) || !paths.length || !(w > 0) || !(h > 0)) return null
  const SS = 2                                  // 2 倍超采样后下采样 = 边缘不毛刺
  const outW = Math.max(1, Math.round(width))
  const outH = Math.max(1, Math.round(width * (h / w)))
  const bw = outW * SS; const bh = outH * SS
  if (bw * bh > 16e6) return null                // 防御:异常大的笔迹不画
  const scale = bw / w
  const big = Buffer.alloc(bw * bh * 4)          // 全 0 = 全透明,这就是"真透明底"
  const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
  const r = Math.max(1, (strokeWidth * scale) / 2)
  for (const d of paths) {
    for (const seg of parsePolyline(d)) {
      strokePolyline(big, bw, bh, seg.map(([x, y]) => [(x - x0) * scale, (y - y0) * scale]), r, rgb)
    }
  }
  // 下采样:alpha 取覆盖率,颜色取笔色 —— 透明处 alpha 恒 0
  const small = Buffer.alloc(outW * outH * 4)
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      let a = 0
      for (let dy = 0; dy < SS; dy += 1) {
        for (let dx = 0; dx < SS; dx += 1) {
          if (big[((y * SS + dy) * bw + (x * SS + dx)) * 4 + 3]) a += 1
        }
      }
      const o = (y * outW + x) * 4
      small[o] = rgb[0]; small[o + 1] = rgb[1]; small[o + 2] = rgb[2]
      small[o + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return encodePng(small, outW, outH)
}
