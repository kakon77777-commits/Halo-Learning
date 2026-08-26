'use strict';

const { execFileSync } = require('node:child_process');

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

function nativeBrowserWindow() {
  let active = '';
  try {
    active = execFileSync('xdotool', ['getactivewindow'], { encoding: 'utf8' }).trim();
    if (active) {
      const className = execFileSync('xdotool', ['getwindowclassname', active], { encoding: 'utf8' }).trim();
      if (/chrom/i.test(className)) return active;
    }
  } catch (_error) {
    // Fall through to a visible Chromium window search.
  }

  const output = execFileSync(
    'xdotool',
    ['search', '--onlyvisible', '--class', '[Cc]hrom.*'],
    { encoding: 'utf8' }
  ).trim();
  const windows = output.split(/\s+/).filter(Boolean);
  if (!windows.length) throw new Error('HALO native shortcut driver could not locate a visible Chromium window');
  return windows[windows.length - 1];
}

function installNativeShortcutDriver(context) {
  if (process.env.HALO_NATIVE_SHORTCUT_DRIVER !== 'xdotool') return;

  const install = (page) => {
    if (!page || page.__haloNativeShortcutDriverInstalled === true) return;
    const keyboard = page.keyboard;
    const playwrightPress = keyboard.press.bind(keyboard);
    keyboard.press = async (key, options) => {
      if (key !== 'Alt+Shift+H') return playwrightPress(key, options);
      await page.bringToFront();
      const windowId = nativeBrowserWindow();
      execFileSync('xdotool', ['windowfocus', '--sync', windowId], { stdio: 'inherit' });
      execFileSync(
        'xdotool',
        ['key', '--window', windowId, '--clearmodifiers', 'alt+shift+h'],
        { stdio: 'inherit' }
      );
    };
    Object.defineProperty(page, '__haloNativeShortcutDriverInstalled', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
  };

  context.on('page', install);
  for (const page of context.pages()) install(page);
}

async function launchExtension({ extensionRoot, userDataDir, headless, executablePath }) {
  const { chromium } = require('playwright');
  const useNativeShortcutDriver = process.env.HALO_NATIVE_SHORTCUT_DRIVER === 'xdotool';
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: useNativeShortcutDriver ? false : headless,
    args: [
      '--disable-extensions-except=' + extensionRoot,
      '--load-extension=' + extensionRoot,
      '--enable-precise-memory-info',
      '--no-sandbox'
    ]
  });
  installNativeShortcutDriver(context);
  return context;
}

module.exports = Object.freeze({
  launchExtension,
  resolveChromiumExecutable
});
