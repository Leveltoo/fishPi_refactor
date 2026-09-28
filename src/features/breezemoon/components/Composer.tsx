import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  sendAvailable: boolean;
  onSend: (content: string) => Promise<boolean>;
};

export function Composer({
  disabled,
  sending,
  pendingConfirm,
  sendAvailable,
  onSend,
}: ComposerProps) {
  const [draft, setDraft] = useState("");

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (content.length === 0 || disabled || sending) {
      return;
    }
    const accepted = await onSend(content);
    if (accepted) {
      setDraft("");
    }
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const placeholder = !sendAvailable
    ? "发送接口尚未接入，不会伪装发出"
    : disabled
      ? "当前无法发送"
      : "写一句清风明月，Enter 发送，Shift+Enter 换行";

  return (
    <form className="bm-composer" onSubmit={onSubmit}>
      {pendingConfirm ? (
        <Alert className="bm-pending-alert">
          <AlertDescription>
            结果待确认。请求已发出，但未能确认服务端是否落成。请稍后在时间线核对，不要重复发送。
          </AlertDescription>
        </Alert>
      ) : null}
      <Label className="visually-hidden" htmlFor="breezemoon-input">
        清风明月内容
      </Label>
      <InputGroup className="bm-composer-group">
        <InputGroupTextarea
          id="breezemoon-input"
          rows={3}
          className="min-h-[4.6rem]"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="block-end" className="bm-composer-addon">
          <p className="bm-composer-hint">
            发送成功只表示已接受，不会立刻插入本地条目。
          </p>
          <InputGroupButton
            type="submit"
            size="sm"
            disabled={disabled || sending || draft.trim().length === 0}
          >
            {sending ? <Spinner /> : null}
            {sending ? "发送中" : "发送"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
