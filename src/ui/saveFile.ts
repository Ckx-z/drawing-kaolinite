/**
 * 导出文件保存统一入口 —— 2026-09-08
 *
 * 背景：Tauri 打包后 WKWebView 里 <a download> 点击无效（导出"失败"的根因）。
 * 策略（按运行环境）：
 *  - 桌面端（__TAURI_INTERNALS__）：tauri-plugin-dialog 原生保存对话框选路径/文件名
 *    → invoke('save_file') 写盘。用户取消 = 静默返回 false，不执行任何导出。
 *  - 浏览器：优先 File System Access showSaveFilePicker（Chromium，可选路径），
 *    不支持/取消时退回传统 <a download>（下载到默认下载目录）。
 *
 * 返回 true = 已落盘/已开始下载；false = 用户取消（调用方不报错）。
 * 写盘失败抛错（调用方 toast 提示）。
 */

const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

const extOf = (filename: string): string => filename.includes('.') ? filename.split('.').pop()! : 'bin';

const TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  tiff: 'image/tiff',
  gif: 'image/gif',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  json: 'application/json',
};

/** dataURL → Blob（PNG/GIF 导出走 dataUrl，统一转 Blob 落盘） */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** 单文件保存：弹一次保存对话框（桌面）或 showSaveFilePicker/下载（浏览器） */
export async function saveBlob(filename: string, blob: Blob): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const ext = extOf(filename);
    const path = await save({
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return false; // 用户取消：不导出、不报错
    const data = new Uint8Array(await blob.arrayBuffer());
    await invoke('save_file', { path, filename: null, data });
    return true;
  }

  // 浏览器：File System Access（可选路径）优先，不可用退回 a[download]
  try {
    const w = window as unknown as {
      showSaveFilePicker?: (opts: { suggestedName?: string; types?: Array<{ accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>;
    };
    if (w.showSaveFilePicker) {
      const ext = extOf(filename);
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ accept: { [TYPE_BY_EXT[ext] ?? 'application/octet-stream']: ['.' + ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return false; // 用户取消
    // 其他异常（权限/不支持）→ 退回传统下载
  }
  legacyDownload(blob, filename);
  return true;
}

/** 便捷封装：文本内容（SVG/JSON）保存 */
export async function saveText(filename: string, text: string, mime: string): Promise<boolean> {
  return saveBlob(filename, new Blob([text], { type: mime }));
}

/** 多文件导出（分层 PNG）：桌面端选一次目录批量写；浏览器逐个下载 */
export async function saveBlobs(files: Array<{ filename: string; blob: Blob }>): Promise<boolean> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const dir = await open({ directory: true, title: '选择分层导出目录' });
    if (!dir) return false;
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      await invoke('save_file', { path: dir, filename: f.filename, data });
    }
    return true;
  }
  for (const f of files) legacyDownload(f.blob, f.filename);
  return true;
}

/** 传统下载（浏览器兜底） */
function legacyDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
