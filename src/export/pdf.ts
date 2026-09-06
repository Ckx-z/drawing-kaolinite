/**
 * PDF 导出 —— T-5.2（先位图版：jsPDF 按物理尺寸嵌入 PNG；svg2pdf 矢量嵌入为后续迭代）
 *
 * 页面物理尺寸 = 设定 cm 数（unit: 'cm' + format）；orientation 显式指定避免
 * jsPDF 按隐式方向交换宽高。图像满幅铺满页面 → 有效分辨率 = 位图 dpi。
 */
import { jsPDF } from 'jspdf';

/** PNG dataURL → PDF Blob（页面尺寸 wCM × hCM，图像满幅） */
export function pngToPdf(dataUrl: string, wCM: number, hCM: number): Blob {
  const doc = new jsPDF({
    unit: 'cm',
    format: [wCM, hCM],
    orientation: wCM > hCM ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.addImage(dataUrl, 'PNG', 0, 0, wCM, hCM);
  return doc.output('blob');
}
