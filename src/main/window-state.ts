/** Window size/position persistence. The resolution logic is pure and unit tested. */

export type Rect = { x: number; y: number; width: number; height: number };

export type WindowState = {
  bounds: Rect | null;
  maximized: boolean;
};

export const DEFAULT_WINDOW_SIZE = { width: 1400, height: 960 };
export const MIN_WINDOW_SIZE = { width: 1100, height: 720 };
/** At least this much of the title bar must be on a screen for saved bounds to be reused. */
const MIN_VISIBLE = 120;

export function parseWindowState(raw: unknown): WindowState {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const bounds = candidate.bounds as Record<string, unknown> | undefined;
  const valid =
    bounds &&
    ['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key] as number));
  return {
    bounds: valid ? { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number } : null,
    maximized: candidate.maximized === true
  };
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  };
}

/**
 * Returns saved bounds when they are still usable on the current displays,
 * clamped to the work area; otherwise null (let the OS center the window).
 * Handles monitors being unplugged or resolution changes.
 */
export function resolveWindowBounds(saved: Rect | null, workAreas: readonly Rect[]): Rect | null {
  if (!saved || workAreas.length === 0) {
    return null;
  }

  const titleBar: Rect = { x: saved.x, y: saved.y, width: saved.width, height: 48 };
  const display = workAreas.find((area) => {
    const visible = overlap(titleBar, area);
    return visible.width >= MIN_VISIBLE && visible.height > 0;
  });
  if (!display) {
    return null;
  }

  const width = Math.max(MIN_WINDOW_SIZE.width, Math.min(saved.width, display.width));
  const height = Math.max(MIN_WINDOW_SIZE.height, Math.min(saved.height, display.height));
  const x = Math.min(Math.max(saved.x, display.x), display.x + display.width - Math.min(width, display.width));
  const y = Math.min(Math.max(saved.y, display.y), display.y + display.height - Math.min(height, display.height));
  return { x, y, width, height };
}
