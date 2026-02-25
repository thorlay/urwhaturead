import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ReaderView } from '../lib/app-domain'

type UseReaderViewActionsParams = {
  streamScrollYRef: MutableRefObject<number | null>
  setReaderView: Dispatch<SetStateAction<ReaderView>>
  setShowFloatingReader: Dispatch<SetStateAction<boolean>>
  finalizeReaderSession: (reason: 'close' | 'navigate') => void
}

export function useReaderViewActions({
  streamScrollYRef,
  setReaderView,
  setShowFloatingReader,
  finalizeReaderSession,
}: UseReaderViewActionsParams) {
  const openImmersiveReader = useCallback(() => {
    streamScrollYRef.current = window.scrollY
    setReaderView('detail')
    setShowFloatingReader(false)
  }, [setReaderView, setShowFloatingReader, streamScrollYRef])

  const returnToReaderStream = useCallback(() => {
    finalizeReaderSession('close')
    setReaderView('stream')
    setShowFloatingReader(false)
    const targetY = streamScrollYRef.current
    if (targetY === null) return
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: targetY, behavior: 'auto' })
    })
  }, [finalizeReaderSession, setReaderView, setShowFloatingReader, streamScrollYRef])

  return {
    openImmersiveReader,
    returnToReaderStream,
  }
}
