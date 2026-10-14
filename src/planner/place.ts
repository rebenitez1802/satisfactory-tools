// Where to put a node added next to another one: beside it with a gap, then
// stepped down until it doesn't overlap anything already on the canvas.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: Rect, b: Rect, margin: number) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin

export function placeBeside(
  anchor: Rect,
  side: 'left' | 'right',
  size: { w: number; h: number },
  others: Rect[],
  gap = 80,
): { x: number; y: number } {
  const x = side === 'right' ? anchor.x + anchor.w + gap : anchor.x - size.w - gap
  let y = anchor.y
  for (let i = 0; i < 100; i++) {
    const r = { x, y, w: size.w, h: size.h }
    const hit = others.find((o) => overlaps(r, o, 20))
    if (!hit) break
    y = hit.y + hit.h + 30
  }
  return { x, y }
}
