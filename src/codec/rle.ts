/**
 * COCO RLE 掩码解码
 *
 * 支持两种 counts 形式：
 *  - number[]：未压缩 RLE（偶长度 run-length，0/1 交替，首段为 0 背景）
 *  - string ：pycocotools 紧凑编码（`toString` 产物，2 位十进制 run 数 + 每个 run 以 94 进制
 *    基（ASCII 33 起）写出、以 char(127) 结尾）
 *
 * 返回与 size=[height,width] 对应的布尔像素数组（行主序，长度 = h*w）。
 */

function expandCounts(counts: number[], total: number): Uint8Array {
  const mask = new Uint8Array(total)
  let pos = 0
  let val = 0
  for (let i = 0; i < counts.length; i++) {
    const run = counts[i]
    if (val === 1) mask.fill(1, pos, Math.min(pos + run, total))
    pos += run
    if (pos >= total) break
    val = val === 0 ? 1 : 0
  }
  return mask
}

/** 紧凑字符串 RLE -> 未压缩 run-length 数组（pycocotools 兼容） */
function frString(s: string): number[] {
  const bytes = Array.from(s, (ch) => ch.charCodeAt(0))
  if (bytes.length < 2) return []
  const m = (bytes[0] - 48) * 10 + (bytes[1] - 48)
  const cnts: number[] = []
  let i = 2
  for (let k = 0; k < m && i < bytes.length; k++) {
    let x = 0
    for (;;) {
      const v = bytes[i] - 33
      i++
      if (v === 94) break // char(127) 结束符
      x = x * 94 + v
    }
    cnts.push(x)
  }
  return cnts
}

export function decodeRle(
  counts: string | number[],
  size: [number, number],
): Uint8Array {
  const [h, w] = size
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return new Uint8Array(0)
  const total = Math.floor(h) * Math.floor(w)
  if (!Number.isFinite(total) || total <= 0) return new Uint8Array(0)
  const uncompressed = typeof counts === 'string' ? frString(counts) : counts
  return expandCounts(uncompressed, total)
}
