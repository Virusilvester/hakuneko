const electron = require('electron');

// Electron's built-in `remote` module was removed in newer versions.
// Provide a backwards compatible shim so existing renderer code can keep using:
// `require('electron').remote.*`
try {
    if (!electron.remote) {
        Object.defineProperty(electron, 'remote', {
            value: require('@electron/remote'),
            configurable: true
        });
    }
} catch (error) {
    // ignore - remote will simply not be available
}
