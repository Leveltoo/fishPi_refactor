/** Coalesce snapshot reads while the same session is already synchronizing. */
export function createRefreshQueue() {
  let pending: number | undefined;
  return {
    request(sessionGeneration: number): void {
      pending = sessionGeneration;
    },
    take(sessionGeneration: number | undefined, ready: boolean): boolean {
      if (pending == null) return false;
      if (pending !== sessionGeneration) {
        pending = undefined;
        return false;
      }
      if (!ready) return false;
      pending = undefined;
      return true;
    },
  };
}
