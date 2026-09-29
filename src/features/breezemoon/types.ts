/**
 * 清风明月前后端契约（camelCase，对齐 SDK domain / Bridge DTO）。
 *
 * `breezemoon_list` / `breezemoon_send` 可能尚未注册。命令缺失时不得伪装发送成功。
 * SDK 没有编辑 / 删除接口，界面禁用，不得假装成功。
 * 列表字段对照 `fishpi-rust-sdk` `domain::breezemoon::Breezemoon`。
 */

import type { SendResult } from "../../lib/types";

export type { SendResult };

export const BREEZEMOON_COMMAND = {
  list: "breezemoon_list",
  send: "breezemoon_send",
} as const;

export const PAGE_SIZE = 20;

export const BREEZEMOON_COMMAND_LABEL: Record<string, string> = {
  breezemoon_list: "清风明月列表",
  breezemoon_send: "发送清风明月",
};

export interface BreezemoonDto {
  id: string;
  authorName: string;
  authorAvatarUrl: string;
  content: string;
  city: string;
  timeAgo: string;
  created: string;
}

export interface BreezemoonListQuery {
  page: number;
  size: number;
  userName?: string;
}

export interface BreezemoonListResult {
  sessionGeneration: number;
  items: BreezemoonDto[];
  exhausted: boolean;
}

export interface BreezemoonSendRequest {
  content: string;
}
