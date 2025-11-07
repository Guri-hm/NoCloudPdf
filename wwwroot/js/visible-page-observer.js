window._visiblePageObserver = window._visiblePageObserver || {};

// ========================================
// ★ 追加：Observer の一時停止/再開機能
// ========================================
window._visiblePageObserver.isPaused = false;

/**
 * 可視ページ監視の一時停止
 */
window.pauseVisiblePageObserver = function() {
    try {
        window._visiblePageObserver.isPaused = true;
    } catch (e) {
        console.error('pauseVisiblePageObserver error', e);
    }
};

/**
 * 可視ページ監視の再開
 */
window.resumeVisiblePageObserver = function() {
    try {
        window._visiblePageObserver.isPaused = false;
    } catch (e) {
        console.error('resumeVisiblePageObserver error', e);
    }
};

// ========================================
// 既存のコード（変更なし）
// ========================================
window.registerVisiblePageObserver = function (dotNetRef, containerId, debounceMs = 200, options = {}) {
    try {
        try { window.unregisterVisiblePageObserver(containerId); } catch (e) { }

        const container = document.getElementById(containerId);
        if (!container) return;

        const nodes = Array.from(container.querySelectorAll('[id^="preview-container-"]'));
        if (!nodes || nodes.length === 0) return;

        const OPT = {
            rootMargin: options.rootMargin ?? '0px',
            debounceMs: Number(debounceMs) || 200,
            minAreaRatio: options.minAreaRatio ?? 0.01, // 要素面積に対する最小割合（1%）
            minAreaPx: options.minAreaPx ?? 100,        // これ未満は候補外（ピクセル）
            requiredStreak: options.requiredStreak ?? 1 // 連続ヒット数（必要なら 2 に）
        };

        // state: 各要素の最新情報を保持
        const itemState = new Map(); // idx -> { area, ratio, elArea, lastSeenAt }
        const state = { pendingBest: -1, timer: null, lastIdx: -1, streaks: {}, lastCandidate: -1, idleHandle: null };

        function parseIndexFromId(id) {
            const m = id && id.match(/-(\d+)$/);
            return m ? Number(m[1]) : NaN;
        }

        function rectIntersectArea(a, b) {
            const left = Math.max(a.left, b.left);
            const top = Math.max(a.top, b.top);
            const right = Math.min(a.right, b.right);
            const bottom = Math.min(a.bottom, b.bottom);
            const w = Math.max(0, right - left);
            const h = Math.max(0, bottom - top);
            return w * h;
        }

        // 初期化：各要素の elArea を登録
        nodes.forEach(el => {
            const idx = parseIndexFromId(el.id);
            if (!Number.isFinite(idx)) return;
            const r = el.getBoundingClientRect();
            const elArea = Math.max(1, r.width * r.height);
            itemState.set(idx, { area: 0, ratio: 0, elArea: elArea, lastSeenAt: 0 });
        });

        function flushPending() {
            if (state.timer) { clearTimeout(state.timer); state.timer = null; }
            const idx = state.pendingBest;
            if (idx < 0 || idx === state.lastIdx) return;
            state.lastIdx = idx;

            try {
                const topInput = document.getElementById('topbar-page-input');
                if (topInput) topInput.value = String(idx + 1);
            } catch (e) { /* ignore */ }

            // ★ 追加：selectThumbnailByIndex を呼び出し（青枠を更新）
            try {
                if (typeof window.selectThumbnailByIndex === 'function') {
                    window.selectThumbnailByIndex(idx);
                }
            } catch (e) { /* ignore */ }

            const callDotNet = () => {
                try {
                    if (dotNetRef && typeof dotNetRef.invokeMethodAsync === 'function') {
                        dotNetRef.invokeMethodAsync('SetVisiblePageFromJs', idx).catch(()=>{});
                    }
                } catch (e) { /* ignore */ }
            };

            if (window.requestIdleCallback) {
                try {
                    if (state.idleHandle) { try { window.cancelIdleCallback(state.idleHandle); } catch {} state.idleHandle = null; }
                    state.idleHandle = window.requestIdleCallback(() => { callDotNet(); state.idleHandle = null; }, { timeout: 1000 });
                } catch (e) {
                    setTimeout(callDotNet, 0);
                }
            } else {
                setTimeout(callDotNet, 0);
            }
        }

        const cb = function (entries) {
            // ★ 追加：一時停止中は処理をスキップ
            if (window._visiblePageObserver.isPaused) {
                return;
            }

            try {
                const now = performance.now();
                const containerRect = container.getBoundingClientRect();

                // 更新されたエントリだけ Map に反映
                entries.forEach(en => {
                    const el = en.target;
                    if (!el || !el.id) return;
                    const idx = parseIndexFromId(el.id);
                    if (!Number.isFinite(idx)) return;

                    const rect = en.boundingClientRect || el.getBoundingClientRect();
                    const elArea = Math.max(1, rect.width * rect.height);

                    let interArea = 0;
                    if (en.intersectionRect && en.intersectionRect.width && en.intersectionRect.height) {
                        interArea = en.intersectionRect.width * en.intersectionRect.height;
                    } else {
                        // fallback: container vs element intersection
                        const interRect = {
                            left: Math.max(containerRect.left, rect.left),
                            top: Math.max(containerRect.top, rect.top),
                            right: Math.min(containerRect.right, rect.right),
                            bottom: Math.min(containerRect.bottom, rect.bottom)
                        };
                        interArea = rectIntersectArea(interRect, rect);
                        // if zero, fallback to ratio * elArea
                        if (interArea === 0) interArea = (en.intersectionRatio || 0) * elArea;
                    }

                    const ratio = Math.max(0, Math.min(1, interArea / Math.max(1, elArea)));
                    itemState.set(idx, { area: interArea, ratio: ratio, elArea: elArea, lastSeenAt: now });
                });

                // 全要素の最新状態を走査して最も面積が大きいものを選ぶ
                let bestIdx = -1;
                let bestArea = -1;
                // allow fallback if none exceed thresholds
                let fallbackIdx = -1;
                let fallbackArea = -1;

                itemState.forEach((v, k) => {
                    // ignore stale items not seen recently?（任意）ここではそのまま利用
                    const area = v.area || 0;
                    if (area > bestArea) {
                        bestArea = area;
                        bestIdx = k;
                    }
                    if (area > fallbackArea) { fallbackArea = area; fallbackIdx = k; }
                });

                // しきい値: 面積が要素面積の割合 or px を超えないなら候補外
                if (bestIdx >= 0) {
                    const best = itemState.get(bestIdx);
                    const pass = (best.area >= Math.max(OPT.minAreaPx, best.elArea * OPT.minAreaRatio));
                    if (!pass) {
                        // fallback にする（最大でも閾値未満なら none）
                        bestIdx = -1;
                    }
                }

                if (bestIdx < 0 && fallbackIdx >= 0) {
                    // fallback: accept only if non-zero area
                    const fb = itemState.get(fallbackIdx);
                    if (fb && fb.area > 0) bestIdx = fallbackIdx;
                }

                if (bestIdx >= 0 && bestIdx !== state.pendingBest) {
                    // simple streak logic
                    if (state.lastCandidate === bestIdx) {
                        state.streaks[bestIdx] = (state.streaks[bestIdx] || 0) + 1;
                    } else {
                        state.streaks[bestIdx] = (state.streaks[bestIdx] || 0) + 1;
                        // decay others
                        Object.keys(state.streaks).forEach(k => {
                            const ki = Number(k);
                            if (ki !== bestIdx) state.streaks[ki] = Math.max(0, (state.streaks[ki] || 0) - 1);
                        });
                    }
                    state.lastCandidate = bestIdx;

                    if ((state.streaks[bestIdx] || 0) >= OPT.requiredStreak) {
                        state.pendingBest = bestIdx;
                        if (state.timer) clearTimeout(state.timer);
                        state.timer = setTimeout(() => { try { flushPending(); } catch (e) { } }, OPT.debounceMs);
                    }
                } else {
                    // decay streaks
                    Object.keys(state.streaks).forEach(k => {
                        state.streaks[k] = Math.max(0, (state.streaks[k] || 0) - 1);
                        if (state.streaks[k] === 0) delete state.streaks[k];
                    });
                    state.lastCandidate = -1;
                }
            } catch (e) {
                console.error('visible page observer callback error', e);
            }
        };

        const obs = new IntersectionObserver(cb, {
            root: container,
            rootMargin: OPT.rootMargin,
            threshold: [0, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1]
        });

        // observe all nodes and ensure itemState has entries (already initialized above)
        nodes.forEach(n => obs.observe(n));

        window._visiblePageObserver = window._visiblePageObserver || {};
        window._visiblePageObserver[containerId] = { observer: obs, nodes: nodes, dotNetRef: dotNetRef, state: state, itemState: itemState };
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