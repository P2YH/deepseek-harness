/** Root-scoped controller for the right Sidebar's Session content. */
import { useLayoutEffect } from 'react'
import type { FactoryComponentPropsOf, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarSessionViewSnapshot } from '../session-views.ts'
import type {} from '../contract/slots.ts'
import css from './SidebarRight.module.css'

/** Root-only retained Session targets and their committed mount lifetimes. */
export interface RightbarRootInjected {
  readonly hooks: {
    readonly views: HostObservable<readonly SidebarSessionViewSnapshot[]>
    readonly embedded: HostObservable<{ readonly sessionId: SessionId | undefined } | null>
  }
  readonly mountView: (reference: SessionReference) => () => void
  /** @param sessionId - foreground embedded Session. @returns releases presentation ownership. */
  readonly present: (sessionId: SessionId | undefined) => () => void
}

type RootProps = FactoryComponentPropsOf<'sidebar.right.browser'>

function SessionView({ view, visible, SessionProvider, renderSlot, mountView, width, viewportWidth, canShow, onPresentation }:
  Pick<RootProps, 'SessionProvider' | 'renderSlot' | 'mountView' | 'width' | 'viewportWidth' | 'canShow' | 'onPresentation'>
  & { readonly view: SidebarSessionViewSnapshot; readonly visible: boolean }) {
  useLayoutEffect(() => mountView(view.reference), [mountView, view.reference])
  const active = visible && view.selected
  return <div className={css.session} hidden={!active} data-sidebar-right-session={view.sessionId}>
    <SessionProvider session={view.reference}>
      {renderSlot('rightbar.session', { width, viewportWidth, canShow, active, retainTab: view.retainTab, onPresentation })}
    </SessionProvider>
  </div>
}

/**
 * Keep independent Session subtrees and hide those outside the selected Conversation.
 * @param props - frame geometry, view targets and the authorized Session renderer.
 * @returns the foreground and retained background Sidebars.
 */
export function RightbarRoot({ usePanelInfo, useViews, useEmbedded, placement, target, present, ...props }: RootProps) {
  const mainVisible = usePanelInfo(info => info.activePanelId === null)
  const embedded = useEmbedded(value => value)
  const views = useViews(value => value)
  useLayoutEffect(() => placement === 'embedded' ? present(target) : undefined, [placement, target, present])
  const visible = placement === 'embedded' ? embedded !== null && embedded.sessionId === target : mainVisible && embedded === null
  const ownedViews = placement === 'embedded'
    ? views.filter(view => embedded !== null && embedded.sessionId === target && view.sessionId === target)
    : views.filter(view => view.sessionId !== embedded?.sessionId)
  return <>{ownedViews.map(view => <SessionView key={view.sessionId} {...props} view={view} visible={visible} />)}</>
}
