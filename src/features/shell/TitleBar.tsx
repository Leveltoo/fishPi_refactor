import type { ReactNode } from "react";
import { FishMark } from "./FishMark";
import { WindowControls } from "./WindowControls";
import "./AppShell.css";

type TitleBarProps = {
  /** 左侧标题；登录等页可只显示品牌名 */
  title?: string;
  /** 中间内容；登录页不传即无装饰插件 */
  children?: ReactNode;
  /** 对齐旧版 simple：只留最小化/关闭（登录等页） */
  compact?: boolean;
};

/**
 * 精简窗口顶栏：品牌/标题 + 可选中间 + 窗控。
 * `decorations: false` 时登录/恢复页也需要可拖拽标题栏。
 */
export function TitleBar({ title, children, compact = false }: TitleBarProps) {
  return (
    <header className="shell__header">
      <div className="shell__header-title">
        <FishMark />
        {title ? (
          <span className="shell__header-title-text">{title}</span>
        ) : null}
      </div>
      {children != null ? <div className="shell__header-mid">{children}</div> : null}
      <WindowControls compact={compact} />
    </header>
  );
}
