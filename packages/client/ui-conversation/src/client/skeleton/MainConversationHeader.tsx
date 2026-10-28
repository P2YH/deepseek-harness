/** Main-view occurrence of the native Conversation header. */
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render the header with main-view navigation.
 * @param props - framework Factory renderer.
 * @returns native Conversation header.
 */
export function MainConversationHeader(props: PropsRenderFactories) {
  return props.renderFactorySlot('conversation.header.content', {})
}
