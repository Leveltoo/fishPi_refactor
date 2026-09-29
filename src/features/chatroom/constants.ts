/** 内存窗口：配合 content-visibility，屏外跳过绘制；500 是安全上限，重建时会 resync。 */
export const MESSAGE_WINDOW_LIMIT = 800;

export const HISTORY_FIRST_PAGE = 1;
export const BEFORE_PAGE_SIZE = 25;
export const MAX_BEFORE_PAGES = 16;
/** 对齐旧版：离底部约 500px 仍跟随滚到底。 */
export const NEAR_BOTTOM_PX = 500;

export const INITIAL_CONNECTION_STATUS = "unknown";
