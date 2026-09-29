/**
 * 扩展 hooks 占位。本轮明确不执行插件 JS（含 activate / sendMsg / chatroom）。
 * CSS 主题仍由 extension_load_theme 注入；脚本只扫描列出，不求值。
 */

export type FishpiHooks = {
  sendMsgEvent: (msg: string) => Promise<string | null>;
  chatroomEvent: (msg: unknown) => Promise<unknown>;
};

declare global {
  interface Window {
    __fishpiHooks?: FishpiHooks;
  }
}

/** 扫描结果到达时调用。故意忽略脚本，不 new Function、不 activate。 */
export function installExtensionHooks(_scripts: unknown): void {
  window.__fishpiHooks = {
    sendMsgEvent: runSendMsgHooks,
    chatroomEvent: runChatroomHooks,
  };
}

export function hasSendMsgHooks(): boolean {
  return false;
}

export function hasChatroomHooks(): boolean {
  return false;
}

export async function runSendMsgHooks(msg: string): Promise<string | null> {
  return msg;
}

export function runChatroomHooks<T>(msg: T): Promise<T | null> {
  return Promise.resolve(msg);
}
