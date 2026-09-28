import { useEffect, useState } from "react";

import { layoutLiveness } from "./livenessLayout";

type LivenessEdgeProps = {
  percent: number | null;
};

export function LivenessEdge({ percent }: LivenessEdgeProps) {
  const [screen, setScreen] = useState(readScreen);

  useEffect(() => {
    function onResize() {
      setScreen(readScreen());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (percent == null || !Number.isFinite(percent)) {
    return null;
  }

  const layout = layoutLiveness(percent, screen.width, screen.height);
  const title = `${Math.round(percent)}%`;
  const active = percent >= 10;

  return (
    <>
      <i
        className={barClass(active, "shell-liveness--top-left")}
        title={title}
        style={{ width: layout.top }}
      />
      <i
        className={barClass(active, "shell-liveness--top-right")}
        title={title}
        style={{ width: layout.top }}
      />
      <i
        className={barClass(active, "shell-liveness--left")}
        title={title}
        style={{ height: layout.side }}
      />
      <i
        className={barClass(active, "shell-liveness--right")}
        title={title}
        style={{ height: layout.side }}
      />
      <i
        className={barClass(active, "shell-liveness--bottom")}
        title={title}
        style={{ width: layout.bottom * 2 }}
      />
    </>
  );
}

function barClass(active: boolean, place: string): string {
  return active
    ? `shell-liveness is-active ${place}`
    : `shell-liveness ${place}`;
}

function readScreen(): { width: number; height: number } {
  return {
    width: Math.max(0, window.innerWidth - 2),
    height: Math.max(0, window.innerHeight - 2),
  };
}
