import { WarningIcon } from "@phosphor-icons/react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { Composer } from "./components/Composer";
import { Timeline } from "./components/Timeline";
import { useBreezemoon } from "./useBreezemoon";
import "./breezemoon.css";

type BreezemoonHostProps = {
  userName?: string;
};

/**
 * 清风明月宿主：顶部输入 + 时间线。无必填 props。
 * 发送成功只表示已接受，不本地 echo；命令缺失时不会伪装成功。
 */
export function BreezemoonHost({ userName }: BreezemoonHostProps) {
  const moon = useBreezemoon({ userName });
  const bridgeMissing = !moon.loading && !moon.capabilities.list;
  const sendDisabled = !moon.capabilities.send || moon.sending || moon.pendingConfirm;

  return (
    <div className="bm" id="breezemoons">
      <header className="bm-head">
        <h1 className="bm-title">清风明月</h1>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={moon.loading}
          onClick={() => {
            void moon.refresh();
          }}
        >
          刷新
        </Button>
      </header>
      {bridgeMissing ? (
        <Alert className="bm-banner">
          <WarningIcon />
          <AlertTitle>清风明月 Bridge 尚未接入</AlertTitle>
          <AlertDescription>
            清风明月列表暂不可用。
          </AlertDescription>
        </Alert>
      ) : moon.error ? (
        <Alert variant="destructive" className="bm-banner">
          <WarningIcon />
          <AlertTitle>清风明月请求失败</AlertTitle>
          <AlertDescription>{moon.error}</AlertDescription>
        </Alert>
      ) : null}

      <Composer
        disabled={sendDisabled}
        sending={moon.sending}
        pendingConfirm={moon.pendingConfirm}
        sendAvailable={moon.capabilities.send}
        onSend={moon.send}
      />
      <Timeline
        items={moon.items}
        loading={moon.loading}
        loadingMore={moon.loadingMore}
        hasMore={moon.hasMore}
        scrollReset={moon.scrollReset}
        onLoadMore={moon.loadMore}
      />
    </div>
  );
}
