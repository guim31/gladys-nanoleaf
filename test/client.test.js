import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NanoleafClient } from '../src/nanoleaf/client.js';
import { EventStream, decodeMessage, parseSse } from '../src/nanoleaf/events.js';
import { normalizeDeviceId, parseMdnsResults, parseSsdpResults } from '../src/discovery.js';
import { FakeNanoleaf, createNetwork } from './helpers/fakeNanoleaf.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const target = { host: '192.0.2.10', port: 16021, token: TOKEN };

function clientFor(device) {
  const network = createNetwork([device]);
  return new NanoleafClient({ fetch: network.fetch, timings: { requestTimeoutMs: 200 } });
}

test('client: pairing gives a token only in pairing mode', async () => {
  const device = new FakeNanoleaf('shapes-hexagons-nl42-9.6.3', '192.0.2.10');
  const client = clientFor(device);
  await assert.rejects(client.pair(target), { kind: 'not-pairing' });
  device.holdPowerButton();
  const token = await client.pair(target);
  assert.match(token, /^[A-Za-z0-9]{32}$/);
  const info = await client.getInfo({ ...target, token });
  assert.equal(info.serialNo, 'S20283H0003');
});

test('client: a refused token, an unknown effect, an absent controller', async () => {
  const device = new FakeNanoleaf('shapes-hexagons-nl42-9.6.3', '192.0.2.10', { token: TOKEN });
  const client = clientFor(device);
  await assert.rejects(client.getInfo({ ...target, token: 'wrongwrongwrong1' }), {
    kind: 'unauthorized',
  });
  await assert.rejects(client.selectEffect(target, 'Disco'), { kind: 'not-found' });
  await client.selectEffect(target, 'Prism');
  assert.equal(device.data.effects.select, 'Prism');
  await client.setState(target, { on: { value: false } });
  assert.equal(device.state.on.value, false);
  await client.identify(target);
  device.setOnline(false);
  const err = await client.getInfo(target).catch((error) => error);
  assert.equal(err.kind, 'unreachable');
  assert.equal(err.unreachable, true);
  assert.equal(err.message, '192.0.2.10 does not answer (EHOSTUNREACH)');
});

test('client: an error message never quotes the URL, which holds the token', async () => {
  const client = new NanoleafClient({
    fetch: async (url) => {
      throw new Error(`connect failed for ${url}`);
    },
  });
  const err = await client.getInfo(target).catch((error) => error);
  assert.ok(!err.message.includes(TOKEN), err.message);
  assert.match(err.message, /<url>/);
  const answer = new NanoleafClient({
    fetch: async () => new Response('{}', { status: 200 }),
  });
  await assert.rejects(answer.pair(target), { kind: 'invalid' });
});

test('client: a timeout is an absent controller', async () => {
  const client = new NanoleafClient({
    fetch: (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
    timings: { requestTimeoutMs: 20 },
  });
  // AbortSignal.timeout does not keep the process alive: this does.
  const alive = setTimeout(() => {}, 1000);
  const err = await client.getInfo(target).catch((error) => error);
  clearTimeout(alive);
  assert.equal(err.kind, 'unreachable');
  assert.match(err.message, /\(timeout\)$/);
});

// --- Server-sent events ------------------------------------------------------------

test('sse: messages split anywhere, CRLF, comments, several data lines', () => {
  const first = parseSse('id: 1\ndata: {"events":[{"attr":2,"value":40}]}\n\nid: 3\nda');
  assert.deepEqual(first.messages, [{ id: '1', data: '{"events":[{"attr":2,"value":40}]}' }]);
  assert.equal(first.rest, 'id: 3\nda');
  const second = parseSse(
    `${first.rest}ta: {"events":[{"attr":1,"value":"Prism"}]}\r\n\r\n: ping\n\n`,
  );
  assert.deepEqual(second.messages, [{ id: '3', data: '{"events":[{"attr":1,"value":"Prism"}]}' }]);
  assert.equal(second.rest, '');
  assert.deepEqual(parseSse('data: a\ndata: b\n\n').messages, [{ id: null, data: 'a\nb' }]);
});

test('sse: only Nanoleaf events are decoded', () => {
  assert.deepEqual(decodeMessage({ id: '4', data: '{"events":[{"gesture":1,"panelId":7}]}' }), {
    type: 4,
    events: [{ gesture: 1, panelId: 7 }],
  });
  assert.equal(decodeMessage({ id: null, data: '{"events":[{}]}' }), null);
  assert.equal(decodeMessage({ id: '1', data: 'not json' }), null);
  assert.equal(decodeMessage({ id: '1', data: '{"events":[]}' }), null);
});

test('stream: events flow, the stream reopens after a cut, and stops for good', async () => {
  const device = new FakeNanoleaf('canvas-nl29-9.2.3', '192.0.2.10', { token: TOKEN });
  const client = clientFor(device);
  const seen = [];
  let opened = 0;
  let closed = 0;
  const stream = new EventStream({
    client,
    target: () => target,
    types: [1, 3, 4],
    timings: { retryMinMs: 1, retryMaxMs: 2 },
    onEvent: (event) => seen.push(event),
    onOpen: () => {
      opened += 1;
    },
    onClose: () => {
      closed += 1;
    },
  });
  stream.start();
  const until = async (condition) => {
    for (let round = 0; round < 200 && !condition(); round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.ok(condition());
  };
  await until(() => opened === 1);
  device.gesture(5);
  await until(() => seen.length === 1);
  assert.deepEqual(seen[0], { type: 4, events: [{ gesture: 5, panelId: -1 }] });

  device.setOnline(false);
  await until(() => closed >= 1);
  device.setOnline(true);
  await until(() => opened === 2);
  device.changeFromApp({ brightness: 5 });
  await until(() => seen.length === 2);

  await stream.stop();
  assert.equal(device.openStreams(), 0);
  assert.equal(stream.running, null);
});

test('stream: a refused token stops the stream', async () => {
  const device = new FakeNanoleaf('canvas-nl29-9.2.3', '192.0.2.10');
  let refused = 0;
  const stream = new EventStream({
    client: clientFor(device),
    target: () => target,
    types: [1],
    onEvent: () => {},
    onUnauthorized: () => {
      refused += 1;
    },
  });
  await stream.start();
  assert.equal(refused, 1);
});

// --- Discovery ------------------------------------------------------------------------

test('discovery: mDNS answers, IPv4 only, with their id and model', () => {
  const shapes = new FakeNanoleaf('shapes-hexagons-nl42-9.6.3', '192.0.2.10');
  const ipv6Only = { ...shapes.mdnsResult(), addresses: ['fe80::2'] };
  assert.deepEqual(parseMdnsResults([shapes.mdnsResult(), ipv6Only, null]), [
    {
      host: '192.0.2.10',
      port: 16021,
      deviceId: shapes.deviceId,
      name: 'Shapes 7D21',
      model: 'NL42',
    },
  ]);
  assert.deepEqual(parseMdnsResults(undefined), []);
});

test('discovery: SSDP answers of the Light Panels, other devices ignored', () => {
  const panels = new FakeNanoleaf('light-panels-nl22-3.0.6', '192.0.2.11');
  const router = {
    source_ip: '192.0.2.1',
    headers:
      'HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nLocation: http://192.0.2.1:5000/desc.xml\r\n',
  };
  const noLocation = { ...panels.ssdpResult(), headers: 'ST: nanoleaf_aurora:light\r\n' };
  assert.deepEqual(parseSsdpResults([panels.ssdpResult(), router, noLocation]), [
    {
      host: '192.0.2.11',
      port: 16021,
      deviceId: panels.deviceId,
      name: 'Light Panels 0A:1B:2C',
      model: null,
    },
    { host: '192.0.2.11', port: 16021, deviceId: null, name: null, model: null },
  ]);
  assert.equal(normalizeDeviceId(' AB:CD:EF:01:02:03 '), 'ab:cd:ef:01:02:03');
  assert.equal(normalizeDeviceId('<script>'), null);
});
