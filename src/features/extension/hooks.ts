// Legacy JS hooks require an isolated runtime and a capability contract.
// Until those exist, preserve the shared callers' no-plugin behavior.

export type FishpiHooks = {
  sendMsgEvent: (msg: string) => Promise<string | null>;
  chatroomEvent: (msg: unknown) => Promise<unknown>;
};

/** Compatibility export only; supplied scripts are never read or evaluated. */
export function installExtensionHooks(_scripts: unknown): void {}

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
