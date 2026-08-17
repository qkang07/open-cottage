/**
 * 余弦相似度 WASM kernel 的 JS 封装。
 *
 * - 懒加载 assembly/cosine.ts 编译出的 cosine.wasm（见 pnpm asbuild）。
 * - 运行前检测 WebAssembly + SIMD 支持；任一缺失或加载失败均返回 null，
 *   由调用方（retrieve.ts）回退到纯 JS 实现。
 * - 线性内存布局由本模块管理，query / matrix 写入后调用 cosineBatch，
 *   再从 outPtr 读回分数。调用串行化，避免并发检索共享内存竞争。
 */

import {
  registerWasmModule,
  reportWasmStatus,
} from '../../platform/debug/wasmStatus';

interface CosineExports {
  memory: WebAssembly.Memory;
  getHeapBase(): number;
  cosineBatch(
    queryPtr: number,
    matrixPtr: number,
    count: number,
    dim: number,
    outPtr: number,
  ): void;
}

const MODULE_ID = 'cosine';
let cosineCalls = 0;

registerWasmModule({
  id: MODULE_ID,
  label: '余弦相似度 Kernel',
  description: '向量检索点积计算（WASM SIMD 加速），不可用时回退纯 JS',
});

const PAGE = 65536;

/** wasm-feature-detect 的 SIMD 探测模块字节 */
const SIMD_TEST = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
  0, 65, 0, 253, 15, 253, 98, 11,
]);

function supportsSimd(): boolean {
  try {
    return (
      typeof WebAssembly !== 'undefined' &&
      typeof WebAssembly.validate === 'function' &&
      WebAssembly.validate(SIMD_TEST)
    );
  } catch {
    return false;
  }
}

let modulePromise: Promise<CosineExports | null> | null = null;

async function loadModule(): Promise<CosineExports | null> {
  if (typeof WebAssembly === 'undefined' || !supportsSimd()) {
    reportWasmStatus(MODULE_ID, {
      state: 'unsupported',
      detail: '当前环境不支持 WebAssembly SIMD，使用纯 JS 计算',
    });
    return null;
  }
  reportWasmStatus(MODULE_ID, { state: 'loading', detail: '加载 cosine.wasm…' });
  try {
    const url = new URL('./cosine.wasm', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) {
      reportWasmStatus(MODULE_ID, {
        state: 'error',
        detail: '回退纯 JS：cosine.wasm 拉取失败',
        lastError: `HTTP ${res.status}`,
      });
      return null;
    }
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort() {
          throw new Error('cosine.wasm abort');
        },
      },
    });
    const exports = instance.exports as unknown as CosineExports;
    if (
      typeof exports.cosineBatch !== 'function' ||
      typeof exports.getHeapBase !== 'function' ||
      !(exports.memory instanceof WebAssembly.Memory)
    ) {
      reportWasmStatus(MODULE_ID, {
        state: 'error',
        detail: '回退纯 JS：wasm 导出校验失败',
        lastError: '导出不完整',
      });
      return null;
    }
    reportWasmStatus(MODULE_ID, { state: 'ready', detail: 'SIMD kernel 已就绪' });
    return exports;
  } catch (err) {
    reportWasmStatus(MODULE_ID, {
      state: 'error',
      detail: '加载异常，回退纯 JS',
      lastError: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function ensureModule(): Promise<CosineExports | null> {
  if (!modulePromise) {
    modulePromise = loadModule();
  }
  return modulePromise;
}

/** 检测 WASM kernel 是否可用（供 UI/日志判断） */
export async function isCosineKernelAvailable(): Promise<boolean> {
  return (await ensureModule()) !== null;
}

const align16 = (n: number): number => (n + 15) & ~15;

// 调用串行化：避免并发检索同时写入共享线性内存
let lock: Promise<unknown> = Promise.resolve();

/**
 * 用 WASM 计算 query 与 count 个候选向量的点积（分数）。
 * @returns 长度为 count 的分数数组；kernel 不可用或参数非法时返回 null。
 */
export async function computeCosineScores(
  query: Float32Array,
  matrix: Float32Array,
  count: number,
  dim: number,
): Promise<Float32Array | null> {
  if (count <= 0 || dim <= 0) return new Float32Array(0);
  if (query.length < dim || matrix.length < count * dim) return null;

  const run = lock.then(async () => {
    const mod = await ensureModule();
    if (!mod) return null;

    const queryPtr = align16(mod.getHeapBase());
    const matrixPtr = align16(queryPtr + dim * 4);
    const outPtr = align16(matrixPtr + count * dim * 4);
    const endByte = outPtr + count * 4;

    const havePages = mod.memory.buffer.byteLength / PAGE;
    const needPages = Math.ceil(endByte / PAGE);
    if (needPages > havePages) {
      try {
        mod.memory.grow(needPages - havePages);
      } catch {
        return null; // 内存增长失败，回退 JS
      }
    }

    // grow 后 buffer 会被替换，视图必须在增长之后创建
    const heap = new Float32Array(mod.memory.buffer);
    heap.set(query.subarray(0, dim), queryPtr / 4);
    heap.set(matrix.subarray(0, count * dim), matrixPtr / 4);

    mod.cosineBatch(queryPtr, matrixPtr, count, dim, outPtr);

    const out = new Float32Array(count);
    out.set(new Float32Array(mod.memory.buffer, outPtr, count));
    cosineCalls++;
    reportWasmStatus(MODULE_ID, {
      metrics: [`已加速 ${cosineCalls} 次检索`],
      lastUsedAt: Date.now(),
    });
    return out;
  });

  // 无论成功与否都推进锁，避免异常卡死后续调用
  lock = run.catch(() => undefined);
  return run;
}
