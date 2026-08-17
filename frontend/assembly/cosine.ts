// AssemblyScript SIMD kernel：批量余弦相似度（向量已归一化时等于点积）。
//
// 内存布局由 JS 侧管理：所有指针都是线性内存中的字节偏移。
// JS 通过 getHeapBase() 拿到可用起始地址，把 query / matrix 写入后调用
// cosineBatch，再从 outPtr 读回每个向量的分数。
//
// 编译：pnpm asbuild（见 package.json / asconfig.json）。SIMD 必须开启
// （--enable simd）；不可用时 JS 侧回退到纯 JS 实现，不加载本模块。

/** 返回可安全写入的堆起始偏移（静态数据之后）。 */
export function getHeapBase(): usize {
  return __heap_base;
}

/**
 * 计算查询向量与 count 个候选向量的点积。
 * @param queryPtr  查询向量起始偏移（dim 个 f32）
 * @param matrixPtr 候选矩阵起始偏移（count * dim 个 f32，行优先）
 * @param count     候选向量数量
 * @param dim       向量维度
 * @param outPtr    输出分数起始偏移（count 个 f32）
 */
export function cosineBatch(
  queryPtr: usize,
  matrixPtr: usize,
  count: i32,
  dim: i32,
  outPtr: usize,
): void {
  const simdEnd = dim & ~3; // dim 向下取到 4 的倍数
  const strideBytes = <usize>dim * 4;

  for (let i = 0; i < count; i++) {
    let rowPtr = matrixPtr + <usize>i * strideBytes;
    let acc = f32x4.splat(0);

    let j = 0;
    // SIMD 主循环：一次处理 4 个 f32
    for (; j < simdEnd; j += 4) {
      const byteOff = <usize>j * 4;
      const q = v128.load(queryPtr + byteOff);
      const m = v128.load(rowPtr + byteOff);
      acc = f32x4.add(acc, f32x4.mul(q, m));
    }

    let dot =
      f32x4.extract_lane(acc, 0) +
      f32x4.extract_lane(acc, 1) +
      f32x4.extract_lane(acc, 2) +
      f32x4.extract_lane(acc, 3);

    // 处理不足 4 的尾部
    for (; j < dim; j++) {
      const byteOff = <usize>j * 4;
      dot += load<f32>(queryPtr + byteOff) * load<f32>(rowPtr + byteOff);
    }

    store<f32>(outPtr + <usize>i * 4, dot);
  }
}
