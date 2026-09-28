# 红包 Bridge

开包走 `redpacket_open`，发包走现有 `chatroom_send`。不要自动重试；`outcome_unknown` 只提示核对。

## `redpacket_open`

```
invoke("redpacket_open", {
  request: { oId: string, gesture?: 0 | 1 | 2 }
})
```

对应 SDK `client.redpacket().open(oId, gesture)`。

## `chatroom_send`

发红包载荷：`[redpacket]{type,money,count,msg,recivers,gesture?}[/redpacket]`。
