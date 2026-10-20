import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

import { OPEN_IM_EVENT, type OpenImDetail } from "../../lib/nav";
import { setHeaderTitle } from "../../lib/headerTitle";
import { ConversationList } from "./components/ConversationList";
import { MessagePane } from "./components/MessagePane";
import { usePrivateChat } from "./usePrivateChat";
import { replyTargetFromMessage } from "./replyQuote";
import "./im.css";

/**
 * 侧栏打开时渲染的私聊宿主：左侧会话列表 + 右侧消息与发送。
 * 无必填 props。发送接口缺失时不会伪装成功。
 */
export function PrivateChatHost() {
  const chat = usePrivateChat();
  const rootRef = useRef<HTMLDivElement>(null);
  const [newUser, setNewUser] = useState("");
  const active = chat.conversations.find(
    (item) => item.peerUserName === chat.activeUser,
  );
  const bridgeMissing = !chat.loadingList && !chat.capabilities.list;
  const openConversation = chat.openConversation;
  const setVisible = chat.setVisible;

  function startNewChat(): void {
    const userName = newUser.trim();
    if (userName.length === 0) {
      return;
    }
    chat.startChat({ userName, userAvatarUrl: "" });
    setNewUser("");
  }

  useEffect(() => {
    const root = rootRef.current;
    const page = root?.closest(".shell__page");
    function update(): void {
      setVisible(document.visibilityState === "visible" && root?.closest("[hidden]") == null);
    }
    const observer = new MutationObserver(update);
    if (page) observer.observe(page, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      setVisible(false);
    };
  }, [setVisible]);

  useEffect(() => {
    function onOpenIm(event: Event): void {
      const detail = (event as CustomEvent<OpenImDetail>).detail;
      if (detail?.userName) {
        void openConversation(detail.userName);
      }
    }
    window.addEventListener(OPEN_IM_EVENT, onOpenIm);
    return () => {
      window.removeEventListener(OPEN_IM_EVENT, onOpenIm);
    };
  }, [openConversation]);

  // 对齐旧版：私聊标题跟随对方昵称/用户名；无会话时恢复「私聊」
  useEffect(() => {
    const label = chat.peerNickname?.trim() || chat.activeUser;
    setHeaderTitle("im", label || null);
    return () => setHeaderTitle("im", null);
  }, [chat.activeUser, chat.peerNickname]);

  return (
    <div className="im dark" id="im" ref={rootRef}>
      <h1 className="visually-hidden">私聊</h1>

      {bridgeMissing ? (
        <Alert className="im-alert">
          <i className="fa fa-exclamation-circle" aria-hidden="true" />
          <AlertTitle>私聊暂不可用</AlertTitle>
          <AlertDescription>
            无法加载会话
          </AlertDescription>
        </Alert>
      ) : chat.error ? (
        <Alert variant="destructive" className="im-alert">
          <i className="fa fa-exclamation-circle" aria-hidden="true" />
          <AlertTitle>私聊请求失败</AlertTitle>
          <AlertDescription>{chat.error}</AlertDescription>
        </Alert>
      ) : null}

      {chat.startOpen ? (
        <section className="im-user-form">
          <Input
            autoFocus
            value={newUser}
            placeholder="想和谁聊聊？"
            aria-label="想和谁聊聊？"
            onChange={(event) => setNewUser(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                startNewChat();
              } else if (event.key === "Escape") {
                setNewUser("");
                chat.setStartOpen(false);
              }
            }}
          />
        </section>
      ) : null}

      <div className="im-body">
        <ConversationList
          conversations={chat.conversations}
          activeUser={chat.activeUser}
          loading={chat.loadingList}
          onSelect={(userName) => {
            void chat.openConversation(userName);
          }}
          onStart={() => chat.setStartOpen(true)}
        />
        <MessagePane
          peerUserName={chat.activeUser}
          peerAvatarUrl={active?.peerAvatarUrl ?? ""}
          peerNickname={chat.peerNickname}
          selfUserName={chat.selfUserName}
          messages={chat.messages}
          loading={chat.loadingThread}
          loadingMore={chat.loadingMore}
          hasMore={chat.hasMore}
          sending={chat.sending}
          pendingConfirm={chat.pendingConfirm}
          confirmedContent={chat.confirmedContent}
          sendAvailable={chat.capabilities.send}
          quote={chat.quote}
          onQuote={(message) => {
            chat.setQuote(replyTargetFromMessage(message));
          }}
          onMention={(userName) => {
            chat.setPendingMention(userName);
          }}
          pendingMention={chat.pendingMention}
          onClearPendingMention={chat.clearPendingMention}
          onClearQuote={chat.clearQuote}
          onClear={() => {
            void chat.clearThread();
          }}
          onLoadMore={() => {
            void chat.loadMore();
          }}
          onSend={chat.send}
          onRevoke={chat.revoke}
        />
      </div>

    </div>
  );
}
