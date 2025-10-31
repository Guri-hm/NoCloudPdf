window._visiblePageObserver = window._visiblePageObserver || {};

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
                // viewport の中心座標を取得
                const containerRect = container.getBoundingClientRect();
                const viewportCenterY = containerRect.top + containerRect.height / 2;

                let bestIdx = -1;
                let bestDistance = Infinity;
                let bestRatio = 0;

                // 一定以上表示されている要素の最小 ratio（20% 以上表示されているもののみ対象）
                const MIN_VISIBLE_RATIO = 0.2;

                entries.forEach(en => {
                    const ratio = en.intersectionRatio || 0;
                    
                    // 20% 以上表示されている要素のみ対象にする
                    if (ratio < MIN_VISIBLE_RATIO) return;

                    const id = en.target?.id;
                    if (!id) return;

                    const parts = id.split('-');
                    const idx = Number(parts[parts.length - 1]);
                    if (!Number.isFinite(idx)) return;

                    // 要素の中心座標を計算
                    const rect = en.target.getBoundingClientRect();
                    const elementCenterY = rect.top + rect.height / 2;
                    const distance = Math.abs(elementCenterY - viewportCenterY);

                    // 優先順位: 
                    // 1) viewport 中心に最も近い要素
                    // 2) 距離が近い場合（要素の高さの 10% 以内）は intersectionRatio が大きい方
                    const elementHeight = rect.height;
                    const distanceThreshold = elementHeight * 0.1; // 要素の高さの 10% を閾値にする

                    const isCloser = distance < bestDistance - distanceThreshold;
                    const isSimilarDistanceButMoreVisible = 
                        Math.abs(distance - bestDistance) <= distanceThreshold && ratio > bestRatio;

                    if (isCloser || isSimilarDistanceButMoreVisible) {
                        bestDistance = distance;
                        bestRatio = ratio;
                        bestIdx = idx;
                    }
                });

                if (bestIdx >= 0 && bestIdx !== state.lastIdx) {
                    state.pendingBest = bestIdx;
                    if (state.timer) clearTimeout(state.timer);

                    state.timer = setTimeout(() => {
                        try {
                            if (state.lastIdx !== state.pendingBest) {
                                state.lastIdx = state.pendingBest;

                                // UI を直接更新（再レンダリング回避）
                                try {
                                    const topInput = document.getElementById('topbar-page-input');
                                    if (topInput) {
                                        topInput.value = String(state.pendingBest + 1);
                                    }
                                } catch (e) { /* ignore */ }

                                // Blazor 側に通知（StateHasChanged を呼ばない実装であること前提）
                                try {
                                    if (dotNetRef && typeof dotNetRef.invokeMethodAsync === 'function') {
                                        dotNetRef.invokeMethodAsync('SetVisiblePageFromJs', state.pendingBest)
                                            .catch(() => { /* ignore */ });
                                    }
                                } catch (e) { /* ignore */ }
                            }
                        } catch (e) { /* ignore */ }
                        state.timer = null;
                    }, state.debounceMs);
                }
            } catch (e) {
                console.error('visible page observer callback error', e);
            }
        };

        // threshold を減らして発火頻度を下げる（0.5 前後のみ検出）
        const obs = new IntersectionObserver(cb, { 
            root: container, 
            threshold: [0, 0.2, 0.5, 0.8, 1] // 発火を減らして安定化
        });
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