let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    console.log('beforeinstallprompt fired!'); // ← 追加
    e.preventDefault();
    deferredPrompt = e;
});

window.isInstallPromptAvailable = function () {
    return deferredPrompt !== null;
};

window.showInstallPrompt = async function () {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
    }
};