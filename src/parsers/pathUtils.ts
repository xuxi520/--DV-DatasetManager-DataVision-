/** 路径工具：取文件名（不含扩展名）/ 取目录路径，解析器间共享 */

export function stem(path: string): string {
  const name = path.split('/').pop() || path.split('\\').pop() || ''
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.substring(0, dotIndex) : name
}

export function dir(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.substring(0, i + 1) : ''
}
