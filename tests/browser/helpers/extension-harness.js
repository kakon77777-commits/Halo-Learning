function resolveChromiumExecutable(options) {
  const explicit = options.environment.HALO_CHROMIUM_EXECUTABLE;
  if (explicit && options.exists(explicit)) {
    return Object.freeze({ path: explicit, source: 'environment' });
  }
  if (options.playwrightExecutable && options.exists(options.playwrightExecutable)) {
    return Object.freeze({ path: options.playwrightExecutable, source: 'playwright' });
  }
  throw new Error('Chromium executable is required for Halo browser gates');
}

async function launchExtension({ extensionRoot, userDataDir, headless, executablePath }) {
  const { chromium } = require('playwright');
  return chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless,
    args: [
      '--disable-extensions-except=' + extensionRoot,
      '--load-extension=' + extensionRoot,
      '--enable-precise-memory-info',
      '--no-sandbox'
    ]
  });
}

module.exports = Object.freeze({
  launchExtension,
  resolveChromiumExecutable
});
