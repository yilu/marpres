export const SLIDE_WIDTH = 1280
export const SLIDE_HEIGHT = 720

/** Slide-space points are numeric and remain inside the visible viewport. */
export function boundPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return { x: Math.max(0, Math.min(SLIDE_WIDTH, point.x)), y: Math.max(0, Math.min(SLIDE_HEIGHT, point.y)) }
}

function segmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSquared)) : 0
  return (point.x - start[0] - t * dx) ** 2 + (point.y - start[1] - t * dy) ** 2
}

/** Whether the eraser disk touches any segment, including a single-point tap. */
export function hitStroke(stroke, point, radius = 18) {
  const bounded = boundPoint(point)
  if (!bounded || bounded.x !== point.x || bounded.y !== point.y || !Number.isFinite(radius) || radius < 0) return false
  const points = stroke?.points
  const width = stroke?.width ?? 0
  if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(width) || width < 0) return false
  if (!points.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false
  const threshold = (radius + width / 2) ** 2
  if (points.length === 1) return segmentDistanceSquared(point, points[0], points[0]) <= threshold
  for (let i = 1; i < points.length; i++) {
    if (segmentDistanceSquared(point, points[i - 1], points[i]) <= threshold) return true
  }
  return false
}
