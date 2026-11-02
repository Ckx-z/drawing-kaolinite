/**
 * 模型素材收藏（UI 重构 2026-10-22）
 *
 * 作用域 = 「模型」面板的参数化素材卡（ASSET_INDEX 24 条，key = 资产 id）。
 * 持久化：localStorage（与项目既有轻量键值用法一致——prebake 标志同款）；
 * 模块库（Dexie）条目沿用自身 favorite 字段（toggleFavorite），两套收藏概念
 * 分离不混淆（任务书：不将场景/账号与模型收藏混淆）。
 * 模型列表与收藏列表读写同一 store → 状态天然同步。
 */
import { createStore } from 'zustand/vanilla';

const KEY = 'kaolin_model_favs_v1';

interface FavState {
  favs: Record<string, true>;
  toggle: (key: string) => void;
}

function load(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, true>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persist(favs: Record<string, true>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(favs));
  } catch {
    /* 隐私模式/配额满：收藏降级为会话内态 */
  }
}

export const modelFavorites = createStore<FavState>()((set, get) => ({
  favs: load(),
  toggle: (key) => {
    const next = { ...get().favs };
    if (next[key]) delete next[key];
    else next[key] = true;
    persist(next);
    set({ favs: next });
  },
}));

export function isFavorite(key: string): boolean {
  return Boolean(modelFavorites.getState().favs[key]);
}

/** 测试辅助：清空收藏（含持久化） */
export function resetModelFavorites(): void {
  persist({});
  modelFavorites.setState({ favs: {} });
}
