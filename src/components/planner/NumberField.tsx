import { useEffect, useState } from 'react'

interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  /** Displayed value = stored value × scale (e.g. 100 for a clock shown in %). */
  scale?: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
  title?: string
  width?: number
}

/**
 * Compact number input for node cards. Keeps the typed text while editing and
 * only reports valid numbers inside [min, max], so half-typed values like "1."
 * don't reset the plan. `nodrag` keeps React Flow from dragging the node.
 */
export function NumberField({
  value,
  onChange,
  scale = 1,
  min = 0,
  max = Infinity,
  step,
  suffix,
  disabled,
  title,
  width = 64,
}: NumberFieldProps) {
  const shown = Number((value * scale).toFixed(4)).toString()
  const [text, setText] = useState(shown)

  // Follow outside changes (e.g. undo, recipe switch) unless mid-edit.
  useEffect(() => setText(shown), [shown])

  return (
    <label className="pn-num nodrag" title={title}>
      <input
        type="number"
        value={text}
        min={min * scale}
        max={Number.isFinite(max) ? max * scale : undefined}
        step={step}
        disabled={disabled}
        style={{ width }}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value) / scale
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(v)
        }}
        onBlur={() => setText(shown)}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  )
}
