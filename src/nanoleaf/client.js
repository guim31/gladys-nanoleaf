// -----------------------------------------------------------------------------
// HTTP client of the Nanoleaf OpenAPI (port 16021, plain HTTP on the LAN).
//
// The container reaches the controllers in unicast, which crosses the Docker
// bridge. The token is part of every URL (`/api/v1/<token>/…`): no error
// message, log line or exception built here ever contains a URL.
// -----------------------------------------------------------------------------

import { NANOLEAF_PORT } from './model.js';

export const CLIENT_TIMINGS = {
  // A controller answers in a few tens of milliseconds on a home network.
  requestTimeoutMs: 5000,
};

/**
 * `kind`: `unreachable` (no answer), `not-pairing` (pairing refused: the
 * controller is not in pairing mode), `unauthorized` (token refused),
 * `not-found` (unknown effect), `http` (another status), `invalid` (not the
 * expected answer).
 */
export class NanoleafError extends Error {
  constructor(kind, message, { status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'NanoleafError';
    this.kind = kind;
    this.status = status;
  }

  get unreachable() {
    return this.kind === 'unreachable';
  }
}

/** "fetch failed (ECONNREFUSED)": the low-level code Node hides in `cause`. */
function reason(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return 'timeout';
  }
  const code = err?.cause?.code;
  // A fetch implementation may quote the URL, and the URL holds the token.
  return code ?? String(err?.message ?? err).replace(/https?:\/\/\S+/g, '<url>');
}

export const hostLabel = ({ host, port = NANOLEAF_PORT }) =>
  port === NANOLEAF_PORT ? host : `${host}:${port}`;

export class NanoleafClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] test seam
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   */
  constructor({ fetch: fetchImpl = globalThis.fetch, timings } = {}) {
    this.fetch = fetchImpl;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
  }

  url({ host, port = NANOLEAF_PORT }, path) {
    return `http://${host}:${port}/api/v1/${path}`;
  }

  async request(target, method, path, body) {
    const label = hostLabel(target);
    let response;
    try {
      response = await this.fetch(this.url(target, path), {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timings.requestTimeoutMs),
      });
    } catch (err) {
      throw new NanoleafError('unreachable', `${label} does not answer (${reason(err)})`, {
        cause: err,
      });
    }
    if (response.ok) {
      return response;
    }
    // Drain the body: the connection goes back to the pool.
    await response.text().catch(() => '');
    const { status } = response;
    if (status === 401) {
      throw new NanoleafError('unauthorized', `${label} refuses the token (HTTP 401)`, { status });
    }
    if (status === 404) {
      throw new NanoleafError('not-found', `${label} answers HTTP 404`, { status });
    }
    throw new NanoleafError('http', `${label} answers HTTP ${status}`, { status });
  }

  async json(response, label) {
    try {
      return await response.json();
    } catch (err) {
      throw new NanoleafError('invalid', `${label} sent an answer that is not JSON`, {
        cause: err,
      });
    }
  }

  /**
   * Ask for a new token. Works only in the 30 seconds after the power button
   * was held 5 to 7 seconds (the LEDs flash): 403 otherwise.
   * @returns {Promise<string>} the token
   */
  async pair(target) {
    const label = hostLabel(target);
    let response;
    try {
      response = await this.request(target, 'POST', 'new');
    } catch (err) {
      if (err.status === 403 || err.status === 401) {
        throw new NanoleafError('not-pairing', `${label} is not in pairing mode`, {
          status: err.status,
        });
      }
      throw err;
    }
    const data = await this.json(response, label);
    const token = data?.auth_token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9]{8,128}$/.test(token)) {
      throw new NanoleafError('invalid', `${label} sent no usable token`);
    }
    return token;
  }

  /** Everything the controller knows: `GET /api/v1/<token>/`. */
  async getInfo(target) {
    const response = await this.request(target, 'GET', `${target.token}/`);
    const data = await this.json(response, hostLabel(target));
    if (!data || typeof data !== 'object') {
      throw new NanoleafError('invalid', `${hostLabel(target)} sent an empty answer`);
    }
    return data;
  }

  /** `PUT /state`: `{ on: { value } }`, `{ brightness: { value, duration } }`… */
  async setState(target, body) {
    await this.request(target, 'PUT', `${target.token}/state`, body);
  }

  /** Start one effect of the controller's list. */
  async selectEffect(target, name) {
    await this.request(target, 'PUT', `${target.token}/effects`, { select: name });
  }

  /** Flash the panels, to find the controller. */
  async identify(target) {
    await this.request(target, 'PUT', `${target.token}/identify`);
  }

  /**
   * Open the server-sent event stream (`text/event-stream`), without
   * timeout: the caller aborts it through `signal`.
   * @param {object} target `{ host, port, token }`
   * @param {number[]} types event types (EVENT_TYPES)
   * @param {AbortSignal} signal
   */
  async openEvents(target, types, signal) {
    const label = hostLabel(target);
    let response;
    try {
      response = await this.fetch(
        this.url(target, `${target.token}/events?id=${types.join(',')}`),
        {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal,
        },
      );
    } catch (err) {
      throw new NanoleafError('unreachable', `${label} does not answer (${reason(err)})`, {
        cause: err,
      });
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      throw new NanoleafError('unauthorized', `${label} refuses the token (HTTP 401)`, {
        status: 401,
      });
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new NanoleafError('http', `${label} answers HTTP ${response.status} to /events`, {
        status: response.status,
      });
    }
    return response;
  }
}
