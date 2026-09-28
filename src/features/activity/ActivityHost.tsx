import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { WarningIcon } from "@phosphor-icons/react";

import { COMMAND_LABEL, NOTICE_TYPES } from "./constants";
import type { NoticeCountDto, NoticeType } from "./types";
import { NOTICE_COMMAND, USER_COMMAND } from "./types";
import { useActivity, type ActivityCapabilities } from "./useActivity";
import "./activity.css";

/**
 * 常驻或侧栏宿主：无必填 props。
 * 自己拉未读 / 活跃度、听广播；卸载时 clearInterval。
 */
export function ActivityHost() {
  const activity = useActivity();
  const missing = missingCapabilityLabels(activity.capabilities);
  const unread = activity.count.count;
  const percent =
    activity.liveness == null ? null : Math.round(activity.liveness);

  return (
    <div className="activity dark" id="activity">
      <header className="activity-head">
        <div className="activity-title-row">
          <h1 className="activity-title">通知</h1>
          {activity.loadingCount ? (
            <Spinner className="activity-head-spin" />
          ) : unread > 0 ? (
            <Badge className="activity-unread">{unread > 99 ? "99+" : unread}</Badge>
          ) : null}
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={
            activity.markingRead ||
            !activity.capabilities.readAll ||
            unread === 0
          }
          onClick={() => {
            void activity.markAllRead();
          }}
        >
          全部已读
        </Button>
      </header>

      {missing.length > 0 ? (
        <Alert className="activity-alert">
          <WarningIcon />
          <AlertTitle>部分能力尚未接入</AlertTitle>
          <AlertDescription>
            {missing.join("、")}尚未接入 Bridge。对应操作不会伪装成功。
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="activity-daily" aria-label="签到与活跃度">
        <div className="activity-liveness-row">
          <span className="activity-label">活跃度</span>
          {percent == null ? (
            activity.capabilities.liveness ? (
              <Spinner className="activity-head-spin" />
            ) : (
              <span className="activity-muted">—</span>
            )
          ) : (
            <>
              <div
                className="activity-meter"
                role="meter"
                aria-label="活跃度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className="activity-meter-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="activity-percent">{percent}%</span>
            </>
          )}
        </div>
        <div className="activity-actions">
          <Button
            type="button"
            disabled={
              activity.checkedIn ||
              !activity.capabilities.checkin ||
              activity.checkingIn ||
              activity.loadingDaily
            }
            onClick={() => {
              void activity.checkin();
            }}
          >
            {activity.checkingIn ? (
              <Spinner />
            ) : activity.checkedIn ? (
              "已签到"
            ) : (
              "签到"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              activity.collected ||
              !activity.capabilities.reward ||
              activity.rewarding ||
              activity.loadingDaily
            }
            onClick={() => {
              void activity.claimReward();
            }}
          >
            {activity.rewarding ? (
              <Spinner />
            ) : activity.collected ? (
              "已领取"
            ) : (
              "领取昨日奖励"
            )}
          </Button>
        </div>
      </section>

      <div className="activity-types" role="tablist" aria-label="通知类型">
        {NOTICE_TYPES.map((item) => {
          const active = item.value === activity.noticeType;
          const typeUnread = unreadOf(activity.count, item.value);
          return (
            <Button
              key={item.value}
              type="button"
              size="xs"
              variant={active ? "default" : "outline"}
              role="tab"
              aria-selected={active}
              className={active ? "activity-type is-active" : "activity-type"}
              onClick={() => activity.selectType(item.value)}
            >
              {item.label}
              {typeUnread > 0 ? (
                <Badge className="activity-type-badge">
                  {typeUnread > 99 ? "99+" : typeUnread}
                </Badge>
              ) : null}
            </Button>
          );
        })}
      </div>

      <div className="activity-list-head">
        <span className="activity-label">通知列表</span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={
            activity.markingRead ||
            !activity.capabilities.makeRead ||
            activity.items.length === 0
          }
          onClick={() => {
            void activity.markTypeRead();
          }}
        >
          本类已读
        </Button>
      </div>

      <ScrollArea className="activity-scroll">
        {activity.loadingList ? (
          <div className="activity-empty" aria-busy="true">
            <Spinner />
            <span>正在加载通知</span>
          </div>
        ) : !activity.capabilities.list ? (
          <p className="activity-empty">通知列表命令尚未接入。</p>
        ) : activity.items.length === 0 ? (
          <p className="activity-empty">暂无通知</p>
        ) : (
          <ul className="activity-items">
            {activity.items.map((item) => (
              <li
                key={item.id}
                className={item.hasRead ? "activity-item is-read" : "activity-item"}
              >
                <p className="activity-item-title">{item.title}</p>
                {item.content && item.content !== item.title ? (
                  <p className="activity-item-body">{item.content}</p>
                ) : null}
                <p className="activity-item-meta">
                  {[item.author, item.time].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function unreadOf(count: NoticeCountDto, type: NoticeType): number {
  switch (type) {
    case "at":
      return count.at;
    case "reply":
      return count.reply;
    case "commented":
      return count.commented;
    case "following":
      return count.following;
    case "point":
      return count.point;
    case "sys-announce":
      return count.sysAnnounce;
  }
}

function missingCapabilityLabels(capabilities: ActivityCapabilities): string[] {
  const labels: string[] = [];
  if (!capabilities.count) {
    labels.push(COMMAND_LABEL[NOTICE_COMMAND.count]);
  }
  if (!capabilities.list) {
    labels.push(COMMAND_LABEL[NOTICE_COMMAND.list]);
  }
  if (!capabilities.liveness) {
    labels.push(COMMAND_LABEL[USER_COMMAND.liveness]);
  }
  if (!capabilities.checkin) {
    labels.push(COMMAND_LABEL[USER_COMMAND.checkin]);
  }
  if (!capabilities.collected) {
    labels.push(COMMAND_LABEL[USER_COMMAND.isCollectedLiveness]);
  }
  if (!capabilities.reward) {
    labels.push(COMMAND_LABEL[USER_COMMAND.rewardLiveness]);
  }
  return labels;
}
