import { Component, type ReactNode, type RefObject } from 'react'

type Props = {
  listRef: RefObject<HTMLDivElement | null>
  className: string
  split: boolean
  selection: string | null
  children: ReactNode
}

type Anchor = { key: string; top: number }

export class ReaderFeedViewport extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): Anchor | null {
    const { listRef, split, selection } = this.props
    const list = listRef.current
    if (!list || previous.split === split || !desktop()) return null

    const key = split ? selection : previous.selection
    const row = findRow(list, key)?.getBoundingClientRect()
    const viewport = list.getBoundingClientRect()
    // Measure the same row before and after React changes the column layout.
    return key && row && row.bottom > viewport.top && row.top < viewport.bottom
      ? { key, top: row.top }
      : null
  }

  componentDidUpdate(previous: Props, _state: unknown, anchor: Anchor | null) {
    const { listRef, split, selection } = this.props
    const list = listRef.current
    if (!list || !desktop()) return
    if (!anchor && (!split || (previous.split === split && previous.selection === selection))) return

    const element = findRow(list, anchor?.key ?? selection)
    if (!element) return
    const row = element.getBoundingClientRect()
    const top = list.getBoundingClientRect().top + list.clientTop
    const bottom = top + list.clientHeight
    if (anchor) {
      const target = Math.max(top, Math.min(anchor.top, bottom - row.height))
      list.scrollTop += row.top - target
    } else if (row.bottom <= top) {
      list.scrollTop += row.top - top
    } else if (row.top >= bottom) {
      list.scrollTop += row.top - bottom + Math.min(row.height, list.clientHeight)
    }
  }

  render() {
    return <div ref={this.props.listRef} className={this.props.className}>{this.props.children}</div>
  }
}

function desktop() {
  return window.matchMedia('(min-width: 981px)').matches
}

function findRow(list: HTMLDivElement, key: string | null) {
  return key === null ? null : list.querySelector<HTMLElement>(`[data-feed-row="${CSS.escape(key)}"]`)
}
