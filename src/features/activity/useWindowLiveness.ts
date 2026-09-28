import { useEffect, useState } from "react";

import {
  invokeUserLiveness,
} from "@/features/activity/api";
import { LIVENESS_POLL_MS } from "@/features/activity/constants";
import { isBridgeGapError } from "@/features/activity/errors";

/** 窗口边缘用的活跃度。命令失败或没有数值时保持 null，不造百分比。 */
export function useWindowLiveness(): number | null {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let stopped = false;

    async function load(): Promise<void> {
      try {
        const value = await invokeUserLiveness();
        if (!cancelled && Number.isFinite(value)) {
          setPercent(value);
        }
      } catch (error) {
        if (isBridgeGapError(error)) {
          stopped = true;
          if (!cancelled) {
            setPercent(null);
          }
        }
      }
    }

    void load();
    timer = window.setInterval(() => {
      if (!stopped) {
        void load();
      }
    }, LIVENESS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return percent;
}
