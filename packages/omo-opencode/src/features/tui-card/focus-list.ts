export type FocusListState = {
  readonly index: number
  readonly count: number
}

export function clampFocus(index: number, count: number): number {
  if (count <= 0) return 0
  if (index < 0) return 0
  if (index > count - 1) return count - 1
  return index
}

export function moveFocus(state: FocusListState, delta: number): FocusListState {
  return { index: clampFocus(state.index + delta, state.count), count: state.count }
}

export type FocusList = {
  current: () => number
  move: (delta: number) => boolean
  reseat: (count: number) => void
  reset: () => void
  seek: (index: number) => void
}

export function createFocusList(count: number): FocusList {
  let index = clampFocus(0, count)
  let size = count
  return {
    current: () => index,
    move: (delta: number): boolean => {
      const next = clampFocus(index + delta, size)
      if (next === index) return false
      index = next
      return true
    },
    reseat: (count: number): void => {
      size = count
      index = clampFocus(index, count)
    },
    reset: (): void => {
      index = clampFocus(0, size)
    },
    seek: (target: number): void => {
      index = clampFocus(target, size)
    },
  }
}
