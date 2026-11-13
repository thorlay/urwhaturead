import { useFeedQuery } from './use-feed-query'
import { useAppStateData } from './use-app-state-data'
import { useAppStateRefs } from './use-app-state-refs'
import { useAppStateRequest } from './use-app-state-request'
import { useAppStateUI } from './use-app-state-ui'

export function useAppState() {
  const feedQuery = useFeedQuery()
  const ui = useAppStateUI()
  const refs = useAppStateRefs(ui)
  const data = useAppStateData(ui, feedQuery)
  const request = useAppStateRequest(ui, feedQuery)

  return {
    ...refs,
    ...data,
    ...request,
    ...ui,
    refs,
    data,
    request,
    ui,
  }
}
