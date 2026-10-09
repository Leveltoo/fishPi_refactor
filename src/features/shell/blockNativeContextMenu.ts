/**
 * 拦截 WebView 默认右键菜单。只在业务菜单区域（Radix trigger / data-menu）放行。
 * 业务菜单自行 preventDefault；提前取消会让 Radix 跳过打开逻辑。
 */
export function installNativeContextMenuGuard(): void {
  window.addEventListener(
    "contextmenu",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        event.preventDefault();
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
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
