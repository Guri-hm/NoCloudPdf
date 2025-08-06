let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    console.log('beforeinstallprompt fired!'); // ← 追加
    e.preventDefault();
    deferredPrompt = e;
});

export function isInstallPromptAvailable() {
    return deferredPrompt !== null;
}

export async function showInstallPrompt() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
    }
}