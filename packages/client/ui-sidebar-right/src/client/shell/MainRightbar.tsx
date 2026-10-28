/** Main-frame occurrence of the shared native Sidebar. */
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the native Sidebar at the main frame's geometry.
 * @param props - frame measurements and Factory renderer.
 * @returns the Sidebar's retained Session views.
 */
export function MainRightbar(props: PropsRuntime<'rightbar'> & PropsRenderFactories) {
  return props.renderFactorySlot('sidebar.right.browser', {
    placement: 'main', width: props.width, viewportWidth: props.viewportWidth, canShow: props.canShow,
  })
}
