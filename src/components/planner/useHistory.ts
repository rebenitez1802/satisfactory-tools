import { useCallback, useReducer } from 'react'

// Undo/redo over immutable values. Rapid edits with the same `coalesce` key
// (typing in a field, dragging a slider) fold into one undo step.

const LIMIT = 100
const COALESCE_MS = 1000

interface State<T> {
  past: T[]
  present: T
  future: T[]
  lastKey?: string
  lastAt: number
}

type Action<T> =
  | { type: 'set'; next: T | ((prev: T) => T); coalesce?: string; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T }

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'set': {
      const next = typeof action.next === 'function' ? (action.next as (p: T) => T)(state.present) : action.next
      if (next === state.present) return state
      const fold = action.coalesce !== undefined && action.coalesce === state.lastKey && action.at - state.lastAt < COALESCE_MS
      return {
        past: fold ? state.past : [...state.past, state.present].slice(-LIMIT),
        present: next,
        future: [],
        lastKey: action.coalesce,
        lastAt: action.at,
      }
    }
    case 'undo':
      if (!state.past.length) return state
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        lastAt: 0,
      }
    case 'redo':
      if (!state.future.length) return state
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        lastAt: 0,
      }
    case 'reset':
      return { past: [], present: action.value, future: [], lastAt: 0 }
  }
}

export interface History<T> {
  value: T
  set: (next: T | ((prev: T) => T), coalesce?: string) => void
  undo: () => void
  redo: () => void
  reset: (value: T) => void
  canUndo: boolean
  canRedo: boolean
}

export function useHistory<T>(initial: () => T): History<T> {
  const [state, dispatch] = useReducer(reducer<T>, undefined, () => ({ past: [], present: initial(), future: [], lastAt: 0 }))
  const set = useCallback(
    (next: T | ((prev: T) => T), coalesce?: string) => dispatch({ type: 'set', next, coalesce, at: Date.now() }),
    [],
  )
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const reset = useCallback((value: T) => dispatch({ type: 'reset', value }), [])
  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}
