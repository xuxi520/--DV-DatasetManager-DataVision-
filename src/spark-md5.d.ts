// spark-md5 没有自带类型声明，这里提供最小声明以通过类型检查。
declare module 'spark-md5' {
  const SparkMD5: any
  export default SparkMD5
}
