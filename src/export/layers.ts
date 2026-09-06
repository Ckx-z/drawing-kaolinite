/**
 * 分层透明 PNG 导出 —— T-5.4（PPT 叠放编辑第二路径）
 *
 * 逐层（每可见组件一张 RGBA 透明底 PNG，按画家序远→近）导出；PPT 中按同序
 * 叠放即可还原整图（验收：与整图渲染像素差 <1%）。「当前可见层合并」= 既有
 * exportPNG({alpha:true})，此处不重复实现。
 */

export interface LayerPng {
  /** 图层名（图层名一致原则） */
  name: string;
  /** 文件名（已清洗，含序号保证文件系统排序 = 叠放顺序） */
  filename: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** 图层名 → 文件名安全串（空格→连字符，剔除路径/非法字符） */
export function sanitizeLayerName(name: string): string {
  return name.trim().replace(/\s+/g, '-').replace(/[\\/]/g, '') || 'layer';
}

/** 最小服务面（RendererService 满足；测试用替身亦可） */
export interface LayeredExportService {
  visibleLayersByDepth(): Array<{ id: string; name: string }>;
  exportComponentPNG(
    id: string,
    opts: { dpi: number; widthCM?: number; alpha?: boolean },
  ): { dataUrl: string; width: number; height: number } | null;
}

/** 逐层导出可见组件（远→近，文件名序号与叠放顺序一致） */
export function buildLayerPngs(
  svc: LayeredExportService,
  opts: { dpi: number; widthCM?: number },
): LayerPng[] {
  const layers = svc.visibleLayersByDepth();
  const out: LayerPng[] = [];
  layers.forEach((layer, i) => {
    const png = svc.exportComponentPNG(layer.id, { ...opts, alpha: true });
    if (!png) return;
    const seq = String(i + 1).padStart(2, '0');
    out.push({
      name: layer.name,
      filename: `${seq}-${sanitizeLayerName(layer.name)}.png`,
      dataUrl: png.dataUrl,
      width: png.width,
      height: png.height,
    });
  });
  return out;
}
