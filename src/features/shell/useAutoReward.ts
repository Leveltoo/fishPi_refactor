import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { invokeUserRewardLiveness } from "@/features/activity/api";
import {
  currentDesktopSettings,
  subscribeDesktopSettings,
} from "@/features/settings/settingsStore";

/** 登录成功且开关打开时领取一次。失败、已领过、积分为 0 都不算领取成功。 */
export function useAutoReward(): void {
  const decided = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return subscribeDesktopSettings(() => {
      setTick((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (decided.current) {
      return;
    }
    const snapshot = currentDesktopSettings();
    if (!snapshot?.ready) {
      return;
    }
    decided.current = true;
    if (!snapshot.settings.autoReward) {
      return;
    }
    void claimOnce();
  }, [tick]);
}

async function claimOnce(): Promise<void> {
  const outcome = await invokeUserRewardLiveness();
  if (outcome.status === "ok" && (outcome.sum ?? 0) > 0) {
    toast.success(outcome.message);
    return;
  }
  if (outcome.status === "ok") {
    return;
  }
  if (outcome.status === "outcome_unknown") {
    toast.warning(outcome.message);
    return;
  }
  toast.error(outcome.message);
}
