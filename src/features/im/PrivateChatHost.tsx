import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningIcon } from "@phosphor-icons/react";

import { OPEN_IM_EVENT, type OpenImDetail } from "../../lib/nav";
import { setHeaderTitle } from "../../lib/headerTitle";
import { ConversationList } from "./components/ConversationList";
import { MessagePane } from "./components/MessagePane";
import { StartChatDialog } from "./components/StartChatDialog";
import { usePrivateChat, replyTargetFromMessage } from "./usePrivateChat";
import "./im.css";

/**
 * 侧栏打开时渲染的私聊宿主：左侧会话列表 + 右侧消息与发送。
 * 无必填 props。发送接口缺失时不会伪装成功。
 */
export function PrivateChatHost() {
  const chat = usePrivateChat();
  const active = chat.conversations.find(
    (item) => item.peerUserName === chat.activeUser,
  );
  const bridgeMissing = !chat.loadingList && !chat.capabilities.list;
  const openConversation = chat.openConversation;

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
    <div className="im dark" id="im">
      <h1 className="visually-hidden">私聊</h1>

      {bridgeMissing ? (
        <Alert className="im-alert">
          <WarningIcon />
          <AlertTitle>私聊 Bridge 尚未接入</AlertTitle>
          <AlertDescription>
            私聊命令尚未注册。界面可预览，发送不会伪装成功；命令就绪后会自动重试。
          </AlertDescription>
        </Alert>
      ) : chat.error ? (
        <Alert variant="destructive" className="im-alert">
          <WarningIcon />
          <AlertTitle>私聊请求失败</AlertTitle>
          <AlertDescription>{chat.error}</AlertDescription>
        </Alert>
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

      <StartChatDialog
        open={chat.startOpen}
        onOpenChange={chat.setStartOpen}
        conversations={chat.conversations}
        searchAvailable={chat.capabilities.search}
        onSearch={chat.searchUsers}
        onPick={chat.startChat}
      />
    </div>
  );
}
