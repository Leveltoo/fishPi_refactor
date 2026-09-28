import {
  DEFAULT_COUNT,
  DEFAULT_MONEY,
  MAX_COUNT,
  ROCK_PAPER_MIN_MONEY,
} from "./constants";
import type { RedPacketType, SendRedPacketRequest } from "./types";

export type SendFormValues = {
  type: RedPacketType;
  money: string;
  count: string;
  message: string;
  receivers: string[];
  receiverDraft: string;
  gesture: 0 | 1 | 2;
};

export type SendFormErrors = {
  money?: string;
  count?: string;
  receivers?: string;
};

export function createSendFormValues(
  type: RedPacketType = "random",
  receivers: string[] = [],
): SendFormValues {
  return {
    type,
    money: String(DEFAULT_MONEY),
    count: String(DEFAULT_COUNT),
    message: "",
    receivers,
    receiverDraft: "",
    gesture: 0,
  };
}

export function validateSendForm(
  form: SendFormValues,
): { ok: true; request: SendRedPacketRequest } | { ok: false; errors: SendFormErrors } {
  const money = Number.parseInt(form.money.trim(), 10);
  const parsedCount = Number.parseInt(form.count.trim(), 10);
  const receivers = uniqueReceivers(form);
  const errors: SendFormErrors = {};

  if (!Number.isFinite(money) || money <= 0) {
    errors.money = "积分必须大于 0";
  } else if (form.type === "rockPaperScissors" && money < ROCK_PAPER_MIN_MONEY) {
    errors.money = `猜拳红包至少 ${ROCK_PAPER_MIN_MONEY} 积分`;
  }

  if (form.type === "specify" && receivers.length === 0) {
    errors.receivers = "请至少选择一个人收红包";
  }

  if (showsCountField(form.type)) {
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
      errors.count = "个数必须大于 0";
    } else if (parsedCount > MAX_COUNT) {
      errors.count = `个数不能超过 ${MAX_COUNT}`;
    }
  }

  if (errors.money || errors.count || errors.receivers) {
    return { ok: false, errors };
  }

  const count = resolvedCount(form.type, parsedCount, receivers.length);
  return {
    ok: true,
    request: {
      type: form.type,
      money,
      count,
      msg: form.message.trim(),
      recivers: form.type === "specify" ? receivers : [],
      gesture: form.type === "rockPaperScissors" ? form.gesture : undefined,
    },
  };
}

export function showsCountField(type: RedPacketType): boolean {
  return type !== "specify" && type !== "rockPaperScissors";
}

function resolvedCount(
  type: RedPacketType,
  count: number,
  receiverCount: number,
): number {
  if (type === "rockPaperScissors") {
    return 1;
  }
  if (type === "specify") {
    return Math.max(receiverCount, 1);
  }
  return count;
}

function uniqueReceivers(form: SendFormValues): string[] {
  const extra = form.receiverDraft
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const merged = [...form.receivers, ...extra];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of merged) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(name);
  }
  return result;
}
