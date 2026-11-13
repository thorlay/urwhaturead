import { useCallback } from 'react'

type UseReaderViewActionsParams = {
  closeReader: () => void
  enterImmersiveReader: () => void
  finalizeReaderSession: (reason: 'close' | 'navigate') => void
}

export function useReaderViewActions({
  closeReader,
  enterImmersiveReader,
  finalizeReaderSession,
}: UseReaderViewActionsParams) {
  const openImmersiveReader = useCallback(() => {
    enterImmersiveReader()
  }, [enterImmersiveReader])

  const returnToReaderStream = useCallback(() => {
    finalizeReaderSession('close')
    closeReader()
  }, [finalizeReaderSession, closeReader])

  return {
    openImmersiveReader,
    returnToReaderStream,
  }
}
