import assert from "node:assert/strict";
import { test } from "node:test";

import { isPointInsideProfileHoverZone } from "./profileMenu.js";

test("profile hover zone keeps the popover open while moving from trigger to popover", () => {
  const menuRect = { left: 1500, right: 1710, top: 24, bottom: 84 };
  const popoverRect = { left: 1280, right: 1820, top: 108, bottom: 490 };

  assert.equal(isPointInsideProfileHoverZone({ x: 1660, y: 56 }, menuRect, popoverRect), true);
  assert.equal(isPointInsideProfileHoverZone({ x: 1500, y: 96 }, menuRect, popoverRect), true);
  assert.equal(isPointInsideProfileHoverZone({ x: 1500, y: 220 }, menuRect, popoverRect), true);
  assert.equal(isPointInsideProfileHoverZone({ x: 1180, y: 96 }, menuRect, popoverRect), false);
  assert.equal(isPointInsideProfileHoverZone({ x: 1840, y: 520 }, menuRect, popoverRect), false);
});
