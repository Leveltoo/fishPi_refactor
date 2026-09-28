import io

p = r"D:\project-workspace\fishp-refactor\fishpi-desktop-refactor-tauri\src\features\chatroom\chatroom.css"
with io.open(p, "r", encoding="utf-8", newline="") as f:
    data = f.read()

old = (
    '.chat-stream-scroller > [data-slot="scroll-area"] {\n'
    "  height: 100%;\n"
    "}\n"
)

new = old + """
/* 旧版全局 5px 暗色条：Radix 用内联 style 把原生条 scrollbar-width:none + display:none，
   这里用更高特异性放回原生条并着色；auto 覆盖 none，WebKit 自定义条才生效 */
.chat-stream-scroller [data-slot="scroll-area-viewport"] {
  scrollbar-width: auto;
  scrollbar-color: auto;
}

.chat-stream-scroller [data-slot="scroll-area-viewport"]::-webkit-scrollbar {
  display: block;
  width: 5px;
  height: 5px;
}

.chat-stream-scroller [data-slot="scroll-area-viewport"]::-webkit-scrollbar-track {
  background: transparent;
}

.chat-stream-scroller [data-slot="scroll-area-viewport"]::-webkit-scrollbar-thumb {
  background: var(--chat-line);
  border-radius: 3px;
}

.chat-stream-scroller [data-slot="scroll-area-viewport"]::-webkit-scrollbar-thumb:hover {
  background: var(--chat-muted);
}

.chat-stream-scroller [data-slot="scroll-area-viewport"]::-webkit-scrollbar-corner {
  background: transparent;
}

/* 隐藏 Radix 自绘 hover 细条，避免和原生条并排双条 */
.chat-stream-scroller [data-slot="scroll-area-scrollbar"] {
  display: none;
}
"""

assert data.count(old) == 1, data.count(old)
data = data.replace(old, new, 1)

with io.open(p, "w", encoding="utf-8", newline="") as f:
    f.write(data)
print("ok")
