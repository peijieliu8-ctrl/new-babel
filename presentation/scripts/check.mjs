import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('src/slides.js', root), 'utf8'), context);
const slides = context.window.NEW_BABEL_SLIDES;
assert.equal(slides.length, 13, 'The keynote must contain 13 slides, numbered 00–12.');
assert.deepEqual(Array.from(slides, slide => slide.id), ['team', 'cover', 'promo', 'story', 'loss', 'problem', 'reveal', 'flow', 'knowledge', 'quest', 'demo', 'now', 'vision']);
assert.equal(new Set(slides.map(slide => slide.id)).size, slides.length, 'Slide hash IDs must be unique.');
for (const slide of slides) {
  assert.match(slide.id, /^[a-z][a-z-]+$/);
  for (const key of ['scene', 'chapter', 'title', 'html', 'notes']) assert.ok(slide[key]?.trim(), `${slide.id}: missing ${key}`);
  assert.ok(!/\b(?:src|href)=["'](?:javascript:|https?:\/\/[^"']+\.js)/i.test(slide.html), `${slide.id}: unsafe or remote script dependency`);
}
const index = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('src/deck.css', root), 'utf8');
const references = [...index.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1]);
for (const slide of slides) {
  for (const match of slide.html.matchAll(/(?:src|poster)="([^"#]+)"/g)) references.push(match[1]);
}
for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
  if (!match[1].startsWith('data:')) references.push(`src/${match[1]}`);
}
for (const reference of references) {
  assert.ok(!/^https?:/.test(reference), `Runtime asset must be local: ${reference}`);
  await access(new URL(reference, root));
}
assert.match(slides.find(slide => slide.id === 'demo').html, /data-demo-link/);
assert.match(slides[0].html, /assets\/team-introduction\.png/);
assert.match(slides[2].html, /<video\b[^>]*\bcontrols\b/);
assert.match(slides[2].html, /assets\/new-babel-promo\.mp4/);
assert.doesNotMatch(slides[2].html, /\bautoplay\b/);
await access(new URL('assets/vendor/REVEAL-LICENSE', root));
console.log(`PASS: ${slides.length} complete slides, unique hash IDs, local assets and demo link.`);
