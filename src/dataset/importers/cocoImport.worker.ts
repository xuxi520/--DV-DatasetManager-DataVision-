// COCO 重型解析 Worker：在独立线程 JSON.parse 巨型标注 json（val2017 单份可达 200MB+），
// 转换为紧凑样本结构后回传主线程。主线程仅做类别合并与 getBytes 回填，全程不被阻塞，UI 保持响应。
// 注：json 文本由主线程通过 read_file_text 异步读取后传入（读取本身不阻塞主线程；
//      仅 JSON.parse 是 CPU 重活，放在此处执行）。
import { ClassRegistry } from '../classRegistry'
import { transformCocoData, type RawSample } from './cocoTransform'

interface Req {
  id: number
  path: string
  text: string
}
interface Res {
  id: number
  ok: boolean
  path: string
  samples?: RawSample[]
  classes?: { id: number; name: string }[]
  warnings?: string[]
  error?: string
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, path, text } = e.data
  try {
    const data = JSON.parse(text)
    const registry = new ClassRegistry()
    const { samples, warnings } = transformCocoData(data, path, registry)
    const classes = registry.classes.map((c) => ({ id: c.id, name: c.name }))
    ;(self as any).postMessage({ id, ok: true, path, samples, classes, warnings } as Res)
  } catch (err) {
    ;(self as any).postMessage({ id, ok: false, path, error: String(err) } as Res)
  }
}
