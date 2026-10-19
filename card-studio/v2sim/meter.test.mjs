import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './util.mjs';
import { meterChecks } from './checks.mjs';
const cfg = loadConfig();
for (const c of meterChecks(cfg)) test(`meter ${c.id}: ${c.what}`, () => assert.ok(c.ok, `expect ${c.expect}, got ${c.got}`));
