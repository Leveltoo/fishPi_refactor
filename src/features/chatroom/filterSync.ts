/** Imported configuration invalidates both pending debounce and late save/read results. */
export function createFilterSaveGuard() {
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function invalidate(): void {
    clearTimeout(timer);
    timer = undefined;
    revision += 1;
  }
  return {
    invalidate,
    token: (): number => revision,
    isCurrent: (token: number): boolean => token === revision,
    schedule(run: (token: number) => void): void {
      invalidate();
      const token = revision;
      timer = setTimeout(() => {
        timer = undefined;
        if (token === revision) run(token);
      }, 400);
    },
  };
}
