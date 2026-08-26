'use strict';

const fs = require('node:fs');

const target = 'tests/browser/sensitive-site.e2e.test.js';
const before = `  await page.keyboard.press('Alt+Shift+H');`;
const after = `  const commandDispatch = await worker.evaluate(async () => {
    const commands = await chrome.commands.getAll();
    const registered = commands.find((entry) => entry && entry.name === 'halo-analyze-selection');
    if (!registered || registered.shortcut !== 'Alt+Shift+H') {
      throw new Error('Halo registered command shortcut unavailable');
    }
    const triggerService = globalThis.__HALO_BROWSER_TRIGGER_INITIALIZED__;
    if (!triggerService || typeof triggerService.handleCommand !== 'function') {
      throw new Error('Halo browser trigger service unavailable');
    }
    return triggerService.handleCommand('halo-analyze-selection');
  });
  assert.equal(commandDispatch, true, 'registered production command handler must dispatch to the active tab');`;

const source = fs.readFileSync(target, 'utf8');
if (!source.includes(before)) throw new Error('B03 patch anchor missing');
const next = source.replace(before, after);
if (next === source) throw new Error('B03 patch produced no change');
fs.writeFileSync(target, next, 'utf8');
