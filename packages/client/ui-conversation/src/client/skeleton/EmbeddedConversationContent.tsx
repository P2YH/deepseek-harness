/** Supported embedded presentation, including local Workspace navigation and transcript-only use. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contract/slots.ts'
import css from './ConversationRoot.module.css'

/**
 * Compose the shared Conversation content without main-view navigation.
 * @param props - retained Session scope and explicit presentation-host navigation.
 * @returns the shared body, with the composer omitted for transcript-only occurrences.
 */
export function EmbeddedConversationContent(props: FactoryComponentPropsOf<'conversation.embedded'>) {
  return <div className={css.root} data-phase={props.phase}>
    {props.renderFactorySlot('conversation.header.content', { embedded: true, onOpenSession: props.onOpenSession })}
    {props.renderFactorySlot('conversation.content', {
      variant: 'embedded',
      phase: props.phase,
      hero: props.hero,
      readOnly: props.readOnly,
      onSelectWorkspace: props.onSelectWorkspace,
    })}
  </div>
}
