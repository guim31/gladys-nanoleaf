// -----------------------------------------------------------------------------
// Fake Nanoleaf controllers on a fake network: a `fetch` that routes the
// OpenAPI requests to them, and the raw mDNS / SSDP results the Gladys core
// would relay. No socket, no timer: the event streams are ReadableStreams fed
// by `emit()`.
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/nanoleaf/', import.meta.url);

export const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

export const loadFixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES)));

const encoder = new TextEncoder();
let tokenCounter = 0;

export class FakeNanoleaf {
  /**
   * @param {string} fixture file name in test/fixtures/nanoleaf, without .json
   * @param {string} host
   * @param {object} [options] `{ port, deviceId, token }` (`token`: already paired with it)
   */
  constructor(fixture, host, { port = 16021, deviceId, token } = {}) {
    this.fixture = fixture;
    this.data = loadFixture(fixture);
    this.host = host;
    this.port = port;
    this.deviceId =
      deviceId ??
      `0a:1b:2c:3d:${this.data.serialNo.slice(-4, -2)}:${this.data.serialNo.slice(-2)}`.toLowerCase();
    this.tokens = new Set(token ? [token] : []);
    this.pairing = false;
    this.online = true;
    // An HTTP status every authenticated request answers (a firmware in trouble).
    this.failWith = null;
    // A model without touch that refuses a subscription to the gestures.
    this.refuseTouch = false;
    /** @type {Array<{ method: string, path: string, body: unknown }>} paths without the token */
    this.requests = [];
    this.streams = new Set();
  }

  get serialNo() {
    return this.data.serialNo;
  }

  get state() {
    return this.data.state;
  }

  /** What the core relays from an mDNS browse. */
  mdnsResult() {
    return {
      name: `${this.data.name}._nanoleafapi._tcp.local`,
      host: `${this.data.name.replace(/[^A-Za-z0-9]+/g, '-')}.local`,
      addresses: [this.host, 'fe80::1'],
      port: this.port,
      txt: [
        `id=${this.deviceId.toUpperCase()}`,
        `md=${this.data.model}`,
        `srcvers=${this.data.firmwareVersion}`,
      ],
    };
  }

  /** What the core relays from an SSDP search (old Light Panels). */
  ssdpResult() {
    return {
      source_ip: this.host,
      source_port: 1900,
      headers: [
        'HTTP/1.1 200 OK',
        'Cache-Control: max-age=60',
        'ST: nanoleaf_aurora:light',
        `USN: uuid:00000000-0000-0000-0000-${this.data.serialNo.padStart(12, '0').slice(-12)}`,
        `Location: http://${this.host}:${this.port}`,
        `nl-deviceid: ${this.deviceId.toUpperCase()}`,
        `nl-devicename: ${this.data.name}`,
        '',
      ].join('\r\n'),
    };
  }

  /** The power button held 5 seconds: the next POST /new gives a token. */
  holdPowerButton() {
    this.pairing = true;
  }

  /** Factory reset, or token deleted: every token is refused. */
  forgetTokens() {
    this.tokens.clear();
  }

  /** Unplugged (online false) or back. */
  setOnline(online) {
    this.online = online;
    if (!online) {
      for (const stream of this.streams) {
        stream.controller.error(new TypeError('terminated'));
      }
      this.streams.clear();
    }
  }

  /** Push one server-sent event to the open streams subscribed to `type`. */
  emit(type, events) {
    const chunk = encoder.encode(`id: ${type}\ndata: ${JSON.stringify({ events })}\n\n`);
    for (const stream of this.streams) {
      if (stream.types.includes(type)) {
        stream.controller.enqueue(chunk);
      }
    }
  }

  /** A change made with the Nanoleaf app or the buttons: state and events. */
  changeFromApp(change) {
    const attributes = { on: 1, brightness: 2, hue: 3, sat: 4, ct: 5 };
    const events = [];
    for (const [key, value] of Object.entries(change)) {
      if (key === 'effect') {
        this.data.effects.select = value;
        this.data.state.colorMode = 'effect';
        this.emit(3, [{ attr: 1, value }]);
      } else if (key === 'colorMode') {
        this.data.state.colorMode = value;
        events.push({ attr: 6, value });
      } else {
        this.data.state[key].value = value;
        events.push({ attr: attributes[key], value });
      }
    }
    if (events.length > 0) {
      this.emit(1, events);
    }
  }

  gesture(gesture, panelId = -1) {
    this.emit(4, [{ gesture, panelId }]);
  }

  openStreams() {
    return this.streams.size;
  }

  /** The OpenAPI, from the path after `/api/v1/`. */
  handle(method, path, body, signal) {
    if (path === 'new' && method === 'POST') {
      this.requests.push({ method, path: 'new' });
      if (!this.pairing) {
        return { status: 403 };
      }
      this.pairing = false;
      tokenCounter += 1;
      const token = `FakeToken${String(tokenCounter).padStart(23, '0')}`;
      this.tokens.add(token);
      return { status: 200, json: { auth_token: token } };
    }
    const [token, ...rest] = path.split('/');
    const [resource, query = ''] = rest.join('/').split('?');
    this.requests.push(
      query ? { method, path: resource, query, body } : { method, path: resource, body },
    );
    if (!this.tokens.has(token)) {
      return { status: 401 };
    }
    if (this.failWith) {
      return { status: this.failWith };
    }
    if (method === 'GET' && resource === '') {
      return { status: 200, json: structuredClone(this.data) };
    }
    if (method === 'PUT' && resource === 'state') {
      this.applyState(body);
      return { status: 204 };
    }
    if (method === 'PUT' && resource === 'effects') {
      if (!this.data.effects.effectsList.includes(body?.select)) {
        return { status: 404 };
      }
      this.data.effects.select = body.select;
      this.data.state.colorMode = 'effect';
      this.data.state.on.value = true;
      return { status: 204 };
    }
    if (method === 'PUT' && resource === 'identify') {
      return { status: 204 };
    }
    if (method === 'GET' && resource === 'events') {
      const types = (new URLSearchParams(query).get('id') ?? '').split(',').map(Number);
      if (this.refuseTouch && types.includes(4)) {
        return { status: 400 };
      }
      return { status: 200, stream: this.openStream(types, signal) };
    }
    return { status: 404 };
  }

  applyState(body) {
    const { state } = this.data;
    for (const key of ['brightness', 'hue', 'sat', 'ct']) {
      if (body?.[key]?.value !== undefined) {
        state[key].value = body[key].value;
      }
    }
    if (body?.hue || body?.sat) {
      state.colorMode = 'hs';
      this.data.effects.select = '*Solid*';
    }
    if (body?.ct) {
      state.colorMode = 'ct';
      this.data.effects.select = '*Solid*';
    }
    if (body?.on) {
      state.on.value = body.on.value;
    }
  }

  openStream(types, signal) {
    const entry = { types, controller: null };
    const stream = new ReadableStream({
      start: (controller) => {
        entry.controller = controller;
      },
      cancel: () => {
        this.streams.delete(entry);
      },
    });
    this.streams.add(entry);
    signal?.addEventListener(
      'abort',
      () => {
        this.streams.delete(entry);
        try {
          entry.controller.error(new DOMException('aborted', 'AbortError'));
        } catch {
          // already closed
        }
      },
      { once: true },
    );
    return stream;
  }
}

/**
 * The network of the fake controllers: its `fetch`, and the raw scan
 * results.
 */
export function createNetwork(devices) {
  const find = (host, port) =>
    devices.find((device) => device.host === host && device.port === port && device.online);
  async function fakeFetch(url, init = {}) {
    await Promise.resolve();
    if (init.signal?.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const parsed = new URL(url);
    const device = find(parsed.hostname, Number(parsed.port || 80));
    if (!device) {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    }
    const path = `${parsed.pathname.replace(/^\/api\/v1\//, '')}${parsed.search}`;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const answer = device.handle(init.method ?? 'GET', path, body, init.signal);
    if (answer.stream) {
      return new Response(answer.stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (answer.json !== undefined) {
      return new Response(JSON.stringify(answer.json), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: answer.status });
  }
  return {
    devices,
    fetch: fakeFetch,
    mdnsResults: () =>
      devices
        .filter((device) => device.online && device.data.model !== 'NL22')
        .map((device) => device.mdnsResult()),
    ssdpResults: () =>
      devices
        .filter((device) => device.online && device.data.model === 'NL22')
        .map((device) => device.ssdpResult()),
  };
}
