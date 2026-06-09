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

test("homepage hero title uses the campaign copy with hover and scroll motion guards", () => {
  assert.match(mainSource, /让医学问题，/);
  assert.match(mainSource, /等到它的盖世英雄/);
  assert.match(mainSource, /const heroTitleStyle = computed/);
  assert.match(mainSource, /function updateHeroTitleScrollProgress\(\)/);
  assert.match(mainSource, /"--hero-title-opacity": \(1 - progress \* 0\.72\)\.toFixed\(3\)/);
  assert.match(stylesSource, /\.library-hero \.hero-title\s*\{[\s\S]*?display:\s*block;/);
  assert.match(stylesSource, /\.library-hero \.hero-title:hover\s*\{[\s\S]*?scale\(1\.022\)/);
  assert.match(stylesSource, /\.library-hero \.hero-title\s*\{[\s\S]*?mask-image:\s*linear-gradient/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.library-hero \.hero-title\s*\{[\s\S]*?transition:\s*none;/);
});

test("homepage search toolbar is lifted and visually emphasized", () => {
  assert.match(stylesSource, /\.toolbar\s*\{[\s\S]*?margin:\s*-4px 0 22px;[\s\S]*?padding:\s*16px;[\s\S]*?border-radius:\s*12px;/);
  assert.match(stylesSource, /\.toolbar input,\s*\.toolbar select\s*\{[\s\S]*?min-height:\s*46px;[\s\S]*?border-radius:\s*10px;/);
  assert.match(stylesSource, /\.toolbar \.primary-button\s*\{[\s\S]*?min-height:\s*58px;[\s\S]*?border-radius:\s*10px;/);
});
