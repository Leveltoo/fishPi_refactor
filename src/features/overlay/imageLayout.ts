export type ImageLayout = {
  width: number;
  height: number;
  x: number;
  y: number;
};

export function fitImageLayout(
  naturalWidth: number,
  naturalHeight: number,
  stageWidth: number,
  stageHeight: number,
): ImageLayout {
  if (![naturalWidth, naturalHeight, stageWidth, stageHeight]
    .every((value) => Number.isFinite(value) && value > 0)) {
    return { width: 0, height: 0, x: 0, y: 0 };
  }
  const scale = Math.min(stageWidth / naturalWidth, stageHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { width, height, x: (stageWidth - width) / 2, y: (stageHeight - height) / 2 };
}

export function zoomImageLayout(
  current: ImageLayout,
  delta: number,
  cx: number,
  cy: number,
): ImageLayout {
  if (current.width <= 0 || current.height <= 0 || !Number.isFinite(delta)) {
    return current;
  }
  const width = Math.min(32768, Math.max(20, current.width - delta));
  const scale = width / current.width;
  return {
    width,
    height: current.height * scale,
    x: cx - (cx - current.x) * scale,
    y: cy - (cy - current.y) * scale,
  };
}
