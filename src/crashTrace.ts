/**
 * 崩溃面包屑（2026-09-12 打包版黑屏排查）：
 * 打包版 WKWebView 无控制台、Web 内容进程死亡无崩溃报告——关键节点经
 * Tauri save_file 命令落盘 /tmp/kaolin-trace.log，事后读日志定位最后一步。
 * 浏览器 dev（无 __TAURI_INTERNALS__）调用 invoke 会抛错，被捕获后静默 no-op。
 */
const mem: string[] = [];
let flushing = false;
let installed = false;

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    if ('__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_file', {
        path: '/tmp/kaolin-trace.log',
        data: new TextEncoder().encode(`${mem.join('\n')}\n`),
      });
    }
  } catch {
    /* 落盘失败静默（浏览器环境属预期） */
  } finally {
    flushing = false;
  }
}

/** 记一条面包屑（环形 400 条；写入有合并，异常场景下最后一条即死亡现场） */
export function trace(msg: string): void {
  mem.push(`${new Date().toISOString()} ${msg}`);
  if (mem.length > 400) mem.splice(0, mem.length - 400);
  void flush();
}

/** 安装全局异常/生命周期钩子（幂等；main.tsx 最早调用） */
export function installCrashTrace(): void {
  if (installed) return;
  installed = true;
  trace('install-crash-trace');
  window.addEventListener('error', (e) =>
    trace(`JS-ERROR ${e.message} @${e.filename}:${e.lineno}:${e.colno}`),
  );
  window.addEventListener('unhandledrejection', (e) => trace(`JS-REJECT ${String(e.reason)}`));
  // WebGL 上下文丢失（GPU 进程问题先兆）：捕获阶段监听所有 canvas
  window.addEventListener(
    'webglcontextlost',
    (e) => trace(`WEBGL-CONTEXT-LOST target=${(e.target as HTMLElement | null)?.tagName ?? '?'}`),
    true,
  );
  document.addEventListener('visibilitychange', () => trace(`VIS=${document.visibilityState}`));
  window.addEventListener('pagehide', () => trace('PAGEHIDE'));
}
