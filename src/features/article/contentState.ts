import type { ArticleVoteDirection } from "./types";

type VoteCounts = {
  vote: "up" | "down" | "none";
  goodCount: number;
  badCount: number;
};

export function applyVote<T extends VoteCounts>(
  item: T,
  direction: ArticleVoteDirection,
  active = item.vote !== direction,
): T {
  const vote = active ? direction : "none";
  return {
    ...item,
    goodCount: Math.max(0, item.goodCount + Number(vote === "up") - Number(item.vote === "up")),
    badCount: Math.max(0, item.badCount + Number(vote === "down") - Number(item.vote === "down")),
    vote,
  };
}

export function mergeById<T extends { id: string }>(first: T[], second: T[]): T[] {
  const seen = new Set(first.map((item) => item.id));
  const extra = second.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
  return extra.length ? [...first, ...extra] : first;
}

export function acceptsChannel(
  event: { articleId: string; sessionGeneration: number; watchGeneration: number },
  articleId: string,
  sessionGeneration: number,
  watchGeneration: number,
): boolean {
  return event.articleId === articleId && sessionGeneration > 0 &&
    event.sessionGeneration === sessionGeneration && watchGeneration > 0 &&
    event.watchGeneration === watchGeneration;
}
