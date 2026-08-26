// test/setup.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test with a temp .env file
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freegate-setup-test-'));
const TMP_ENV = path.join(TMP_DIR, '.env');

// Override getEnvPath for testing
let setup;
function loadSetup() {
  // Clear require cache
  delete require.cache[require.resolve('../lib/setup')];
  setup = require('../lib/setup');
  // Patch getEnvPath to use our temp file
  setup.getEnvPath = () => TMP_ENV;
}

describe('setup.readKeys', () => {
  it('returns empty keys when .env does not exist', () => {
    fs.rmSync(TMP_ENV, { force: true });
    loadSetup();
    const { keys } = setup.readKeys();
    assert.equal(typeof keys, 'object');
    assert.equal(Object.keys(keys).length, 9);
    for (const v of Object.values(keys)) {
      assert.equal(v, '');
    }
  });

  it('reads keys from .env file', () => {
    fs.writeFileSync(TMP_ENV, 'PROVIDER_GROQ_APIKEY=gsk_test123\nPROVIDER_MISTRAL_APIKEY=ms_test456\nOTHER_VAR=ignored\n');
    loadSetup();
    const { keys } = setup.readKeys();
    assert.equal(keys.PROVIDER_GROQ_APIKEY, 'gsk_test123');
    assert.equal(keys.PROVIDER_MISTRAL_APIKEY, 'ms_test456');
    assert.equal(keys.PROVIDER_GEMINI_APIKEY, '');
  });

  it('skips comments and blank lines', () => {
    fs.writeFileSync(TMP_ENV, '# comment\n\nPROVIDER_GROQ_APIKEY=gsk_abc\n\n# another comment\n');
    loadSetup();
    const { keys } = setup.readKeys();
    assert.equal(keys.PROVIDER_GROQ_APIKEY, 'gsk_abc');
  });
});

describe('setup.saveKeys', () => {
  it('creates .env with new keys', () => {
    fs.rmSync(TMP_ENV, { force: true });
    loadSetup();
    const result = setup.saveKeys({ PROVIDER_GROQ_APIKEY: 'gsk_new', PROVIDER_MISTRAL_APIKEY: 'ms_new' });
    assert.ok(result.saved.includes('PROVIDER_GROQ_APIKEY'));
    const content = fs.readFileSync(TMP_ENV, 'utf8');
    assert.ok(content.includes('PROVIDER_GROQ_APIKEY=gsk_new'));
    assert.ok(content.includes('PROVIDER_MISTRAL_APIKEY=ms_new'));
  });

  it('updates existing keys in .env', () => {
    fs.writeFileSync(TMP_ENV, 'PROVIDER_GROQ_APIKEY=old_value\nOTHER=keep\n');
    loadSetup();
    setup.saveKeys({ PROVIDER_GROQ_APIKEY: 'new_value' });
    const content = fs.readFileSync(TMP_ENV, 'utf8');
    assert.ok(content.includes('PROVIDER_GROQ_APIKEY=new_value'));
    assert.ok(!content.includes('old_value'));
    assert.ok(content.includes('OTHER=keep'));
  });

  it('does not write empty keys', () => {
    fs.writeFileSync(TMP_ENV, 'EXISTING=val\n');
    loadSetup();
    setup.saveKeys({ PROVIDER_GROQ_APIKEY: '' });
    const content = fs.readFileSync(TMP_ENV, 'utf8');
    assert.ok(!content.includes('PROVIDER_GROQ_APIKEY'));
  });
});

describe('setup.KEY_GROUPS', () => {
  it('has 9 key groups', () => {
    loadSetup();
    assert.equal(Object.keys(setup.KEY_GROUPS).length, 9);
  });

  it('each group has name, url, description, steps', () => {
    loadSetup();
    for (const [envVar, group] of Object.entries(setup.KEY_GROUPS)) {
      assert.ok(group.name, `${envVar} missing name`);
      assert.ok(group.url, `${envVar} missing url`);
      assert.ok(group.description, `${envVar} missing description`);
      assert.ok(Array.isArray(group.steps) && group.steps.length >= 3, `${envVar} missing steps`);
    }
  });
});
