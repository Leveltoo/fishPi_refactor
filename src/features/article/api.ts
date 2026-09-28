/**
 * 帖子 typed invoke。命令未注册时抛 BridgeGapError，不得当作已加载或已发出。
 *
 * 约定：单 DTO 入参叫 `request`。
 * `comment_post` / `comment_delete` / `comment_thank` / `comment_vote` 是写操作，本模块不做自动重试。
 */

import { invoke } from "@tauri-apps/api/core";

import { AppInvokeError, parseInvokeError } from "../../lib/errors";
import {
  BridgeGapError,
  isMissingCommandError,
} from "./errors";
import type {
  ArticleComment,
  ArticleDetail,
  ArticleDetailRequest,
  ArticleHeatResult,
  ArticleHeatWatchResult,
  ArticleListRequest,
  ArticleListResult,
  ArticleRewardResult,
  ArticleSummary,
  ArticleVoteDirection,
  ArticleVoteResult,
  CommentIdRequest,
  CommentPostRequest,
  CommentPostResult,
  CommentVoteRequest,
  CommentVoteResult,
} from "./types";
import { ARTICLE_COMMAND } from "./types";

const missingCommands = new Set<string>();

export function isCommandMissing(command: string): boolean {
  return missingCommands.has(command);
}

export function invokeArticleList(
  request: ArticleListRequest,
): Promise<ArticleListResult> {
  return invokeMapped(ARTICLE_COMMAND.list, { request }, mapListResult);
}

export function invokeArticleDetail(
  request: ArticleDetailRequest,
): Promise<ArticleDetail> {
  return invokeMapped(ARTICLE_COMMAND.detail, { request }, (payload) =>
    mapDetail(payload, request.page ?? 1),
  );
}

/** 写操作：调用一次，失败即抛，不在此重试。 */
export function invokeCommentPost(
  request: CommentPostRequest,
): Promise<CommentPostResult> {
  return invokeMapped(ARTICLE_COMMAND.comment, { request }, mapAck);
}

export function invokeCommentDelete(
  request: CommentIdRequest,
): Promise<CommentPostResult> {
  return invokeMapped(ARTICLE_COMMAND.commentDelete, { request }, mapAck);
}

export function invokeCommentThank(
  request: CommentIdRequest,
): Promise<CommentPostResult> {
  return invokeMapped(ARTICLE_COMMAND.commentThank, { request }, mapAck);
}

/** 写操作。结果只表示是否确定落成；赞踩状态由调用方按切换语义更新。 */
export function invokeCommentVote(
  request: CommentVoteRequest,
): Promise<CommentVoteResult> {
  return invokeMapped(ARTICLE_COMMAND.commentVote, { request }, mapAck);
}

export function invokeArticleThank(request: {
  id: string;
}): Promise<CommentPostResult> {
  return invokeMapped(ARTICLE_COMMAND.thank, { request }, mapAck);
}

export function invokeArticleVote(request: {
  id: string;
  direction: ArticleVoteDirection;
}): Promise<ArticleVoteResult> {
  return invokeMapped(ARTICLE_COMMAND.vote, { request }, mapVoteResult);
}

export function invokeArticleReward(request: {
  id: string;
}): Promise<ArticleRewardResult> {
  return invokeMapped(ARTICLE_COMMAND.reward, { request }, mapRewardResult);
}

export function invokeArticleHeat(request: {
  id: string;
}): Promise<ArticleHeatResult> {
  return invokeMapped(ARTICLE_COMMAND.heat, { request }, mapHeatResult);
}

export function invokeArticleHeatWatch(request: {
  id: string;
  articleType: number;
}): Promise<ArticleHeatWatchResult> {
  return invokeMapped(ARTICLE_COMMAND.heatWatch, { request }, mapHeatWatchResult);
}

export function invokeArticleHeatClose(request: {
  watchGeneration: number;
}): Promise<void> {
  return invokeCommand(ARTICLE_COMMAND.heatClose, { request });
}

async function invokeMapped<T>(
  command: string,
  args: Record<string, unknown>,
  map: (payload: unknown) => T,
): Promise<T> {
  const payload = await invokeCommand<unknown>(command, args);
  return map(payload);
}

async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (missingCommands.has(command)) {
    throw new BridgeGapError(command);
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isMissingCommandError(error)) {
      missingCommands.add(command);
      throw new BridgeGapError(command);
    }
    throw toInvokeError(error);
  }
}

function toInvokeError(error: unknown): AppInvokeError {
  if (error instanceof AppInvokeError) {
    return error;
  }
  return new AppInvokeError(parseInvokeError(error));
}

function mapListResult(payload: unknown): ArticleListResult {
  const root = unwrapRecord(payload);
  const page =
    asPositiveInt(root?.page) ??
    asPositiveInt(root?.nextPage) ??
    1;
  const items = unwrapList(payload)
    .map(mapSummary)
    .filter((item): item is ArticleSummary => item != null);
  return {
    items,
    page,
    hasMore: readHasMore(root, items.length),
  };
}

function mapSummary(raw: unknown): ArticleSummary | null {
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  const author = nestedAuthor(rec);
  const id = pickId(rec);
  if (!id) {
    return null;
  }
  const userName =
    pickString(rec, [
      "authorUserName",
      "articleAuthorName",
      "authorName",
      "author",
    ]) ||
    pickString(author, ["userName", "user_name"]) ||
    "";
  return {
    id,
    title: displayTitle(rec),
    authorUserName: userName,
    authorNickname:
      pickString(author, ["nickname", "userNickname"]) || userName,
    avatarUrl:
      pickString(rec, [
        "avatar",
        "avatarUrl",
        "thumbnailUrl48",
        "articleAuthorThumbnailURL48",
      ]) || pickString(author, ["avatarUrl", "userAvatarUrl", "userAvatarURL"]),
    time:
      pickString(rec, [
        "time",
        "timeAgo",
        "articleTimeAgo",
        "createTimeStr",
        "articleCreateTimeStr",
      ]) || "",
    tags: pickString(rec, ["tags", "articleTags"]),
    preview: toMarkdownSource(
      pickString(rec, [
        "preview",
        "previewContent",
        "articlePreviewContent",
        "articlePreview",
      ]),
    ),
    commentCount: pickNumber(rec, [
      "commentCount",
      "articleCommentCount",
    ]),
    viewCount: pickNumber(rec, ["viewCount", "articleViewCount"]),
    thumbnailUrl: pickString(rec, [
      "thumbnail",
      "thumbnailUrl",
      "img1Url",
      "articleImg1URL",
    ]),
    sticky:
      pickBoolean(rec, ["sticky"]) ||
      pickNumber(rec, ["stick", "articleStick"]) > 0,
    perfect: pickBoolean(rec, ["perfect", "articlePerfect"]),
  };
}

function mapDetail(payload: unknown, requestedPage: number): ArticleDetail {
  const root = unwrapRecord(payload);
  const article =
    asRecord(root?.article) ??
    asRecord(asRecord(root?.data)?.article) ??
    root ??
    {};
  const summary = mapSummary(article);
  const id = summary?.id ?? pickId(article);
  const comments = unwrapComments(root, article)
    .map(mapComment)
    .filter((item): item is ArticleComment => item != null);
  const page =
    asPositiveInt(root?.commentPage) ??
    asPositiveInt(root?.page) ??
    requestedPage;
  const markdown = pickMarkdown(article);
  const rewarded = pickBoolean(article, ["rewarded"]);
  return {
    id: id || "",
    title: summary?.title || displayTitle(article) || "无标题",
    authorUserName: summary?.authorUserName ?? "",
    authorNickname: summary?.authorNickname ?? "",
    avatarUrl: summary?.avatarUrl ?? "",
    time: summary?.time ?? "",
    tags: summary?.tags ?? "",
    markdown,
    commentCount: pickNumber(article, [
      "commentCount",
      "articleCommentCount",
    ]),
    commentable: pickBoolean(article, ["commentable", "articleCommentable"], true),
    comments,
    commentPage: page,
    commentHasMore: readCommentHasMore(root, article, page, comments.length),
    thanked: pickBoolean(article, ["thanked"]),
    thankCount: pickNumber(article, ["thankCount", "articleThankCnt"]),
    goodCount: pickNumber(article, ["goodCount", "articleGoodCnt"]),
    badCount: pickNumber(article, ["badCount", "articleBadCnt"]),
    vote: readVote(article),
    rewarded,
    rewardPoint: pickNumber(article, ["rewardPoint", "articleRewardPoint"]),
    rewardedCount: pickNumber(article, ["rewardedCount", "rewardedCnt"]),
    rewardContent: rewarded
      ? toMarkdownSource(pickString(article, ["rewardContent", "articleRewardContent"]))
      : "",
    articleType: Math.max(0, Math.trunc(pickNumber(article, ["articleType"]))),
  };
}

function mapComment(raw: unknown): ArticleComment | null {
  const rec = asRecord(raw);
  if (!rec) {
    return null;
  }
  const commenter = nestedAuthor(rec) || asRecord(rec.commenter);
  const id = pickId(rec);
  if (!id) {
    return null;
  }
  const userName =
    pickString(rec, ["userName", "commentAuthorName", "author"]) ||
    pickString(commenter, ["userName", "user_name"]);
  const displayName =
    pickString(rec, ["displayName", "authorNickname"]) ||
    pickString(commenter, ["nickname", "userNickname"]) ||
    userName;
  return {
    id,
    userName,
    displayName,
    avatarUrl:
      pickString(rec, [
        "avatar",
        "avatarUrl",
        "thumbnailUrl",
        "commentAuthorThumbnailURL",
      ]) || pickString(commenter, ["avatarUrl", "userAvatarUrl"]),
    time:
      pickString(rec, [
        "time",
        "timeAgo",
        "commentTimeAgo",
        "createTimeStr",
        "commentCreateTimeStr",
      ]) || "",
    markdown: toMarkdownSource(
      pickString(rec, [
        "markdown",
        "md",
        "content",
        "commentContent",
      ]),
    ),
    thankCount: pickNumber(rec, ["thankCount", "commentThankCnt", "thankCnt"]),
    thanked: pickBoolean(rec, ["rewarded", "thanked"]),
    goodCount: pickNumber(rec, ["goodCount", "commentGoodCnt"]),
    badCount: pickNumber(rec, ["badCount", "commentBadCnt"]),
    vote: readVote(rec),
  };
}

function mapAck(payload: unknown): CommentPostResult {
  if (payload == null || typeof payload !== "object") {
    return { accepted: true, outcomeUnknown: false };
  }
  const record = payload as Record<string, unknown>;
  return {
    accepted: record.accepted !== false,
    outcomeUnknown: record.outcomeUnknown === true,
  };
}

function mapVoteResult(payload: unknown): ArticleVoteResult {
  const ack = mapAck(payload);
  const active =
    ack.accepted && !ack.outcomeUnknown && pickBoolean(asRecord(payload), ["active"]);
  return { ...ack, active };
}

function mapRewardResult(payload: unknown): ArticleRewardResult {
  const ack = mapAck(payload);
  const record = asRecord(payload);
  const rewarded =
    ack.accepted && !ack.outcomeUnknown && pickBoolean(record, ["rewarded"]);
  return {
    ...ack,
    rewarded,
    rewardContent: rewarded
      ? toMarkdownSource(pickString(record, ["rewardContent"]))
      : "",
    rewardedCount: rewarded ? pickNumber(record, ["rewardedCount"]) : 0,
  };
}

function mapHeatResult(payload: unknown): ArticleHeatResult {
  const record = asRecord(payload);
  const count = record?.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new Error("在看人数无效");
  }
  return { count: Math.trunc(count) };
}

function mapHeatWatchResult(payload: unknown): ArticleHeatWatchResult {
  const generation = asRecord(payload)?.watchGeneration;
  if (
    typeof generation !== "number" ||
    !Number.isInteger(generation) ||
    generation <= 0
  ) {
    throw new Error("在看监听没有返回代次");
  }
  return { watchGeneration: generation };
}

function readVote(article: Record<string, unknown>): "up" | "down" | "none" {
  const vote = pickString(article, ["vote", "articleVote", "commentVote"]);
  if (vote === "up" || vote === "0") {
    return "up";
  }
  if (vote === "down" || vote === "1") {
    return "down";
  }
  return "none";
}

function pickMarkdown(article: Record<string, unknown>): string {
  const source = pickString(article, [
    "markdown",
    "source",
    "articleOriginalContent",
    "md",
  ]);
  if (source) {
    return toMarkdownSource(source);
  }
  return toMarkdownSource(
    pickString(article, ["content", "articleContent", "html"]),
  );
}

/**
 * 服务端评论/正文常是 HTML。转成 markdown 再走 react-markdown，
 * 不要把原始 HTML 交给 dangerouslySetInnerHTML。
 */
export function toMarkdownSource(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text;
  }
  return text
    .replace(
      /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
      "\n\n![]($1)\n\n",
    )
    .replace(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, inner: string) => {
        const label = inner.replace(/<[^>]+>/g, "").trim() || href;
        return `[${label}](${href})`;
      },
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unwrapComments(
  root: Record<string, unknown> | undefined,
  article: Record<string, unknown>,
): unknown[] {
  const fromRoot = root?.comments;
  if (Array.isArray(fromRoot)) {
    return fromRoot;
  }
  const fromArticle = article.comments;
  if (Array.isArray(fromArticle)) {
    return fromArticle;
  }
  const data = asRecord(root?.data);
  if (Array.isArray(data?.comments)) {
    return data.comments;
  }
  return [];
}

function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const rec = asRecord(payload);
  if (!rec) {
    return [];
  }
  const nested =
    rec.items ??
    rec.list ??
    rec.articles ??
    rec.data;
  if (Array.isArray(nested)) {
    return nested;
  }
  const data = asRecord(nested);
  if (!data) {
    return [];
  }
  const inner = data.items ?? data.list ?? data.articles;
  return Array.isArray(inner) ? inner : [];
}

function unwrapRecord(
  payload: unknown,
): Record<string, unknown> | undefined {
  const rec = asRecord(payload);
  if (!rec) {
    return undefined;
  }
  const data = asRecord(rec.data);
  if (data && (data.article || data.items || data.list || data.articles)) {
    return { ...rec, ...data };
  }
  return rec;
}

function nestedAuthor(
  rec: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    asRecord(rec.author) ??
    asRecord(rec.articleAuthor) ??
    asRecord(rec.commenter)
  );
}

function displayTitle(rec: Record<string, unknown>): string {
  return (
    pickString(rec, [
      "title",
      "articleTitle",
      "titleEmojiUnicode",
      "articleTitleEmojUnicode",
      "titleEmoji",
      "articleTitleEmoj",
    ]) || "无标题"
  );
}

function pickId(rec: Record<string, unknown>): string {
  return pickString(rec, ["id", "oId", "oid", "articleId", "o_id"]);
}

function readHasMore(
  root: Record<string, unknown> | undefined,
  itemCount: number,
): boolean {
  if (!root) {
    return itemCount > 0;
  }
  if (typeof root.hasMore === "boolean") {
    return root.hasMore;
  }
  const pagination = asRecord(root.pagination);
  const totalPages =
    asPositiveInt(root.pageCount) ??
    asPositiveInt(pagination?.count) ??
    asPositiveInt(pagination?.pageCount);
  const page =
    asPositiveInt(root.page) ??
    (asPositiveInt(root.nextPage) != null
      ? (root.nextPage as number) - 1
      : undefined);
  if (totalPages != null && page != null) {
    return page < totalPages;
  }
  return false;
}

function readCommentHasMore(
  root: Record<string, unknown> | undefined,
  article: Record<string, unknown>,
  page: number,
  loaded: number,
): boolean {
  if (typeof root?.commentHasMore === "boolean") {
    return root.commentHasMore;
  }
  if (typeof article.commentHasMore === "boolean") {
    return article.commentHasMore;
  }
  const pagination =
    asRecord(root?.pagination) ?? asRecord(article.pagination);
  const totalPages = asPositiveInt(pagination?.count);
  if (totalPages != null) {
    return page < totalPages;
  }
  const total = pickNumber(article, ["commentCount", "articleCommentCount"]);
  return total > loaded;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function pickString(
  rec: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!rec) {
    return "";
  }
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function pickNumber(
  rec: Record<string, unknown> | undefined,
  keys: string[],
): number {
  if (!rec) {
    return 0;
  }
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

function pickBoolean(
  rec: Record<string, unknown> | undefined,
  keys: string[],
  fallback = false,
): boolean {
  if (!rec) {
    return fallback;
  }
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (value === 1 || value === "1" || value === "true") {
      return true;
    }
    if (value === 0 || value === "0" || value === "false") {
      return false;
    }
  }
  return fallback;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

