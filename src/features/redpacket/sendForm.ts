import {
  DEFAULT_COUNT,
  DEFAULT_MONEY,
  MAX_COUNT,
  MAX_MONEY,
  DEFAULT_BLESSING,
  isRedPacketType,
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
  gesture?: string;
  type?: string;
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
  const money = parseInteger(form.money);
  const parsedCount = parseInteger(form.count);
  const receivers = uniqueReceivers(form);
  const errors: SendFormErrors = {};

  if (!isRedPacketType(form.type)) {
    errors.type = "红包类型无效";
  }
  if (!Number.isSafeInteger(money) || money <= 0 || money > MAX_MONEY) {
    errors.money = `积分必须是 1 至 ${MAX_MONEY} 的整数`;
  }

  if (form.type === "specify" && receivers.length === 0) {
    errors.receivers = "请至少选择一个人收红包";
  } else if (form.type === "specify" && receivers.length > MAX_COUNT) {
    errors.receivers = `收件人不能超过 ${MAX_COUNT} 人`;
  }
  if (form.type === "rockPaperScissors" && ![0, 1, 2].includes(form.gesture)) {
    errors.gesture = "猜拳手势无效";
  }

  if (showsCountField(form.type)) {
    if (!Number.isSafeInteger(parsedCount) || parsedCount <= 0) {
      errors.count = "个数必须是大于 0 的整数";
    } else if (parsedCount > MAX_COUNT) {
      errors.count = `个数不能超过 ${MAX_COUNT}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const count = resolvedCount(form.type, parsedCount, receivers.length);
  return {
    ok: true,
    request: {
      type: form.type,
      money,
      count,
      msg: form.message.trim() || DEFAULT_BLESSING[form.type],
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
    return receiverCount;
  }
  return count;
}

function uniqueReceivers(form: SendFormValues): string[] {
  const extra = form.receiverDraft
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return [...new Set([...form.receivers, ...extra].map((name) => name.trim()).filter(Boolean))];
}

function parseInteger(value: string): number {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
}
