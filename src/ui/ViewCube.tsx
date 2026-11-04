/**
 * ViewCube 视角方块（三维工作台升级 P0-B，2026-11-03）
 *
 * CSS 3D 立方体（无第二套 WebGLRenderer），固定于画布右下角：
 * - 姿态实时同步：rAF 循环读 camera.quaternion → cubeMatrixForCamera（纯函数，
 *   单测覆盖）→ 直接写 DOM transform（零 React 重绘，含阻尼停止前的每一帧）；
 * - 点击六面：animateCameraToView 弧线动画转标准视角（保持 target/视距，
 *   250ms 缓入缓出；用户拖画布/滚轮即接管取消）；
 * - 事件 stopPropagation，绝不触发三维拾取/选中；
 * - 纯 2D 示意图模式隐藏；DOM 覆盖层天然不进任何 WebGL 导出。
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { rendererRef } from '../state/rendererRef';
import { sceneStore } from '../state/sceneStore';
import { animateCameraToView, cancelCameraAnimation, cubeMatrixForCamera, type ViewDir } from '../render/cameraNavigation';

const FACES: Array<{ dir: ViewDir; label: string; transform: string }> = [
  { dir: 'front', label: '前', transform: 'rotateY(0deg) translateZ(20px)' },
  { dir: 'back', label: '后', transform: 'rotateY(180deg) translateZ(20px)' },
  { dir: 'right', label: '右', transform: 'rotateY(90deg) translateZ(20px)' },
  { dir: 'left', label: '左', transform: 'rotateY(-90deg) translateZ(20px)' },
  { dir: 'top', label: '顶', transform: 'rotateX(90deg) translateZ(20px)' },
  { dir: 'bottom', label: '底', transform: 'rotateX(-90deg) translateZ(20px)' },
];

const matrixCss = (m: number[]): string =>
  `matrix3d(${m.map((n) => n.toFixed(5)).join(',')})`;

export default function ViewCube(): React.ReactElement | null {
  const mode = useStore(sceneStore, (s) => s.mode);
  const cubeRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let raf = 0;
    const loop = (): void => {
      raf = requestAnimationFrame(loop);
      const svc = rendererRef.current;
      const el = cubeRef.current;
      if (!svc || !el) return;
      const q = svc.camera.quaternion;
      // cubeMatrixForCamera：q⁻¹ 视图旋转 + CSS y 轴预翻转（纯函数，单测锁定）
      el.style.transform = matrixCss(cubeMatrixForCamera([q.x, q.y, q.z, q.w]));
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      cancelCameraAnimation();
    };
  }, []);

  if (mode !== 'mixed' || !mounted) return null;

  const navigate = (dir: ViewDir): void => {
    const svc = rendererRef.current;
    if (!svc) return;
    animateCameraToView(svc, dir);
  };

  return (
    <div
      className="viewcube"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      title="视角方块：点击面转到对应标准视角；拖动画布自由观察时实时联动"
    >
      <div className="viewcube-perspective">
        <div className="viewcube-cube" ref={cubeRef}>
          {FACES.map((f) => (
            <button
              key={f.dir}
              className={`viewcube-face vf-${f.dir}`}
              style={{ transform: f.transform }}
              onClick={() => navigate(f.dir)}
              title={`${f.label}视角`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
