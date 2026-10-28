/** Native sidebar occurrence of the shared Workspace browser. */
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the browser with its ordinary main-view navigation.
 * @param props - sidebar geometry and shared Factory renderer.
 * @returns the native Workspace browser.
 */
export function SidebarWorkspaceBrowser(props: PropsRuntime<'sidebar.workspaces'> & PropsRenderFactories) {
  return props.renderFactorySlot('workspace.browser', { wide: props.wide, expandSidebar: props.expandSidebar })
}
