// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container): the
// paired Nanoleaf controllers, with their address, their token and their last
// answer, so a restart knows them before the first read and their devices
// stay in the Discovery list while they are switched off at the wall.
//
// The tokens are secrets: the file is readable by the container user only
// (0600), and nothing here logs its content. Losing it means pairing again.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ProblemLog } from './problems.js';

const logger = createLogger({ name: 'nanoleaf-store' });
const FILE_NAME = 'nanoleaf.json';

export class Store {
  constructor(directory = process.env.NANOLEAF_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    // A volume that refuses writes is said once, not at every scan.
    this.problems = new ProblemLog(logger);
    this.writing = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Never err.message of a JSON error: it quotes the file, tokens included.
        logger.warn(
          `Cannot read ${this.path} (${err.code ?? 'not valid JSON'}): pair the controllers again`,
        );
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true, mode: 0o700 });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await rename(temporary, this.path);
          this.problems.recover('write', `${this.path} is written again`);
        } catch (err) {
          this.problems.fail('write', `Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
