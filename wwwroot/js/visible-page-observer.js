
window._visiblePageObserver = window._visiblePageObserver || {};
// スクロール時のアクティブページを取得
window.registerVisiblePageObserver = function (dotNetRef, containerId, debounceMs = 500) {
    try {

        try { window.unregisterVisiblePageObserver(containerId); } catch (e) { }

        const container = document.getElementById(containerId);
        if (!container) return;

        const items = Array.from(container.querySelectorAll('[id^="preview-container-"]'));
        if (!items || items.length === 0) return;

        const state = { pendingBest: -1, timer: null, lastIdx: -1, debounceMs: Number(debounceMs) || 500 };

        const cb = function (entries) {
            try {
                let bestIdx = -1;
                let bestRatio = 0;
                entries.forEach(en => {
                    const ratio = en.intersectionRatio || 0;
                    const id = en.target && en.target.id;
                    if (!id) return;
                    const parts = id.split('-');
                    const idx = Number(parts[parts.length - 1]);
                    if (!Number.isFinite(idx)) return;
                    if (ratio > bestRatio) {
                        bestRatio = ratio;
                        bestIdx = idx;
                    }
                });
                if (bestIdx >= 0) {

                    try {

                        if (state.lastIdx === bestIdx) {

                            return;
                        }
                        state.pendingBest = bestIdx;
                        if (state.timer) clearTimeout(state.timer);
                        state.timer = setTimeout(() => {
                            try {
                                if (state.lastIdx !== state.pendingBest) {
                                    state.lastIdx = state.pendingBest;
                                    dotNetRef.invokeMethodAsync('SetVisiblePageFromJs', state.pendingBest)
                                        .catch(() => { /* ignore */ });
                                    const topInput = document.getElementById('topbar-page-input');
                                    if (topInput) {
                                        topInput.value = String(state.pendingBest + 1);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                            state.timer = null;
                        }, state.debounceMs);
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        };

        const obs = new IntersectionObserver(cb, { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] });
        items.forEach(it => obs.observe(it));

        window._visiblePageObserver = window._visiblePageObserver || {};
        window._visiblePageObserver[containerId] = { observer: obs, items: items, dotNetRef: dotNetRef, state: state };
    } catch (e) {
        console.error('registerVisiblePageObserver error', e);
    }
};

window.unregisterVisiblePageObserver = function (containerId) {
    try {
        const entry = window._visiblePageObserver && window._visiblePageObserver[containerId];
        if (!entry) return;
        try { if (entry.state && entry.state.timer) clearTimeout(entry.state.timer); } catch (e) { }
        try { if (entry.observer) entry.observer.disconnect(); } catch (e) { }
        try { delete window._visiblePageObserver[containerId]; } catch (e) { }
    } catch (e) {
        console.error('unregisterVisiblePageObserver error', e);
    }
};