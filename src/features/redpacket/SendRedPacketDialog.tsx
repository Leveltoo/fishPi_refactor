import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { OnlineEvent } from "../../lib/types";
import { readSelfSession } from "./api";

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
  uncertain: boolean;
  notice: string | null;
  onSubmit: (form: SendFormValues) => void;
  onClose: () => void;
};

export function SendRedPacketDialog({
  session,
  submitting,
  uncertain,
  notice,
  onSubmit,
  onClose,
}: SendRedPacketDialogProps) {
  const typeLocked = Boolean(session.lockedUser);
  const disabled = submitting || uncertain;
  const [onlineUsers, setOnlineUsers] = useState(session.onlineUsers);
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
    () => new Set(form.receivers),
    [form.receivers],
  );

  useEffect(() => {
    let stopped = false;
    const subscription = (async () => {
      const me = await readSelfSession();
      if (stopped || !me) return null;
      return listen<OnlineEvent>("chatroom://online", ({ payload }) => {
        if (!stopped && payload.sessionGeneration === me.sessionGeneration) {
          setOnlineUsers(payload.users);
        }
      });
    })().catch(() => null);
    return () => {
      stopped = true;
      void subscription.then((unlisten) => unlisten?.());
    };
  }, []);

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
    }));
    setErrors({});
  }

  function toggleReceiver(userName: string) {
    setForm((current) => {
      const exists = current.receivers.some(
        (name) => name === userName,
      );
      return {
        ...current,
        receivers: exists
          ? current.receivers.filter(
              (name) => name !== userName,
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
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="rp-dialog rp-dialog-send p-0 sm:max-w-[22rem]" showCloseButton>
        <div className="rp-lantern" aria-hidden="true" />
        <DialogHeader className="rp-header">
          <DialogTitle className="rp-title rp-send-title">
            <span>发个</span>
            <Select
              value={type}
              onValueChange={(value) => {
                if (isRedPacketType(value)) {
                  changeType(value);
                }
              }}
              disabled={typeLocked || disabled}
            >
              <SelectTrigger
                className="rp-type-select"
                size="sm"
                aria-label="红包类型"
              >
                <SelectValue placeholder="红包类型" />
              </SelectTrigger>
              <SelectContent className="rp-select-options">
                {REDPACKET_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>红包</span>
          </DialogTitle>
          {session.lockedUser ? (
            <DialogDescription className="rp-specify-user">
              给 {session.lockedUser} ❤
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <FieldGroup className="rp-form">
          {showGestures ? (
            <GesturePicker
              value={form.gesture}
              onChange={(gesture) => update("gesture", gesture)}
              disabled={disabled}
            />
          ) : null}

          {showReceivers ? (
            <Field data-invalid={Boolean(errors.receivers) || undefined}>
              <FieldLabel>发给谁</FieldLabel>
              {session.lockedUser ? (
                <p className="rp-locked">给 {session.lockedUser} ❤</p>
              ) : onlineUsers.length > 0 ? (
                <div className="rp-users">
                  {onlineUsers.map((user) => {
                    const checked = selectedSet.has(user.userName);
                    return (
                      <Button
                        key={user.userName}
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={checked ? "rp-user is-check" : "rp-user"}
                        title={user.userName}
                        aria-label={user.userName}
                        aria-pressed={checked}
                        disabled={disabled}
                        onClick={() => toggleReceiver(user.userName)}
                      >
                        <SenderFace name={user.userName} src={user.userAvatarUrl} size="sm" />
                    </Button>
                    );
                  })}
                </div>
              ) : null}
              <FieldError>{errors.receivers}</FieldError>
            </Field>
          ) : null}

          <Field data-invalid={Boolean(errors.money) || undefined}>
            <FieldLabel htmlFor="rp-money">积分</FieldLabel>
            <Input
              type="number"
              id="rp-money"
              min={1}
              max={0xffff_ffff}
              step={1}
              inputMode="numeric"
              value={form.money}
              disabled={disabled}
              aria-invalid={Boolean(errors.money)}
              onChange={(event) => update("money", event.target.value)}
            />
            <FieldError>{errors.money}</FieldError>
          </Field>

          {showCount ? (
            <Field data-invalid={Boolean(errors.count) || undefined}>
              <FieldLabel htmlFor="rp-count">个数</FieldLabel>
              <Input
                type="number"
                id="rp-count"
                min={1}
                max={1000}
                step={1}
                inputMode="numeric"
                value={form.count}
                disabled={disabled}
                aria-invalid={Boolean(errors.count)}
                onChange={(event) => update("count", event.target.value)}
              />
              <FieldError>{errors.count}</FieldError>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="rp-message">留言</FieldLabel>
            <Textarea
              rows={3}
              id="rp-message"
              value={form.message}
              disabled={disabled}
              placeholder={DEFAULT_BLESSING[type]}
              onChange={(event) => update("message", event.target.value)}
            />
          </Field>
        </FieldGroup>

        {notice ? (
          <Alert className="rp-notice">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="rp-footer">
          <Button type="button" disabled={disabled} onClick={handleSubmit}>
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
