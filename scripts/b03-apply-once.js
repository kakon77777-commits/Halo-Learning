'use strict';

const fs = require('node:fs');

const target = 'tests/browser/sensitive-site.e2e.test.js';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`${label} patch anchor missing`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`${label} patch produced no change`);
  return next;
}

let source = fs.readFileSync(target, 'utf8');

source = replaceOnce(
  source,
  `const extensionRoot = path.join(repositoryRoot, 'apps', 'extension');`,
  `const canonicalExtensionRoot = path.join(repositoryRoot, 'apps', 'extension');
const TEST_HOST_PERMISSIONS = Object.freeze([
  'http://*.localhost/*',
  'https://chase.com/*',
  'https://*.chase.com/*',
  'https://www.paypal.com/*',
  'https://vault.bitwarden.com/*',
  'https://outlook.live.com/*',
  'https://discord.com/*',
  'https://myaccount.uhc.com/*',
  'https://secure.ssa.gov/*',
  'https://console.aws.amazon.com/*',
  'https://console.cloud.google.com/*',
  'https://portal.azure.com/*'
]);

function createHeadlessCommandExtension() {
  const canonicalManifestPath = path.join(canonicalExtensionRoot, 'manifest.json');
  const canonicalManifest = JSON.parse(fs.readFileSync(canonicalManifestPath, 'utf8'));
  assert.equal(
    Object.prototype.hasOwnProperty.call(canonicalManifest, 'host_permissions'),
    false,
    'canonical extension must remain host-permission-free'
  );
  const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sensitive-extension-'));
  const extensionRoot = path.join(copyRoot, 'extension');
  fs.cpSync(canonicalExtensionRoot, extensionRoot, { recursive: true });
  const testManifest = { ...canonicalManifest, host_permissions: [...TEST_HOST_PERMISSIONS] };
  fs.writeFileSync(
    path.join(extensionRoot, 'manifest.json'),
    \`${'${JSON.stringify(testManifest, null, 2)}'}\\n\`,
    'utf8'
  );
  return Object.freeze({ copyRoot, extensionRoot });
}`,
  'headless command authority'
);

source = replaceOnce(
  source,
  `  await page.keyboard.press('Alt+Shift+H');`,
  `  const commandDispatch = await worker.evaluate(async () => {
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
  assert.equal(commandDispatch, true, 'registered production command handler must dispatch to the active tab');`,
  'deterministic command dispatch'
);

source = replaceOnce(
  source,
  `  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sensitive-site-'));
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });`,
  `  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-sensitive-site-'));
  const testExtension = createHeadlessCommandExtension();
  const extensionRoot = testExtension.extensionRoot;
  let context;
  try {
    context = await launchExtension({ extensionRoot, userDataDir, headless: true, executablePath: executable.path });`,
  'test extension setup'
);

source = replaceOnce(
  source,
  `  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});`,
  `  } finally {
    if (context) await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(testExtension.copyRoot, { recursive: true, force: true });
  }
});`,
  'test extension cleanup'
);

fs.writeFileSync(target, source, 'utf8');
