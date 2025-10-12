let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
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