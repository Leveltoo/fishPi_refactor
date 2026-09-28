import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { FishMark } from "./FishMark";
import "./status-views.css";

export function RestoringView() {
  return (
    <div className="brand-stage" role="status" aria-live="polite">
      <aside className="brand-rail" aria-hidden="true">
        <FishMark className="brand-rail__mark" />
        <span className="brand-rail__title">摸鱼派</span>
        <span className="brand-rail__caption">桌面端</span>
      </aside>
      <section className="brand-stage__body">
        <p className="brand-stage__kicker">会话恢复</p>
        <h1 className="brand-stage__heading">正在恢复登录</h1>
        <div className="brand-stage__progress">
          <Spinner className="brand-stage__spinner" />
        </div>
        <Alert className="brand-stage__alert" role="status">
          <AlertDescription>
            正在核对本机凭据。这不是登录失败，请稍候。
          </AlertDescription>
        </Alert>
      </section>
    </div>
  );
}
