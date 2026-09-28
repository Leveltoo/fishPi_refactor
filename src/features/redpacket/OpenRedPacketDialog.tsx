import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { typeLabel } from "./constants";
import { GesturePicker, SenderFace } from "./parts";
import {
  isLuckyKing,
  maxGotMoney,
  openHeadline,
  senderGestureText,
} from "./resultCopy";
import type {
  GestureIndex,
  OpenOutcome,
  OpenSession,
  RedPacketInfo,
} from "./types";

type OpenRedPacketDialogProps = {
  session: OpenSession;
  selfUserName: string;
  loading: boolean;
  outcome: OpenOutcome | null;
  selectedGesture?: GestureIndex;
  onGestureChange: (gesture: GestureIndex) => void;
  onClaim: () => void;
  onClose: () => void;
};

export function OpenRedPacketDialog({
  session,
  selfUserName,
  loading,
  outcome,
  selectedGesture,
  onGestureChange,
  onClaim,
  onClose,
}: OpenRedPacketDialogProps) {
  const data = outcome?.status === "ok" ? outcome.data : null;
  const needsGesture =
    session.packetType === "rockPaperScissors" && selectedGesture === undefined;
  const canClaim = Boolean(session.oId) && !loading && !needsGesture;
  const titleName = data?.info.userName || session.preview.userName || "红包";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="rp-dialog p-0 sm:max-w-[22rem]" showCloseButton>
        <div className="rp-lantern" aria-hidden="true" />
        <DialogHeader className="rp-header">
          <SenderFace
            name={titleName}
            src={data?.info.userAvatarUrl || session.preview.userAvatarUrl}
          />
          <DialogTitle className="rp-title">{titleName} 的红包</DialogTitle>
          <DialogDescription className="rp-blessing">
            {data?.info.message || session.preview.message || "恭喜发财"}
          </DialogDescription>
          <PacketMeta session={session} data={data} />
        </DialogHeader>

        <div className="rp-body">
          {loading ? (
            <div className="rp-loading">
              <Spinner className="size-6" />
              <p>正在领取…</p>
            </div>
          ) : null}

          {!loading && !data && session.packetType === "rockPaperScissors" ? (
            <GesturePicker
              value={selectedGesture}
              onChange={onGestureChange}
              caption="猜拳红包需先出手"
            />
          ) : null}

          {!loading && outcome && outcome.status !== "ok" ? (
            <Alert variant={outcome.status === "error" ? "destructive" : "default"}>
              <AlertTitle>
                {outcome.status === "unavailable"
                  ? "尚未接入"
                  : outcome.status === "outcome_unknown"
                    ? "结果待确认"
                    : "领取失败"}
              </AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && data ? <OpenResult data={data} selfUserName={selfUserName} /> : null}

          {!loading && !data && !outcome && !needsGesture ? (
            <p className="rp-hint">确认后领取。领取是写操作，失败后请勿连续点击。</p>
          ) : null}
        </div>

        <DialogFooter className="rp-footer">
          {data ? (
            <Button type="button" variant="outline" onClick={onClose}>
              关闭
            </Button>
          ) : (
            <Button type="button" disabled={!canClaim} onClick={onClaim}>
              {loading ? "领取中" : "领取"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PacketMeta({
  session,
  data,
}: {
  session: OpenSession;
  data: RedPacketInfo | null;
}) {
  const gesture = data?.info.gesture ?? session.gesture;
  const count = data?.info.count ?? session.preview.count;
  const got = data?.info.got ?? session.preview.got;
  const isRps =
    session.packetType === "rockPaperScissors" || gesture !== undefined;

  if (isRps) {
    return (
      <p className="rp-meta">
        {senderGestureText(data?.info.userName || session.preview.userName, gesture)}
      </p>
    );
  }

  if (count === undefined) {
    return session.packetType ? (
      <p className="rp-meta">{typeLabel(session.packetType)}</p>
    ) : null;
  }

  return (
    <p className="rp-meta">
      总计 {got ?? 0}/{count}
    </p>
  );
}

function OpenResult({
  data,
  selfUserName,
}: {
  data: RedPacketInfo;
  selfUserName: string;
}) {
  const headline = openHeadline(data, selfUserName);
  const maxMoney = maxGotMoney(data.who);

  return (
    <div className="rp-result">
      <p className="rp-headline">{headline}</p>
      {data.who.length === 0 ? (
        <p className="rp-empty">还没有领取记录</p>
      ) : (
        <ul className="rp-who">
          {data.who.map((item) => (
            <li key={`${item.userId}-${item.userName}-${item.time}`}>
              <span className="rp-who-user">
                <SenderFace name={item.userName} src={item.avatar} size="sm" />
                <span>{item.userName}</span>
              </span>
              <span className="rp-who-money">{item.userMoney} 积分</span>
              {isLuckyKing(item, data, maxMoney) ? (
                <Badge className="rp-tip rp-tip-max">来自老王的认可</Badge>
              ) : null}
              {item.userMoney === 0 ? (
                <Badge variant="outline" className="rp-tip rp-tip-zero">
                  0 溢事件
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


