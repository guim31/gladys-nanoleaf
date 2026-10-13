// -----------------------------------------------------------------------------
// The live event stream of one controller: `GET /api/v1/<token>/events?id=…`,
// server-sent events. Each message carries the event type in its `id:` line
// (1 state, 2 layout, 3 effects, 4 touch gestures) and a JSON `data:` line
// `{ "events": [ … ] }`.
//
// The container opens the connection (unicast, outbound): it crosses the
// Docker bridge, unlike the UDP touch stream of the OpenAPI, which the
// controller would send to an address it cannot reach.
//
// The stream reconnects by itself with a growing delay. A closed stream is
// not a lost device: the hub's periodic read decides that.
// -----------------------------------------------------------------------------

export const STREAM_TIMINGS = {
  retryMinMs: 5_000,
  retryMaxMs: 60_000,
};

/**
 * Split a server-sent events buffer into complete messages.
 * @returns {{ messages: Array<{ id: string|null, data: string }>, rest: string }}
 */
export function parseSse(buffer) {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop();
  const messages = [];
  for (const block of blocks) {
    let id = null;
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) {
        continue; // comment / keep-alive
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (field === 'id') {
        id = value.trim();
      } else if (field === 'data') {
        data.push(value);
      }
    }
    if (data.length > 0) {
      messages.push({ id, data: data.join('\n') });
    }
  }
  return { messages, rest };
}

/**
 * `{ type, events }` of one message, or null when it is not a Nanoleaf event.
 */
export function decodeMessage({ id, data }) {
  const type = Number(id);
  if (id === null || !Number.isInteger(type) || type < 1) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const events = Array.isArray(parsed?.events) ? parsed.events.filter(Boolean) : [];
  return events.length > 0 ? { type, events } : null;
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export class EventStream {
  /**
   * @param {object} options
   * @param {object} options.client NanoleafClient
   * @param {() => object} options.target `{ host, port, token }`, read at each connection
   * @param {number[]} options.types event types to subscribe to
   * @param {(event: { type: number, events: object[] }) => void} options.onEvent
   * @param {() => void} [options.onOpen]
   * @param {(err: Error|null) => void} [options.onClose] closed (null: by the controller)
   * @param {(err: Error) => void} [options.onUnauthorized] the token is refused: the stream stops
   * @param {object} [options.timings] STREAM_TIMINGS overrides
   */
  constructor({ client, target, types, onEvent, onOpen, onClose, onUnauthorized, timings }) {
    this.client = client;
    this.target = target;
    this.types = types;
    this.onEvent = onEvent;
    this.onOpen = onOpen ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.onUnauthorized = onUnauthorized ?? (() => {});
    this.timings = { ...STREAM_TIMINGS, ...timings };
    this.controller = null;
    this.running = null;
    this.open = false;
  }

  start() {
    if (this.running) {
      return this.running;
    }
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.running = this.loop(signal).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Stops the stream; resolves once the connection is closed. */
  async stop() {
    this.controller?.abort();
    await this.running;
  }

  async loop(signal) {
    let delay = this.timings.retryMinMs;
    while (!signal.aborted) {
      try {
        const response = await this.client.openEvents(this.target(), this.types, signal);
        this.open = true;
        delay = this.timings.retryMinMs;
        this.onOpen();
        await this.read(response.body, signal);
        this.open = false;
        if (!signal.aborted) {
          this.onClose(null);
        }
      } catch (err) {
        this.open = false;
        if (signal.aborted) {
          break;
        }
        if (err?.kind === 'unauthorized') {
          this.onUnauthorized(err);
          break;
        }
        this.onClose(err);
      }
      if (signal.aborted) {
        break;
      }
      await sleep(delay, signal);
      delay = Math.min(delay * 2, this.timings.retryMaxMs);
    }
  }

  async read(body, signal) {
    const decoder = new TextDecoder();
    let buffer = '';
    const reader = body.getReader();
    const cancel = () => reader.cancel().catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const { messages, rest } = parseSse(buffer);
        // A message is a few hundred bytes: a buffer this big is not SSE.
        buffer = rest.length > 65_536 ? '' : rest;
        for (const message of messages) {
          const event = decodeMessage(message);
          if (event) {
            this.onEvent(event);
          }
        }
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
}
