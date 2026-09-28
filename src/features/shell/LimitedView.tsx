import { openUrl } from "@tauri-apps/plugin-opener";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FishMark } from "./FishMark";
import type { LimitedReason } from "./restore-outcome";
import "./status-views.css";

const SITE_URL = "https://fishpi.cn";

type LimitedViewProps = {
  reason: LimitedReason;
  message: string;
  retrying: boolean;
  onRetry: () => void;
};

export function LimitedView({
  reason,
  message,
  retrying,
  onRetry,
}: LimitedViewProps) {
  const title =
    reason === "verification" ? "需要完成访问验证" : "网络受限";

  async function openSite() {
    try {
      await openUrl(SITE_URL);
    } catch {
      /* 打开失败时仍可点重试，不打断当前受限会话 */
    }
  }

  return (
    <div className="brand-stage">
      <aside className="brand-rail" aria-hidden="true">
        <FishMark className="brand-rail__mark" />
        <span className="brand-rail__title">摸鱼派</span>
        <span className="brand-rail__caption">桌面端</span>
      </aside>
      <section className="brand-stage__body">
        <p className="brand-stage__kicker">会话仍保留</p>
        <h1 className="brand-stage__heading">{title}</h1>
        {retrying ? (
          <div className="brand-stage__progress">
            <Spinner className="brand-stage__spinner" />
          </div>
        ) : null}
        <Alert
          className={
            reason === "verification"
              ? "brand-stage__alert"
              : "brand-stage__alert brand-stage__alert--warn"
          }
        >
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <div className="brand-stage__actions">
          <Button
            type="button"
            className="primary-btn"
            disabled={retrying}
            aria-busy={retrying}
            onClick={onRetry}
          >
            {retrying ? <Spinner /> : null}
            {retrying ? "重试中…" : "重试"}
          </Button>
          {reason === "verification" ? (
            <Button
              type="button"
              variant="outline"
              className="ghost-btn"
              disabled={retrying}
              onClick={() => void openSite()}
            >
              在浏览器打开摸鱼派
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
