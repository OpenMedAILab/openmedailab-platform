import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("project modal uses an in-modal toast instead of the global page toast", () => {
  assert.match(mainSource, /<div v-if="state\.toast && !state\.preview\.open" class="toast">/);
  assert.match(mainSource, /<div v-if="state\.toast" class="toast modal-toast">/);
  assert.match(stylesSource, /\.project-modal\s*\{[^}]*position:\s*relative;/s);
  assert.match(stylesSource, /\.modal-toast\s*\{[^}]*position:\s*absolute;/s);
});

test("theme space navigation closes an open project preview modal", () => {
  assert.match(
    mainSource,
    /function selectSpace\(slug\)\s*\{\s*if \(state\.preview\.open\) \{\s*state\.preview\.open = false;\s*state\.preview\.maximized = false;\s*\}\s*navigate\("space", \{ slug \}\);/s
  );
});

test("profile menu action clicks blur the focused button after closing", () => {
  const blurCalls = mainSource.match(/\$event\.currentTarget\.blur\(\)/g) || [];
  assert.equal(blurCalls.length, 3);
});

test("topbar wraps into centered rows before it overflows", () => {
  assert.match(stylesSource, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?justify-items:\s*center;/);
  assert.match(stylesSource, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*?\.main-nav,\s*\.account-area\s*\{[\s\S]*?justify-content:\s*center;[\s\S]*?flex-wrap:\s*wrap;/);
  assert.doesNotMatch(stylesSource, /@media \(max-width:\s*980px\)\s*\{[\s\S]*?\.main-nav,\s*\.account-area\s*\{[\s\S]*?overflow-x:\s*auto;/);
});

test("project modal and detail header have small-screen overflow guards", () => {
  assert.match(stylesSource, /\.project-modal\s*\{[\s\S]*?width:\s*min\(1120px,\s*calc\(100vw - 32px\)\);/);
  assert.match(stylesSource, /\.project-modal-header h2\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /\.detail-header h1[\s\S]*?\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.project-modal-backdrop\s*\{[\s\S]*?padding:\s*8px;/);
});

test("small-screen tab and chip rows wrap instead of hiding content horizontally", () => {
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.theme-strip,\s*\.admin-tabs\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow:\s*visible;/);
  assert.match(stylesSource, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.theme-chip,\s*\.admin-tabs button\s*\{[\s\S]*?flex:\s*0 1 auto;/);
});
