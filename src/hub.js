// -----------------------------------------------------------------------------
// The Nanoleaf hub: finds and pairs the controllers, follows their event
// streams, reads them at a steady pace, publishes their devices and states to
// Gladys, runs the commands and fires the gesture trigger.
//
// Push first: each paired controller keeps one `/events` stream open (state,
// effect and, on touch models, gesture events), so a change made in the
// Nanoleaf app or on the panels shows in Gladys at once. A full read every
// minute (`GET /`) catches what the stream cannot say (a new effect in the
// list, a controller that went away) and re-sends the unchanged values as a
// heartbeat. Gladys never polls these devices (should_poll: false).
// -----------------------------------------------------------------------------

import { GladysApiError, createLogger } from '@gladysassistant/integration-sdk';
import { parseAddress } from './config.js';
import {
  FEATURE_KEYS,
  activeEffect,
  applyState,
  buildDevice,
  commandFor,
  deviceIds,
  deviceName,
  deviceValues,
  featureSpecs,
  findEffect,
  solidState,
} from './devices.js';
import { SCAN_TIMEOUT_SECONDS, mapLimit, parseMdnsResults, parseSsdpResults } from './discovery.js';
import { EventStream } from './nanoleaf/events.js';
import { hostLabel } from './nanoleaf/client.js';
import {
  EVENT_TYPES,
  GESTURES,
  NANOLEAF_PORT,
  SOLID_EFFECT,
  STATE_ATTRIBUTES,
  capabilitiesOf,
  clamp,
  intToRgb,
  normalizeSerial,
  parseInfo,
  rgbToHs,
} from './nanoleaf/model.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, pairMessage } from './texts.js';

const logger = createLogger({ name: 'nanoleaf-hub' });

export const WIDGET_KEY = 'nanoleaf';
export const TRIGGER = 'gesture';

export const HUB_TIMINGS = {
  // Full read of every controller: the effects list, a lost controller, and
  // the heartbeat of the unchanged values.
  refreshMs: 60_000,
  // New scan, to follow DHCP changes and find new controllers.
  rediscoveryMs: 15 * 60_000,
  // A scan this recent is reused by the "Pair" button: the 30 seconds of
  // pairing mode leave no time for a new one.
  scanReuseMs: 60_000,
  // Reads in a row without answer before a controller is "unreachable".
  unreachableAfter: 2,
  // An unchanged value is sent again this often, so Gladys never shows it
  // as stale (it does after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
  // Longest "show a colour" a scene can ask for.
  maxFlashSeconds: 3600,
};

const CONCURRENCY = 4;
// Changes of these features change what the widget shows.
const WIDGET_KEYS = [
  FEATURE_KEYS.POWER,
  FEATURE_KEYS.EFFECT,
  FEATURE_KEYS.COLOR,
  FEATURE_KEYS.TEMPERATURE,
];

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addressKey = ({ host, port = NANOLEAF_PORT }) => `${host}:${port}`;

/**
 * Gladys refused a call or did not answer (restart, network, rate limit): a
 * passing condition, unlike a bug in the integration.
 */
const isGladysFailure = (err) =>
  err instanceof GladysApiError ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError' ||
  (err instanceof TypeError && err.message === 'fetch failed');

const describe = (err) => {
  const code = err?.cause?.code;
  return code && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
};

const isGiven = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export class NanoleafHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake)
   * @param {object} options.store persistence (src/store.js)
   * @param {object} options.client NanoleafClient
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.streamTimings] STREAM_TIMINGS overrides
   */
  constructor({ gladys, store, client, timers = true, timings, streamTimings }) {
    this.gladys = gladys;
    this.store = store;
    this.client = client;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.streamTimings = streamTimings;
    this.config = null;
    /** @type {Map<string, object>} paired controllers, by serial */
    this.records = new Map();
    /** @type {Map<string, object>} controllers found, not paired, by address */
    this.candidates = new Map();
    this.pending = new Set();
    this.refreshTimer = null;
    this.rediscoveryTimer = null;
    this.discovering = null;
    this.lastScan = { status: 'not-run', at: 0 };
    this.stopped = false;
    // Repeated failures: one line when they start and one when they end.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.restore();
    await this.discover();
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    this.startTimers();
    logger.info(
      `${this.records.size} paired Nanoleaf controller(s), ${this.candidates.size} to pair`,
    );
  }

  /** Gladys came back (restart, network): it may have lost what was published. */
  async resync(config) {
    this.config = config;
    this.gladys.forgetPublishedStates();
    for (const record of this.records.values()) {
      record.published = {};
    }
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
    this.requestWidgetRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (
      !previous ||
      previous.hosts.map(addressKey).join() !== config.hosts.map(addressKey).join()
    ) {
      await this.discover();
    }
    // New controllers, or names in another language for the Discovery list.
    await this.publishDevices();
    await this.publishAllStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  startTimers() {
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    clearInterval(this.refreshTimer);
    clearInterval(this.rediscoveryTimer);
    this.refreshTimer = setInterval(() => this.track(this.refreshAll()), this.timings.refreshMs);
    this.rediscoveryTimer = setInterval(
      () => this.track(this.rediscover()),
      this.timings.rediscoveryMs,
    );
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearInterval(this.rediscoveryTimer);
    for (const record of this.records.values()) {
      this.cancelFlash(record);
    }
    await Promise.all([...this.records.values()].map((record) => this.stopStream(record)));
    await this.idle();
    await this.store.flush();
  }

  /** Keep track of background work, so the tests (and stop) can wait for it. */
  track(promise) {
    const tracked = Promise.resolve(promise)
      .catch((err) => this.backgroundFailed(err))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
    return tracked;
  }

  /**
   * A periodic task failed. Gladys refusing or away is said once until it
   * accepts again; a bug is logged with its stack, once per message.
   */
  backgroundFailed(err) {
    if (isGladysFailure(err)) {
      this.problems.fail('gladys', `Gladys does not take the Nanoleaf updates: ${describe(err)}`);
    } else {
      this.problems.fail(`bug:${err?.message}`, 'Background task failed', 'error', err);
    }
  }

  gladysRecovered() {
    this.problems.recover('gladys', 'Gladys takes the Nanoleaf updates again');
  }

  /** Resolves once no background work is left. */
  async idle() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  // --- Persistence -----------------------------------------------------------

  async restore() {
    const data = await this.store.load();
    for (const [key, saved] of Object.entries(data.controllers ?? {})) {
      const serial = normalizeSerial(key);
      if (
        !serial ||
        !saved ||
        typeof saved.host !== 'string' ||
        typeof saved.token !== 'string' ||
        !saved.info
      ) {
        continue;
      }
      const record = this.createRecord(serial, {
        host: saved.host,
        port: Number.isInteger(saved.port) ? saved.port : NANOLEAF_PORT,
        token: saved.token,
      });
      record.deviceId = typeof saved.deviceId === 'string' ? saved.deviceId : null;
      this.setInfo(record, saved.info);
      this.records.set(serial, record);
    }
  }

  save() {
    const controllers = {};
    for (const record of this.records.values()) {
      controllers[record.serial] = {
        host: record.host,
        port: record.port,
        token: record.token,
        deviceId: record.deviceId,
        info: record.info,
      };
    }
    return this.store.save({ controllers });
  }

  // --- Records -----------------------------------------------------------------

  createRecord(serial, { host, port, token }) {
    return {
      serial,
      host,
      port,
      token,
      deviceId: null,
      // What does not change between reads: name, model, firmware, effects, range.
      info: null,
      caps: null,
      effects: [],
      effect: null,
      state: {},
      // null until the first answer or the first read without one.
      reachable: null,
      failures: 0,
      tokenRefused: false,
      stream: null,
      // The controller refused the gesture events (a model without touch).
      touchRefused: false,
      refreshing: null,
      // Bumped on every command: a read started before it is stale.
      commandSeq: 0,
      sentColor: null,
      // 'hs' or 'ct': what the panels showed before an effect.
      solidMode: null,
      flash: null,
      lastGesture: null,
      // Last values published, by feature key (for the widget nudges).
      published: {},
    };
  }

  /** The static part of a read (parseInfo without the state). */
  setInfo(record, info) {
    const { state, effect, ...rest } = info;
    void state;
    void effect;
    record.info = rest;
    record.caps = capabilitiesOf(rest);
    record.effects = rest.effects ?? [];
  }

  target(record) {
    return { host: record.host, port: record.port, token: record.token };
  }

  label(record) {
    return deviceName(record);
  }

  // --- Discovery -------------------------------------------------------------

  /**
   * Scan through the Gladys core, place what answered (a paired controller
   * that moved, or one to pair), then read every paired controller.
   */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    const found = [
      ...this.config.hosts.map((address) => ({
        ...address,
        deviceId: null,
        name: null,
        model: null,
      })),
      ...(await this.scan()),
    ];
    const candidates = new Map();
    for (const entry of found) {
      const byId = entry.deviceId
        ? [...this.records.values()].find((record) => record.deviceId === entry.deviceId)
        : null;
      if (byId) {
        this.move(byId, entry);
        continue;
      }
      const byAddress = [...this.records.values()].find(
        (record) => addressKey(record) === addressKey(entry),
      );
      if (byAddress) {
        byAddress.deviceId ??= entry.deviceId;
        continue;
      }
      const key = addressKey(entry);
      const known = candidates.get(key);
      candidates.set(key, {
        host: entry.host,
        port: entry.port,
        deviceId: entry.deviceId ?? known?.deviceId ?? null,
        name: entry.name ?? known?.name ?? null,
        model: entry.model ?? known?.model ?? null,
      });
    }
    this.candidates = candidates;

    await mapLimit([...this.records.values()], CONCURRENCY, (record) => this.refresh(record));
    await this.findMoved();
    await this.save();
  }

  /**
   * A paired controller that does not answer may have a new address (DHCP)
   * that the scan found without its id: its token tells.
   */
  async findMoved() {
    const lost = [...this.records.values()].filter(
      (record) => record.reachable === false && !record.tokenRefused,
    );
    if (lost.length === 0 || this.candidates.size === 0) {
      return;
    }
    for (const candidate of [...this.candidates.values()]) {
      for (const record of lost) {
        if (record.reachable !== false) {
          continue;
        }
        try {
          const info = parseInfo(await this.client.getInfo({ ...candidate, token: record.token }));
          if (info.serial === record.serial) {
            this.move(record, candidate);
            await this.refresh(record);
            break;
          }
        } catch (err) {
          logger.debug(`${hostLabel(candidate)} is not ${this.label(record)}: ${err.message}`);
        }
      }
    }
  }

  move(record, { host, port, deviceId }) {
    record.deviceId ??= deviceId ?? null;
    if (record.host === host && record.port === port) {
      return;
    }
    logger.info(
      `${this.label(record)} moved from ${hostLabel(record)} to ${hostLabel({ host, port })}`,
    );
    record.host = host;
    record.port = port;
    this.candidates.delete(addressKey({ host, port }));
    // The stream follows at its next connection; restart it now.
    this.restartStream(record);
  }

  /** One mDNS browse and one SSDP search through the Gladys core. */
  async scan() {
    const found = [];
    let failure = null;
    // One scan at a time per integration (409 otherwise): one after the other.
    for (const [type, parse] of [
      ['mdns', parseMdnsResults],
      ['ssdp', parseSsdpResults],
    ]) {
      try {
        found.push(
          ...parse(await this.gladys.scanNetwork(type, { timeoutSeconds: SCAN_TIMEOUT_SECONDS })),
        );
      } catch (err) {
        failure ??= err;
        logger.debug(`Nanoleaf ${type} discovery through Gladys failed: ${describe(err)}`);
      }
    }
    if (failure && found.length === 0 && failure.status !== 409) {
      // 403: a core without mediated discovery. The typed addresses still work.
      this.problems.fail('scan', `Nanoleaf discovery through Gladys failed: ${describe(failure)}`);
      this.lastScan = { status: 'unavailable', at: Date.now() };
    } else {
      this.problems.recover('scan', 'Nanoleaf discovery through Gladys works again');
      this.lastScan = { status: 'ok', at: Date.now() };
    }
    return found;
  }

  async rediscover() {
    await this.discover();
    // New addresses (DHCP) for the params of the created devices.
    await this.publishDevices();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.gladysRecovered();
  }

  // --- Pairing ---------------------------------------------------------------

  /**
   * The "Pair" button: ask a token from every controller to pair (or only
   * the typed address). Only the one in pairing mode gives one.
   * @returns {Promise<object>} the multi-language report
   */
  async pair(rawHost) {
    let targets;
    if (isGiven(rawHost)) {
      const address = parseAddress(String(rawHost));
      if (!address) {
        return pairMessage({ invalidHost: true });
      }
      targets = [{ ...address, name: null, deviceId: null }];
    } else {
      if (Date.now() - this.lastScan.at > this.timings.scanReuseMs) {
        await this.discover();
      }
      targets = [
        ...this.candidates.values(),
        // A controller reset, or whose token was removed, pairs again.
        ...[...this.records.values()]
          .filter((record) => record.tokenRefused)
          .map((record) => ({ host: record.host, port: record.port, name: this.label(record) })),
      ];
    }
    const already = [];
    const pending = [];
    for (const target of targets) {
      const record = [...this.records.values()].find(
        (known) => addressKey(known) === addressKey(target),
      );
      if (record && !record.tokenRefused && record.reachable !== false) {
        already.push(this.label(record));
      } else {
        pending.push(target);
      }
    }
    const results = await mapLimit(pending, CONCURRENCY, (target) => this.pairOne(target));
    const paired = [];
    const unreachable = [];
    results.forEach((result, index) => {
      const target = pending[index];
      if (result.value) {
        paired.push(this.label(result.value));
      } else if (result.error?.kind === 'unreachable') {
        unreachable.push(target.name ?? hostLabel(target));
      } else if (result.error?.kind !== 'not-pairing') {
        logger.warn(`Pairing ${hostLabel(target)} failed: ${result.error?.message}`);
      }
    });
    if (paired.length > 0) {
      await this.save();
      await this.publishDevices();
      await this.publishAllStates();
      await this.publishTransports();
    }
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
    if (paired.length === 0) {
      // A success is said by pairOne, once per controller.
      logger.info(
        `Pairing: nothing paired (${pending.length - unreachable.length} not in pairing mode, ${unreachable.length} not answering)`,
      );
    }
    return pairMessage({ paired, already, unreachable, candidates: pending.length });
  }

  async pairOne(target) {
    const token = await this.client.pair(target);
    const data = await this.client.getInfo({ ...target, token });
    const info = parseInfo(data);
    let record = this.records.get(info.serial);
    if (record) {
      await this.stopStream(record);
      Object.assign(record, { host: target.host, port: target.port, token, tokenRefused: false });
      this.problems.recover(`token:${record.serial}`);
    } else {
      record = this.createRecord(info.serial, { host: target.host, port: target.port, token });
      this.records.set(info.serial, record);
    }
    record.deviceId ??= target.deviceId ?? null;
    this.candidates.delete(addressKey(target));
    logger.info(`Paired ${info.name ?? info.serial} (${info.model}) at ${hostLabel(target)}`);
    await this.applyInfo(record, data, info);
    return record;
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()]
      .filter((record) => record.info)
      .map((record) => buildDevice(this.gladys, record, this.config.language));
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The record behind a Gladys device external id, or null. */
  resolveDevice(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    const prefix = deviceIds(this.gladys, '').device;
    if (!externalId.startsWith(prefix)) {
      return null;
    }
    return this.records.get(externalId.slice(prefix.length)) ?? null;
  }

  isCreated(record) {
    const id = deviceIds(this.gladys, record.serial).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  require(externalId) {
    const record = this.resolveDevice(externalId);
    if (!record) {
      throw new Error(`Unknown Nanoleaf device ${externalId}`);
    }
    return record;
  }

  // --- States ----------------------------------------------------------------

  /**
   * Publish what changed for one controller, if the user created it (Gladys
   * caps states at 300 a minute and re-evaluates scenes on each one).
   * Resolves with the keys that changed.
   */
  async publishStates(record) {
    // Every state change ends here: remember whether the panels last showed
    // a colour or a white, which "None" in the effect list brings back.
    if (record.state.colorMode === 'hs' || record.state.colorMode === 'ct') {
      record.solidMode = record.state.colorMode;
    }
    if (!record.caps || !this.isCreated(record)) {
      return [];
    }
    const ids = deviceIds(this.gladys, record.serial);
    const values = deviceValues(record);
    const states = [];
    const changed = [];
    for (const spec of featureSpecs(record, this.config.language)) {
      const value = values[spec.key];
      if (value === undefined) {
        continue;
      }
      states.push(
        typeof value === 'object'
          ? { device_feature_external_id: ids.feature(spec.key), text: value.text }
          : { device_feature_external_id: ids.feature(spec.key), state: value },
      );
      if (!sameValue(record.published[spec.key], value)) {
        changed.push(spec.key);
      }
    }
    // The SDK sends only the values that changed since its last publication,
    // and the unchanged ones once they are `heartbeat` old.
    await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    for (const key of changed) {
      record.published[key] = values[key];
    }
    if (changed.some((key) => WIDGET_KEYS.includes(key))) {
      this.requestWidgetRefresh();
    }
    return changed;
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      try {
        await this.publishStates(record);
      } catch (err) {
        this.backgroundFailed(err);
      }
    }
  }

  /**
   * The user added a device: the states sent before were dropped by Gladys,
   * and so was the transport badge. Send them again, nudge the widget.
   */
  async onDeviceCreated(device) {
    const record = this.resolveDevice(device?.external_id);
    if (!record) {
      return;
    }
    record.published = {};
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates(record);
    await this.publishTransports([record]);
    this.requestWidgetRefresh();
  }

  async publishTransports(records = [...this.records.values()]) {
    const entries = records
      .filter((record) => this.isCreated(record))
      .map((record) => ({
        external_id: deviceIds(this.gladys, record.serial).device,
        transport: record.reachable === true ? 'local' : 'unreachable',
      }));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  async publishConnectionStatus() {
    const records = [...this.records.values()];
    if (records.length === 0) {
      await this.gladys.setConnectionStatus(
        false,
        this.candidates.size > 0 ? CONNECTION_TEXT.notPaired : CONNECTION_TEXT.noDevice,
      );
    } else if (records.some((record) => record.tokenRefused)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.tokenRefused);
    } else if (!records.some((record) => record.reachable === true)) {
      await this.gladys.setConnectionStatus(false, CONNECTION_TEXT.noAnswer);
    } else {
      await this.gladys.setConnectionStatus(true);
    }
  }

  requestWidgetRefresh() {
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading -----------------------------------------------------------------

  /** Read every controller once (the timer's job). */
  async refreshAll() {
    const results = await mapLimit([...this.records.values()], CONCURRENCY, (record) =>
      this.refresh(record),
    );
    // A controller that does not answer is handled by refresh; what is left
    // is Gladys refusing the states (or a bug).
    const errors = results.filter((result) => result.error).map((result) => result.error);
    errors.forEach((err) => this.backgroundFailed(err));
    if (errors.length === 0) {
      this.gladysRecovered();
    }
  }

  /** Read one controller and publish what changed. */
  refresh(record) {
    record.refreshing ??= this.runRefresh(record).finally(() => {
      record.refreshing = null;
    });
    return record.refreshing;
  }

  async runRefresh(record) {
    if (record.tokenRefused || this.stopped) {
      return;
    }
    const seq = record.commandSeq;
    let data;
    let info;
    try {
      data = await this.client.getInfo(this.target(record));
      info = parseInfo(data);
    } catch (err) {
      await this.readFailed(record, err);
      return;
    }
    if (info.serial !== record.serial) {
      // Another controller took the address (DHCP): this one moved away.
      await this.readFailed(
        record,
        Object.assign(new Error(`${hostLabel(record)} is now another controller`), {
          kind: 'unreachable',
        }),
      );
      return;
    }
    this.problems.recover(`read:${record.serial}`, `${this.label(record)} reads again`);
    await this.applyInfo(record, data, info, { stale: seq !== record.commandSeq });
  }

  async readFailed(record, err) {
    if (err.kind === 'unreachable') {
      await this.failed(record);
    } else if (err.kind === 'unauthorized') {
      await this.refuseToken(record);
    } else {
      this.problems.fail(
        `read:${record.serial}`,
        `Cannot read ${this.label(record)}: ${err.message}`,
      );
    }
  }

  /**
   * A full read: the static part (effects list, firmware), the state, the
   * reachability, the stream.
   * @param {object} [options]
   * @param {boolean} [options.stale] a Gladys command ran meanwhile: keep the static part only
   */
  async applyInfo(record, data, info, { stale = false } = {}) {
    const previousEffects = record.effects;
    const hadInfo = record.info !== null;
    const before = JSON.stringify(record.info);
    this.setInfo(record, info);
    if (!stale) {
      record.state = info.state;
      record.effect = info.effect;
    }
    if (JSON.stringify(record.info) !== before) {
      await this.save();
      if (hadInfo && !sameValue(previousEffects, record.effects)) {
        // The new list reaches the created device: Gladys updates the
        // options of a known feature on re-publication.
        logger.debug(`${this.label(record)}: the effects list changed`);
        await this.publishDevices();
      }
    }
    await this.markReachable(record);
    await this.publishStates(record);
    this.startStream(record);
  }

  async markReachable(record) {
    record.failures = 0;
    if (record.reachable === true) {
      return;
    }
    record.reachable = true;
    logger.info(`${this.label(record)} answers at ${hostLabel(record)}`);
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  /**
   * A read without answer. After a few in a row the controller is
   * unreachable: most often unplugged, so its panels are shown off.
   */
  async failed(record) {
    if (this.stopped) {
      return;
    }
    record.failures += 1;
    if (record.reachable === null) {
      // Known from /data, silent since the start: unreachable at once.
      record.failures = this.timings.unreachableAfter;
    }
    if (record.failures < this.timings.unreachableAfter || record.reachable === false) {
      return;
    }
    record.reachable = false;
    logger.info(`${this.label(record)} no longer answers at ${hostLabel(record)}`);
    await this.publishStates(record);
    await this.publishTransports([record]);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  async refuseToken(record) {
    if (record.tokenRefused) {
      return;
    }
    record.tokenRefused = true;
    this.problems.fail(
      `token:${record.serial}`,
      `${this.label(record)} refuses its token: pair it again`,
    );
    await this.stopStream(record);
    await this.publishConnectionStatus();
    this.requestWidgetRefresh();
  }

  // --- Event stream ------------------------------------------------------------

  startStream(record) {
    if (record.stream || this.stopped || record.tokenRefused || !record.caps) {
      return;
    }
    const types = [EVENT_TYPES.STATE, EVENT_TYPES.EFFECTS];
    const touch = record.caps.touch && !record.touchRefused;
    if (touch) {
      types.push(EVENT_TYPES.TOUCH);
    }
    record.stream = new EventStream({
      client: this.client,
      target: () => this.target(record),
      types,
      timings: this.streamTimings,
      onEvent: (event) => this.track(this.onStreamEvent(record, event)),
      onOpen: () => {
        logger.debug(`${this.label(record)}: event stream open`);
        // Events were missed while it was closed: read everything once.
        if (record.reachable !== true) {
          this.track(this.refresh(record));
        }
      },
      onClose: (err) => {
        logger.debug(`${this.label(record)}: event stream closed${err ? ` (${err.message})` : ''}`);
        if (touch && err?.kind === 'http') {
          // A model without touch may refuse the gesture events: without them.
          record.touchRefused = true;
          this.restartStream(record);
          return;
        }
        if (record.reachable === true && !this.stopped) {
          this.track(this.refresh(record));
        }
      },
      onUnauthorized: () => this.track(this.refuseToken(record)),
    });
    // Not tracked: the stream runs for the life of the controller, and
    // idle() must not wait for it (stopStream does).
    record.stream.start().catch((err) => this.backgroundFailed(err));
  }

  async stopStream(record) {
    const { stream } = record;
    record.stream = null;
    await stream?.stop();
  }

  restartStream(record) {
    if (!record.stream) {
      return;
    }
    this.track(this.stopStream(record).then(() => this.startStream(record)));
  }

  async onStreamEvent(record, { type, events }) {
    if (type === EVENT_TYPES.TOUCH) {
      for (const event of events) {
        this.onGesture(record, event);
      }
      return;
    }
    let changed = false;
    for (const event of events) {
      if (type === EVENT_TYPES.STATE) {
        const attribute = STATE_ATTRIBUTES[event.attr];
        const { value } = event;
        if (attribute === 'on' && typeof value === 'boolean') {
          record.state = { ...record.state, on: value };
          changed = true;
        } else if (attribute === 'colorMode' && typeof value === 'string') {
          record.state = { ...record.state, colorMode: value };
          changed = true;
        } else if (attribute && attribute !== 'on' && typeof value === 'number') {
          record.state = { ...record.state, [attribute]: Math.round(value) };
          changed = true;
        }
      } else if (type === EVENT_TYPES.EFFECTS && typeof event.value === 'string') {
        record.effect = event.value;
        if (event.value !== SOLID_EFFECT && record.effects.includes(event.value)) {
          record.state = { ...record.state, colorMode: 'effect' };
        }
        changed = true;
      }
    }
    if (changed) {
      logger.debug(`${this.label(record)}: state event ${JSON.stringify(events)}`);
      await this.markReachable(record);
      await this.publishStates(record);
    }
  }

  /** A gesture on the panels: the scene trigger, and the widget's last gesture. */
  onGesture(record, event) {
    const gesture = GESTURES[event?.gesture];
    if (!gesture) {
      logger.debug(`${this.label(record)}: unknown gesture ${JSON.stringify(event)}`);
      return;
    }
    const panel = Number.isInteger(event.panelId) && event.panelId >= 0 ? event.panelId : null;
    record.lastGesture = { gesture, panel, at: Date.now() };
    logger.debug(`${this.label(record)}: ${gesture}${panel === null ? '' : ` on panel ${panel}`}`);
    this.requestWidgetRefresh();
    if (!this.isCreated(record)) {
      return;
    }
    this.track(
      this.gladys.publishSceneEvent(TRIGGER, {
        device: deviceIds(this.gladys, record.serial).device,
        gesture,
        panel,
      }),
    );
  }

  // --- Commands ----------------------------------------------------------------

  /** Run one request on the controller, then publish the state it gives. */
  async execute(record, command) {
    if (record.tokenRefused) {
      throw new Error(`${this.label(record)} refuses its token: pair it again`);
    }
    record.commandSeq += 1;
    const target = this.target(record);
    try {
      if (command.effect) {
        await this.client.selectEffect(target, command.effect);
        record.effect = command.effect;
        record.state = { ...record.state, on: true, colorMode: 'effect' };
      } else {
        const body = command.solid ? solidState(record) : command.state;
        await this.client.setState(target, body);
        record.state = applyState(record.state, body);
        if (command.color !== undefined) {
          record.sentColor = { value: command.color, hue: body.hue.value, sat: body.sat.value };
        }
        if (body.hue || body.ct) {
          record.effect = SOLID_EFFECT;
        }
      }
    } catch (err) {
      if (err.kind === 'unreachable') {
        await this.failed(record);
      } else if (err.kind === 'unauthorized') {
        await this.refuseToken(record);
      }
      throw err;
    }
    await this.markReachable(record);
    await this.publishStates(record);
  }

  /** A Gladys command on a feature of one of the devices. */
  async setValue(device, feature, value) {
    const record = this.require(device?.external_id);
    const prefix = `${device.external_id}:`;
    const key = feature?.external_id?.startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : null;
    const command = commandFor(record, key, value);
    this.cancelFlash(record);
    await this.execute(record, command);
  }

  /** Turn a controller on or off (the widget's button). */
  async switchPower(deviceExternalId, on) {
    const record = this.require(deviceExternalId);
    this.cancelFlash(record);
    await this.execute(record, { state: { on: { value: on } } });
  }

  /**
   * Start an effect of the controller's list, given by name (case ignored),
   * with an optional brightness (1-100 %).
   * @returns {Promise<string>} the effect name, as the controller writes it
   */
  async runEffect(deviceExternalId, { effect, brightness }) {
    const record = this.require(deviceExternalId);
    const name = findEffect(record, effect);
    if (!name) {
      throw new Error(
        `${this.label(record)} has no effect "${effect}". Its effects: ${record.effects.slice(0, 20).join(', ')}`,
      );
    }
    this.cancelFlash(record);
    await this.execute(record, { effect: name });
    if (isGiven(brightness) && Number.isFinite(Number(brightness))) {
      await this.execute(record, {
        state: { brightness: { value: clamp(Math.round(Number(brightness)), 1, 100) } },
      });
    }
    logger.debug(`${this.label(record)}: effect "${name}" started`);
    return name;
  }

  /**
   * Show a plain colour for a while, then bring back what the panels showed
   * (effect, colour or white, brightness, on or off). A Gladys command on
   * the controller meanwhile cancels the return; a second flash keeps the
   * state from before the first one.
   * @param {string} deviceExternalId
   * @param {object} options `{ color (RGB integer), seconds, brightness }`
   */
  async showColor(deviceExternalId, { color, seconds, brightness }) {
    const record = this.require(deviceExternalId);
    if (!record.caps.color) {
      throw new Error(`${this.label(record)} only shows white: it cannot show a colour`);
    }
    const duration = clamp(Math.round(Number(seconds)), 1, this.timings.maxFlashSeconds);
    if (!Number.isFinite(duration)) {
      throw new Error('The duration must be a number of seconds');
    }
    const snapshot = record.flash?.snapshot ?? this.snapshot(record);
    this.cancelFlash(record);
    const { hue, sat } = rgbToHs(intToRgb(color));
    const body = { hue: { value: hue }, sat: { value: sat } };
    if (isGiven(brightness) && Number.isFinite(Number(brightness))) {
      body.brightness = { value: clamp(Math.round(Number(brightness)), 1, 100) };
    }
    body.on = { value: true };
    await this.execute(record, { state: body, color });
    const timer = setTimeout(() => {
      record.flash = null;
      this.track(this.restoreSnapshot(record, snapshot));
    }, duration * 1000);
    timer.unref?.();
    record.flash = { timer, snapshot };
    logger.debug(`${this.label(record)}: colour shown for ${duration} s`);
  }

  snapshot(record) {
    return {
      on: record.state.on === true,
      brightness: record.state.brightness,
      colorMode: record.state.colorMode,
      hue: record.state.hue,
      sat: record.state.sat,
      ct: record.state.ct,
      effect: activeEffect(record),
    };
  }

  cancelFlash(record) {
    if (record.flash) {
      clearTimeout(record.flash.timer);
      record.flash = null;
    }
  }

  async restoreSnapshot(record, snapshot) {
    if (this.stopped || record.tokenRefused) {
      return;
    }
    try {
      if (snapshot.effect) {
        await this.execute(record, { effect: snapshot.effect });
      }
      const body = {};
      if (!snapshot.effect) {
        if (snapshot.colorMode === 'ct' && Number.isFinite(snapshot.ct)) {
          body.ct = { value: snapshot.ct };
        } else if (Number.isFinite(snapshot.hue) && Number.isFinite(snapshot.sat)) {
          body.hue = { value: snapshot.hue };
          body.sat = { value: snapshot.sat };
        }
      }
      if (Number.isFinite(snapshot.brightness)) {
        body.brightness = { value: snapshot.brightness };
      }
      body.on = { value: snapshot.on };
      await this.execute(record, { state: body });
      this.problems.recover(`restore:${record.serial}`);
    } catch (err) {
      this.problems.fail(
        `restore:${record.serial}`,
        `${this.label(record)}: cannot bring back the state after the colour: ${err.message}`,
      );
    }
  }

  /** What the Configuration screen's "Search" action reports. */
  summary() {
    return {
      scan: this.lastScan.status,
      invalidHosts: this.config.invalidHosts,
      candidates: [...this.candidates.values()].map(({ host, port, name }) => ({
        host: hostLabel({ host, port }),
        name,
      })),
      controllers: [...this.records.values()].map((record) => ({
        name: this.label(record),
        host: hostLabel(record),
        reachable: record.reachable === true,
        tokenRefused: record.tokenRefused,
      })),
    };
  }
}
