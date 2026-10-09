export async function revokeRepeatChain(
  primaryId: string,
  repeatedIds: readonly string[],
  revoke: (id: string) => Promise<boolean>,
): Promise<boolean> {
  const ids = [...new Set([...repeatedIds, primaryId])].filter((id) => /^\d+$/.test(id));
  for (const id of ids) {
    if (!await revoke(id)) return false;
  }
  return true;
}
