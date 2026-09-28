import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_BLESSING, REDPACKET_TYPES, isRedPacketType } from "./constants";
import { GesturePicker, SenderFace } from "./parts";
import {
  createSendFormValues,
  showsCountField,
  validateSendForm,
  type SendFormErrors,
  type SendFormValues,
} from "./sendForm";
import type { RedPacketType, SendSession } from "./types";

type SendRedPacketDialogProps = {
  session: SendSession;
  submitting: boolean;
  notice: string | null;
  onSubmit: (form: SendFormValues) => void;
  onClose: () => void;
};

export function SendRedPacketDialog({
  session,
  submitting,
  notice,
  onSubmit,
  onClose,
}: SendRedPacketDialogProps) {
  const typeLocked = Boolean(session.lockedUser || session.lockedType === "specify");
  const [form, setForm] = useState<SendFormValues>(() =>
    createSendFormValues(
      session.lockedType ?? "random",
      session.initialReceivers,
    ),
  );
  const [errors, setErrors] = useState<SendFormErrors>({});

  const type = form.type;
  const showCount = showsCountField(type);
  const showReceivers = type === "specify";
  const showGestures = type === "rockPaperScissors";

  const selectedSet = useMemo(
    () => new Set(form.receivers.map((name) => name.toLowerCase())),
    [form.receivers],
  );

  function update<K extends keyof SendFormValues>(key: K, value: SendFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeType(next: RedPacketType) {
    if (typeLocked) {
      return;
    }
    setForm((current) => ({
      ...current,
      type: next,
      receivers: next === "specify" ? current.receivers : [],
    }));
    setErrors({});
  }

  function toggleReceiver(userName: string) {
    setForm((current) => {
      const exists = current.receivers.some(
        (name) => name.toLowerCase() === userName.toLowerCase(),
      );
      return {
        ...current,
        receivers: exists
          ? current.receivers.filter(
              (name) => name.toLowerCase() !== userName.toLowerCase(),
            )
          : [...current.receivers, userName],
      };
    });
  }

  function handleSubmit() {
    const result = validateSendForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit({
      ...form,
      message: form.message.trim() || DEFAULT_BLESSING[form.type],
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="rp-dialog rp-dialog-send p-0 sm:max-w-[22rem]" showCloseButton>
        <div className="rp-lantern" aria-hidden="true" />
        <DialogHeader className="rp-header">
          <DialogTitle className="rp-title">发个红包</DialogTitle>
          <DialogDescription className="rp-blessing">
            {session.lockedUser
              ? `给 ${session.lockedUser} 的专属红包`
              : "选择类型后包出去，请求被接受不等于聊天室已回显。"}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="rp-form">
          <Field>
            <FieldLabel>类型</FieldLabel>
            <Select
              value={type}
              onValueChange={(value) => {
                if (isRedPacketType(value)) {
                  changeType(value);
                }
              }}
              disabled={typeLocked || submitting}
            >
              <SelectTrigger className="rp-select">
                <SelectValue placeholder="选择红包类型" />
              </SelectTrigger>
              <SelectContent>
                {REDPACKET_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {showGestures ? (
            <GesturePicker
              value={form.gesture}
              onChange={(gesture) => update("gesture", gesture)}
              caption="猜拳出手"
              disabled={submitting}
            />
          ) : null}

          {showReceivers ? (
            <Field data-invalid={Boolean(errors.receivers) || undefined}>
              <FieldLabel>发给谁</FieldLabel>
              {session.lockedUser ? (
                <p className="rp-locked">给 {session.lockedUser} ❤</p>
              ) : session.onlineUsers.length > 0 ? (
                <div className="rp-users">
                  {session.onlineUsers.map((user) => {
                    const checked = selectedSet.has(user.userName.toLowerCase());
                    return (
                      <button
                        key={user.userName}
                        type="button"
                        className={checked ? "rp-user is-check" : "rp-user"}
                        title={user.userName}
                        disabled={submitting}
                        onClick={() => toggleReceiver(user.userName)}
                      >
                        <SenderFace name={user.userName} src={user.userAvatarUrl} size="sm" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Input
                  value={form.receiverDraft}
                  placeholder="用户名，逗号分隔"
                  disabled={submitting}
                  aria-invalid={Boolean(errors.receivers)}
                  onChange={(event) => update("receiverDraft", event.target.value)}
                />
              )}
              {session.onlineUsers.length > 0 && !session.lockedUser ? (
                <Input
                  className="rp-extra-receivers"
                  value={form.receiverDraft}
                  placeholder="也可以再填用户名"
                  disabled={submitting}
                  onChange={(event) => update("receiverDraft", event.target.value)}
                />
              ) : null}
              <FieldError>{errors.receivers}</FieldError>
            </Field>
          ) : null}

          <Field data-invalid={Boolean(errors.money) || undefined}>
            <FieldLabel>积分</FieldLabel>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.money}
              disabled={submitting}
              aria-invalid={Boolean(errors.money)}
              onChange={(event) => update("money", event.target.value)}
            />
            <FieldError>{errors.money}</FieldError>
          </Field>

          {showCount ? (
            <Field data-invalid={Boolean(errors.count) || undefined}>
              <FieldLabel>个数</FieldLabel>
              <Input
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                value={form.count}
                disabled={submitting}
                aria-invalid={Boolean(errors.count)}
                onChange={(event) => update("count", event.target.value)}
              />
              <FieldError>{errors.count}</FieldError>
            </Field>
          ) : null}

          <Field>
            <FieldLabel>留言</FieldLabel>
            <Textarea
              rows={3}
              value={form.message}
              disabled={submitting}
              placeholder={DEFAULT_BLESSING[type]}
              onChange={(event) => update("message", event.target.value)}
            />
          </Field>
        </FieldGroup>

        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="rp-footer">
          <Button type="button" disabled={submitting} onClick={handleSubmit}>
            {submitting ? (
              <>
                <Spinner />
                发送中
              </>
            ) : (
              "包红包"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
