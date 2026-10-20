import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ComposerProps = {
  disabled: boolean;
  sending: boolean;
  pendingConfirm: boolean;
  onSend: (content: string) => Promise<boolean>;
};

export function Composer({
  disabled,
  sending,
  pendingConfirm,
  onSend,
}: ComposerProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (pendingConfirm) {
      toast.error("发送结果未确认，请稍后刷新核对");
    }
  }, [pendingConfirm]);

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (content.length === 0 || disabled || sending) return;
    const accepted = await onSend(content);
    if (accepted) setDraft("");
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="breezemoons" onSubmit={onSubmit}>
      <Input
        id="breezemoon-input"
        type="text"
        value={draft}
        disabled={disabled}
        placeholder="清风明月"
        aria-label="清风明月内容"
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        className="breezemoon-send"
        title="发送"
        aria-label="发送"
        disabled={disabled || sending || draft.trim().length === 0}
      >
        <i
          className={sending ? "fa fa-spinner fa-spin" : "fa fa-paper-plane"}
          aria-hidden="true"
        />
      </Button>
    </form>
  );
}
