/**
 * Check if a point (mouseY) is within tolerance pixels of a horizontal line's Y coordinate.
 */
export function hitTestHLine(mouseY: number, lineY: number, tolerance = 5): boolean {
  return Math.abs(mouseY - lineY) <= tolerance;
}

/**
 * Shortest distance from point (px, py) to line segment (a → b).
 */
function pointToSegmentDistance(
  px: number, py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * Check if a point (mx, my) is near any segment of an arrow path polyline.
 * Points are in CSS coordinates.
 */
export function hitTestArrowPath(
  mx: number,
  my: number,
  points: { x: number; y: number }[],
  tolerance = 5,
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (pointToSegmentDistance(mx, my, points[i], points[i + 1]) <= tolerance) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a point (mx, my) is inside a rectangle defined by two corners.
 */
export function hitTestRect(
  mx: number, my: number,
  x1: number, y1: number,
  x2: number, y2: number,
  tolerance = 0,
): boolean {
  const left = Math.min(x1, x2) - tolerance;
  const right = Math.max(x1, x2) + tolerance;
  const top = Math.min(y1, y2) - tolerance;
  const bottom = Math.max(y1, y2) + tolerance;
  return mx >= left && mx <= right && my >= top && my <= bottom;
}

/**
 * Check if a point (mx, my) is near the perimeter of an ellipse.
 * cx, cy = ellipse center; rx, ry = radii.
 */
export function hitTestOval(
  mx: number,
  my: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tolerance = 6,
): boolean {
  if (rx < 1 || ry < 1) return false;
  // Normalized distance from center
  const nx = (mx - cx) / rx;
  const ny = (my - cy) / ry;
  const d = Math.sqrt(nx * nx + ny * ny);
  // On perimeter when normalized distance ≈ 1
  return Math.abs(d - 1.0) < tolerance / Math.min(rx, ry);
}
