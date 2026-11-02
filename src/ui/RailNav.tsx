/**
 * 左侧窄竖向导航栏（UI 重构 2026-10-22，参考截图一）
 *
 * 两主要入口：模型（默认）/ 收藏；另保留「模板」入口——场景模板不是模型素材，
 * 按任务书"保留原有模板功能"单独成区（模块/组合/完整模板统一面板原样复用）。
 * 图标上、文字下，选中 = 蓝青高亮 + 左侧细竖条指示器。
 */
import { IconModel, IconStar, IconTemplate } from './icons';

export type RailEntry = 'model' | 'fav' | 'tpl';

const ENTRIES: Array<{ key: RailEntry; label: string; icon: (size: number) => React.ReactElement; title: string }> = [
  { key: 'model', label: '模型', icon: (s) => <IconModel size={s} />, title: '模型素材库（点击或拖入画布）' },
  { key: 'fav', label: '收藏', icon: (s) => <IconStar size={s} />, title: '我收藏的模型素材' },
  { key: 'tpl', label: '模板', icon: (s) => <IconTemplate size={s} />, title: '模块与完整场景模板（作为独立场景打开）' },
];

export default function RailNav(props: { active: RailEntry; onChange: (e: RailEntry) => void }): React.ReactElement {
  return (
    <nav className="rail3" aria-label="素材导航">
      {ENTRIES.map((e) => (
        <button
          key={e.key}
          className={`rail3-btn${props.active === e.key ? ' on' : ''}`}
          onClick={() => props.onChange(e.key)}
          title={e.title}
        >
          {e.icon(20)}
          <span>{e.label}</span>
        </button>
      ))}
    </nav>
  );
}
