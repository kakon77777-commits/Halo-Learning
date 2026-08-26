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

function extensionLaunchArguments(extensionRoot) {
  return Object.freeze([
    '--disable-extensions-except=' + extensionRoot,
    '--load-extension=' + extensionRoot,
    '--enable-unsafe-extension-debugging',
    '--enable-precise-memory-info',
    '--no-sandbox'
  ]);
}

async function launchExtension({ extensionRoot, userDataDir, headless, executablePath }) {
  const { chromium } = require('playwright');
  return chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless,
    args: extensionLaunchArguments(extensionRoot)
  });
}

module.exports = Object.freeze({
  extensionLaunchArguments,
  launchExtension,
  resolveChromiumExecutable
});
