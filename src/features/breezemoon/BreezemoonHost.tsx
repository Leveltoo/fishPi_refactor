import { useEffect } from "react";
import { toast } from "sonner";

import { Composer } from "./components/Composer";
import { Timeline } from "./components/Timeline";
import { useBreezemoon } from "./useBreezemoon";
import "./breezemoon.css";

type BreezemoonHostProps = {
  userName?: string;
};

export function BreezemoonHost({ userName }: BreezemoonHostProps) {
  const moon = useBreezemoon({ userName });
  const sendDisabled =
    !moon.capabilities.send || moon.sending || moon.pendingConfirm;

  useEffect(() => {
    if (moon.error) toast.error(moon.error);
  }, [moon.error]);

  useEffect(() => {
    if (!moon.loading && !moon.capabilities.list) {
      toast.error("清风明月加载失败");
    }
  }, [moon.capabilities.list, moon.loading]);

  return (
    <div className="bm layout" id="breezemoons">
      <Composer
        disabled={sendDisabled}
        sending={moon.sending}
        pendingConfirm={moon.pendingConfirm}
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
