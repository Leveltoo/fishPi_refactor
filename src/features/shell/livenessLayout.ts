export type LivenessLayout = {
  top: number;
  side: number;
  bottom: number;
};

/** 沿窗口边缘走一圈：先底边，再左右，再顶边。没有百分比时不要调用。 */
export function layoutLiveness(
  percent: number,
  width: number,
  height: number,
): LivenessLayout {
  const safe = Math.min(100, Math.max(0, percent));
  const len = (safe / 100) * (Math.max(0, width) + Math.max(0, height));
  const bottom = Math.min(len, Math.max(0, width) / 2);
  const side = Math.min(Math.max(0, len - bottom), Math.max(0, height));
  const top = Math.max(0, len - bottom - side);
  return { top, side, bottom };
}
