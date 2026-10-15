import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createStaticServer } from './serve.mjs';

const video = await readFile(new URL('../assets/new-babel-promo.mp4', import.meta.url));
const server = createStaticServer();
let origin;
before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
const requestVideo = options => fetch(`${origin}/assets/new-babel-promo.mp4`, options);

test('video GET and HEAD expose MP4 metadata and identical content length', async () => {
  const head = await requestVideo({ method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'video/mp4');
  assert.equal(head.headers.get('content-length'), String(video.length));
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const response = await requestVideo();
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), video);
});

test('seeking returns the exact requested bytes for bounded, open and suffix ranges', async () => {
  for (const [range, start, end] of [
    ['bytes=0-31', 0, 31],
    [`bytes=${video.length - 32}-`, video.length - 32, video.length - 1],
    ['bytes=-32', video.length - 32, video.length - 1],
    [`bytes=${video.length - 8}-${video.length + 99}`, video.length - 8, video.length - 1],
  ]) {
    const response = await requestVideo({ headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${video.length}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), video.subarray(start, end + 1));
  }
});

test('invalid and unsatisfiable ranges return 416 without content', async () => {
  for (const range of [`bytes=${video.length}-`, 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=invalid', 'bytes=9007199254740992-']) {
    const response = await requestVideo({ headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), `bytes */${video.length}`);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test('static pages still load, missing files and write requests are rejected', async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /New Babel/);
  assert.equal((await fetch(`${origin}/missing.mp4`)).status, 404);
  assert.equal((await requestVideo({ method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/node_modules/reveal.js/package.json`)).status, 403);
});
