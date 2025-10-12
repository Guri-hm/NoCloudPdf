(function () {
    const STORAGE_KEY = "ncp_show_tour";

    function isEnabled() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            return v === null ? true : v !== "false";
        } catch (e) { return true; }
    }
    function setEnabled(flag) {
        try { localStorage.setItem(STORAGE_KEY, flag ? "true" : "false"); } catch (e) { }
    }

    function buildSteps() {
        const isMobile = (typeof window !== 'undefined') && window.innerWidth < 768;

        const steps = [
            isMobile
                ? { id: 'nav-explain', selector: '#nav-hamburger', title: 'メニュー表示', text: '機能の切替メニューを表示できます。すぐに利用される方はこちらから。', position: 'right' }
                : { id: 'nav-explain', selector: '#nav-main', title: '切替メニュー', text: '機能の切替メニューです。すぐに利用される方は，目的の機能をクリックしてください。', position: 'right' },
            { id: 'home-tip', selector: '#home-summary-tip', title: '概要', text: 'このページ下部にアプリの概要があります。', position: 'top' }
        ];

        // DOM上の data-tg-tour 属性を持つ要素を自動検出してステップに追加
        try {
            const nodes = Array.from(document.querySelectorAll('[data-tg-tour]'));
            nodes.forEach((el, idx) => {
                if (!el.id) {
                    el.id = `ncp-tg-auto-${Date.now().toString(36)}-${idx}`;
                }
                const selector = `#${el.id}`;
                const title = el.getAttribute('data-tg-tour') || '';
                const content = el.getAttribute('data-tg-content') || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 300);
                const pos = el.getAttribute('data-tg-placement') || 'auto';
                steps.push({ id: `auto-${idx}`, selector: selector, title: title, text: content, position: pos });
            });
        } catch (e) {
            console.debug('tour: buildSteps auto-detect failed', e);
        }

        try {
            const installBtn = document.querySelector('#install-pwa-btn');
            if (installBtn && isVisible(installBtn)) {
                steps.push({
                    id: 'install-pwa',
                    selector: '#install-pwa-btn',
                    title: 'インストール',
                    text: 'ここから アプリのインストールをおこなえます。',
                    position: 'left'
                });
            }
        } catch (e) {
            console.debug('tour: check install-pwa failed', e);
        }

        // 最後のステップに「次回から表示しない」チェックボックスを追加する（既に含めていた場合は二重追加を避ける）
        try {
            if (steps.length > 0) {
                const checkboxHtml = '<br/><label style="display:inline-flex;align-items:center;margin-top:8px;"><input id="ncp-tour-dontshow" type="checkbox" style="margin-right:8px;"> 次回から表示しない</label>';
                const last = steps[steps.length - 1];
                if (typeof last.text === 'string' && last.text.indexOf('ncp-tour-dontshow') === -1) {
                    last.text = (last.text || '') + checkboxHtml;
                }
            }
        } catch (e) {
            console.debug('tour: append checkbox failed', e);
        }

        return steps;
    }

    function handleComplete() {
        try {
            const cb = document.getElementById('ncp-tour-dontshow');
            if (cb && cb.checked) setEnabled(false);
        } catch (e) { }
    }

    function attachHandlersIfPossible(tourObj) {
        if (!tourObj) return;
        try {
            if (typeof tourObj.on === 'function') {
                tourObj.on('complete', handleComplete);
                tourObj.on('cancel', handleComplete);
            } else if (typeof tourObj.then === 'function') {
                tourObj.then(handleComplete).catch(() => { });
            }
        } catch (e) { }
    }

    // TourGuideClient を優先してインスタンス化して start() を呼ぶ実装
    function startTourUsingLibrary() {
        const steps = buildSteps();

        // まず TourGuide のクライアント/名前空間を探す
        const TGClientCtor = window.tourguide?.TourGuideClient || window.TourGuideClient || window.tourguide || null;

        if (typeof TGClientCtor === 'function' || (TGClientCtor && typeof TGClientCtor === 'object')) {
            try {
                const tgSteps = steps.map((s, idx) => {
                    const el = document.querySelector(s.selector);
                    return {
                        title: s.title || '',
                        content: s.text || '',
                        target: el || s.selector,
                        order: s.order ?? (idx + 1),
                        group: s.group ?? undefined
                    };
                });

                const tgOptions = {
                    nextLabel: '次へ',
                    prevLabel: '戻る',
                    finishLabel: '終了',
                    onAfterExit: handleComplete,
                    completeOnFinish: true,
                };

                // インスタンス化: library によりコンストラクタの位置が異なるため対応
                let client = null;
                if (typeof window.tourguide === 'object' && typeof window.tourguide.TourGuideClient === 'function') {
                    client = new window.tourguide.TourGuideClient({ steps: tgSteps, ...tgOptions });
                } else if (typeof window.TourGuideClient === 'function') {
                    client = new window.TourGuideClient({ steps: tgSteps, ...tgOptions });
                } else if (typeof TGClientCtor === 'function') {
                    client = new TGClientCtor({ steps: tgSteps, ...tgOptions });
                } else if (TGClientCtor && typeof TGClientCtor.create === 'function') {
                    client = TGClientCtor.create({ steps: tgSteps, ...tgOptions });
                }

                if (client && typeof client.start === 'function') {
                    if (typeof client.on === 'function') {
                        try {
                            client.on('complete', handleComplete);
                            client.on('cancel', handleComplete);
                        } catch (e) { }
                    }

                    client.onFinish(async () => {
                        handleComplete();
                    })
                    client.start();
                } else {
                    // 一部の実装はコンストラクタで自動開始する場合がある
                }

                console.debug('tour: started via TourGuide client', !!client);
                return true;
            } catch (e) {
                console.debug('tour: TourGuideClient init failed', e);
                // fallthrough to generic attempts
            }
        }

        // 汎用フォールバック: 他ライブラリ名を試す（create/start/init/new）
        const libs = [
            window.tourguide,
            window.TourGuide,
            window.TourGuideJS,
            window.Tour,
            window.tour,
            window.TourGuideDefault
        ].filter(Boolean);
        if (libs.length === 0) {
            console.debug('tour: no tour lib found on window');
            return false;
        }

        const toTargetSteps = (srcSteps) => srcSteps.map(s => {
            const el = document.querySelector(s.selector);
            return {
                id: s.id,
                target: el || s.selector,
                title: s.title,
                text: s.text,
                content: s.text,
                placement: s.position,
                position: s.position
            };
        });

        for (const lib of libs) {
            const mapped = toTargetSteps(steps);
            try {
                if (typeof lib.start === 'function') {
                    console.debug('tour: trying lib.start on', lib);
                    const tourObj = lib.start(mapped, { onComplete: handleComplete, onCancel: handleComplete });
                    attachHandlersIfPossible(tourObj);
                    return true;
                }
                if (typeof lib.create === 'function') {
                    console.debug('tour: trying lib.create');
                    const inst = lib.create({ steps: mapped });
                    if (inst && typeof inst.start === 'function') {
                        if (typeof inst.on === 'function') {
                            inst.on('complete', handleComplete);
                            inst.on('cancel', handleComplete);
                        }
                        inst.start();
                        attachHandlersIfPossible(inst);
                        return true;
                    }
                }
                if (typeof lib.init === 'function') {
                    console.debug('tour: trying lib.init');
                    const inst = lib.init({ steps: mapped });
                    if (inst && typeof inst.start === 'function') {
                        inst.start();
                        attachHandlersIfPossible(inst);
                        return true;
                    }
                }
                if (typeof lib === 'function') {
                    try {
                        console.debug('tour: trying new lib(...)');
                        const inst = new lib({ steps: mapped, onComplete: handleComplete, onCancel: handleComplete });
                        if (inst && typeof inst.start === 'function') {
                            inst.start();
                            attachHandlersIfPossible(inst);
                            return true;
                        }
                    } catch (e) { /* ignore */ }
                }
            } catch (e) {
                console.debug('tour: mapping/start attempt failed', e);
            }
        }

        console.debug('tour: no compatible start method found');
        return false;
    }

    // Home 判定（base href を考慮）
    function isHomePath() {
        const base = (document.querySelector('base')?.getAttribute('href') || '/').replace(/\/$/, '');
        const path = location.pathname.replace(new RegExp('^' + base), '') || '/';
        return path === '/' || path === '';
    }

    window.startTourIfNeeded = async function (opts = {}) {
        if (!isEnabled()) return;
        if (!isHomePath()) return;

        const ok = startTourUsingLibrary();
        if (!ok) return;

    };

    window._ncpTour = {
        startTourIfNeeded: window.startTourIfNeeded,
    };
})();