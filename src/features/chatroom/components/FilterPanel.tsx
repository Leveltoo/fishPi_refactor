import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  lookupUserName,
  saveChatroomFilters,
  type ChatroomFilters,
  type ShieldKind,
  type ShieldRule,
} from "../chatroomApi";
import { toUserErrorMessage } from "../toUserError";

type FilterPanelProps = {
  filters: ChatroomFilters;
  onChange: (filters: ChatroomFilters) => void;
};

const SHIELD_OPTIONS: Array<{ value: ShieldKind; text: string }> = [
  { value: "username", text: "用户" },
  { value: "content", text: "内容(支持正则)" },
  { value: "redpacket", text: "红包" },
];

function emptyRule(): ShieldRule {
  return { type: "username", value: "" };
}

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const [shield, setShield] = useState<ShieldRule[]>(filters.shield);
  const [careUsers, setCareUsers] = useState<string[]>(filters.careUsers);
  const [careDraft, setCareDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const persistTimer = useRef(0);
  const ready = useRef(false);

  useEffect(() => {
    ready.current = true;
    return () => {
      window.clearTimeout(persistTimer.current);
    };
  }, []);

  async function persist(next: ChatroomFilters): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveChatroomFilters(next);
      setShield(saved.shield);
      setCareUsers(saved.careUsers);
      onChange(saved);
      return true;
    } catch (err) {
      setError(toUserErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function schedulePersist(next: ChatroomFilters): void {
    if (!ready.current) {
      return;
    }
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void persist(next);
    }, 400);
  }

  function updateShield(next: ShieldRule[]): void {
    setShield(next);
    schedulePersist({ shield: next, careUsers });
  }

  async function addCare(): Promise<void> {
    const name = careDraft.trim();
    if (name.length === 0 || careUsers.includes(name) || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await lookupUserName(name);
      if (found !== name) {
        setError("用户名不存在");
        return;
      }
      const saved = await persist({ shield, careUsers: [...careUsers, name] });
      if (saved) {
        setCareDraft("");
      }
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-filters">
      <p className="chat-emoji-note">屏蔽和特别关心只存在本机，不会写入登录凭据。改完自动保存。也可在设置页编辑。</p>
      {error ? <p className="chat-emoji-note">{error}</p> : null}
      <ul className="chat-filter-list">
        {shield.map((rule, index) => (
          <li key={`${rule.type}-${index}`} className="chat-filter-row">
            <select
              className="chat-inline-input"
              value={rule.type}
              onChange={(event) => {
                const type = event.target.value as ShieldKind;
                updateShield(
                  shield.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, type } : item,
                  ),
                );
              }}
            >
              {SHIELD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.text}
                </option>
              ))}
            </select>
            {rule.type === "redpacket" ? (
              <span className="chat-emoji-note">全部红包</span>
            ) : (
              <input
                className="chat-inline-input"
                value={rule.value}
                placeholder={rule.type === "username" ? "用户名" : "正则"}
                onChange={(event) => {
                  updateShield(
                    shield.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, value: event.target.value }
                        : item,
                    ),
                  );
                }}
              />
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                updateShield(shield.filter((_, itemIndex) => itemIndex !== index));
              }}
            >
              删除
            </Button>
          </li>
        ))}
      </ul>
      <div className="chat-emoji-tabs">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => updateShield([...shield, emptyRule()])}
        >
          加一条屏蔽
        </Button>
        <span className="chat-emoji-note">
          {busy ? "正在保存" : "改完即保存"}
        </span>
      </div>
      <p className="chat-emoji-note">特别关心</p>
      <div className="chat-care-list">
        {careUsers.map((name) => (
          <Button
            key={name}
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              void persist({
                shield,
                careUsers: careUsers.filter((item) => item !== name),
              });
            }}
          >
            {name} ×
          </Button>
        ))}
      </div>
      <form
        className="chat-emoji-add"
        onSubmit={(event) => {
          event.preventDefault();
          void addCare();
        }}
      >
        <input
          className="chat-inline-input"
          value={careDraft}
          placeholder="用户名"
          onChange={(event) => setCareDraft(event.target.value)}
        />
        <Button type="submit" size="xs" variant="outline" disabled={busy || careDraft.trim().length === 0}>
          添加
        </Button>
      </form>
    </div>
  );
}
