// umap-js 模块声明（若其发布包未自带类型，则以此兜底，保证 vue-tsc 通过）。
declare module 'umap-js' {
  export class UMAP {
    constructor(options?: {
      nComponents?: number
      nNeighbors?: number
      minDist?: number
      spread?: number
      random?: () => number
    })
    fit(data: number[][]): number[][]
  }
  export class PCA {
    constructor(options?: { nComponents?: number })
    transform(data: number[][]): number[][]
  }
}
