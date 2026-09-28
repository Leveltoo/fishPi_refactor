/**
 * 会话 / 连接代次校验。
 *
 * 退出、换号或重连后，迟到的消息、历史结果和连接成功回调都不得复活旧会话。
 * 连接尚未返回时 currentGen 可能为 0：此时不要用本函数直接丢掉首包，
 * 应按事件自带的 generation 暂存，等 connect 返回后再过滤合入。
 */

export type Generation = number;

/** 代次必须精确匹配，且当前代次已经成立（大于 0）。 */
export function shouldAccept(eventGen: number, currentGen: number): boolean {
  return currentGen > 0 && eventGen === currentGen;
}

/**
 * 当前代次已成立，但事件代次对不上 → 丢弃。
 * currentGen 为 0 时不算过期，留给调用方缓冲。
 */
export function isStaleGeneration(eventGen: number, currentGen: number): boolean {
  return currentGen > 0 && eventGen !== currentGen;
}

export interface GenerationFields {
  sessionGeneration: number;
  connectionGeneration?: number;
}

/**
 * 实时事件需要同时匹配会话代次和连接代次。
 * 历史结果的 connectionGeneration 可能缺省，此时只校验会话代次。
 */
export function shouldAcceptEvent(
  event: GenerationFields,
  sessionGeneration: number,
  connectionGeneration?: number,
): boolean {
  if (!shouldAccept(event.sessionGeneration, sessionGeneration)) {
    return false;
  }
  if (
    connectionGeneration === undefined ||
    event.connectionGeneration === undefined
  ) {
    return true;
  }
  return shouldAccept(event.connectionGeneration, connectionGeneration);
}
