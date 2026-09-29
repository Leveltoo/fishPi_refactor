/**
 * 拦截 WebView 默认右键菜单。只在业务菜单区域（Radix trigger / data-menu）放行。
 * 对齐旧版 main.js：始终 preventDefault，非菜单区域 stopPropagation。
 */
export function installNativeContextMenuGuard(): void {
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      const target = event.target;
      if (!(target instanceof Element)) {
        event.stopPropagation();
        return;
      }
      if (
        target.closest(
          '[data-slot="context-menu-trigger"], [data-menu="true"]',
        )
      ) {
        return;
      }
      event.stopPropagation();
    },
    true,
  );
}
