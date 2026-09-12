/**
 * 全局错误边界（2026-09-12 黑屏事故复盘）：
 * 渲染期异常（如曾经的 ParamPanel 条件 Hook 违规）会让 React 卸载整棵树，
 * 用户看到的是整窗黑屏且无任何提示。包一层边界后改为显示错误面板 + 重载按钮，
 * 并把错误写入崩溃面包屑（/tmp/kaolin-trace.log）便于排查。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { trace } from '../crashTrace';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    trace(`ERROR-BOUNDARY ${error.message} ${info.componentStack?.split('\n').slice(0, 4).join(' | ') ?? ''}`);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: '#1a1d21',
            color: '#e8e9eb',
            fontFamily: 'system-ui, sans-serif',
            padding: 32,
            textAlign: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>界面渲染出错</h2>
          <p style={{ margin: 0, opacity: 0.75, maxWidth: 560, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}
          >
            重新加载
          </button>
          <p style={{ margin: 0, opacity: 0.5, fontSize: 12 }}>
            已记录到 /tmp/kaolin-trace.log，可 Ctrl+Z 前先保存场景
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
