import { useAppStateData } from './use-app-state-data'
import { useAppStateRefs } from './use-app-state-refs'
import { useAppStateRequest } from './use-app-state-request'
import { useAppStateUI } from './use-app-state-ui'

export function useAppState() {
  const refs = useAppStateRefs()
  const data = useAppStateData()
  const request = useAppStateRequest()
  const ui = useAppStateUI()

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
