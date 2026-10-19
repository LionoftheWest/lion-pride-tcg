import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './util.mjs';
import { statusChecks, fuzzChecks } from './checks.mjs';
const cfg = loadConfig();
for (const c of [...statusChecks(cfg), ...fuzzChecks(cfg)]) test(`status ${c.id}: ${c.what}`, () => assert.ok(c.ok, `expect ${c.expect}, got ${c.got}`));
