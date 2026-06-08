function normalizeRect(rect) {
  if (!rect) return null;
  const { left, right, top, bottom } = rect;
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom };
}

function containsPoint(rect, point, padding = 2) {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

function bridgeRect(menuRect, popoverRect) {
  if (!menuRect || !popoverRect) return null;
  const top = Math.min(menuRect.bottom, popoverRect.top);
  const bottom = Math.max(menuRect.bottom, popoverRect.top);
  if (bottom <= top) return null;
  return {
    left: Math.min(menuRect.left, popoverRect.left),
    right: Math.max(menuRect.right, popoverRect.right),
    top,
    bottom
  };
}

export function isPointInsideProfileHoverZone(point, menuRect, popoverRect) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;

  const menu = normalizeRect(menuRect);
  const popover = normalizeRect(popoverRect);
  const zones = [menu, popover, bridgeRect(menu, popover)].filter(Boolean);
  return zones.some((zone) => containsPoint(zone, point));
}
