const { describe, it } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_INTERVAL_HOURS } = require('../lib/autoupdate');

describe('autoupdate', () => {
  it('дефолтный интервал 12ч', () => {
    assert.strictEqual(DEFAULT_INTERVAL_HOURS, 12);
  });
  it('содержит checkForUpdate и startAutoUpdate', () => {
    const m = require('../lib/autoupdate');
    assert.strictEqual(typeof m.startAutoUpdate, 'function');
    assert.strictEqual(typeof m.checkForUpdate, 'function');
  });
});
