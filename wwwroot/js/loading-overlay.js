window.loadingOverlay = {
    show: function(message) {
        const overlay = document.getElementById('loading-overlay');
        const messageEl = document.getElementById('loading-message');
        
        if (overlay) {
            overlay.classList.remove('hidden');
            if (messageEl && message) {
                messageEl.textContent = message;
            }
        }
    },
    
    hide: function() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
};