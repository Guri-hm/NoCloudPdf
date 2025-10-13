(function () {
    const SESSION_KEY = "ncp_tour_ran";
    const Tour_Name = "home-intro-v1";

    function hasSessionRun() {
        try { return sessionStorage.getItem(SESSION_KEY) === "true"; } catch (e) { return false; }
    }
    function setSessionRun() {
        try { sessionStorage.setItem(SESSION_KEY, "true"); } catch (e) { }
    }

    function isVisible(el) {
        try {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            console.log('isVisible:', style.display);
            return style && style.display !== 'none';
        } catch (e) {
            return false;
        }
    }

    function buildSteps() {
        const isMobile = (typeof window !== 'undefined') && window.innerWidth < 768;

        const steps = [
            isMobile
                ? { id: 'nav-explain', selector: '#nav-hamburger', title: 'メニュー表示', text: '機能の切替メニューを表示できます。すぐに利用される方はこちらから。', position: 'right', group: Tour_Name }
                : { id: 'nav-explain', selector: '#nav-main', title: '切替メニュー', text: '機能の切替メニューです。すぐに利用される方は，目的の機能をクリックしてください。', position: 'right', group: Tour_Name },
            { id: 'home-tip', selector: '#home-summary-tip', title: '概要', text: 'このページ下部にアプリの概要があります。', position: 'top', group: Tour_Name }
        ];

        try {
            const installBtn = document.querySelector('#install-pwa-btn');
            if (installBtn && isVisible(installBtn)) {
                steps.push({
                    id: 'install-pwa',
                    selector: '#install-pwa-btn',
                    title: 'インストール',
                    text: 'アプリのショートカットを作成できます。',
                    position: 'left',
                    group: Tour_Name
                });
            }
        } catch (e) {
            console.debug('tour: check install-pwa failed', e);
        }

        return steps;
    }

    function handleComplete() {
        try {
            const cb = document.getElementById('ncp-tour-dontshow');
            if (cb && cb.checked) setEnabled(false);
        } catch (e) { }
    }

    function waitForInstallFlag(selector = '#install-pwa-btn-flag', timeout = 1000, interval = 100) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                try {
                    const el = document.querySelector(selector);
                    if (el) {
                        const v = (el.value || '').toString().toLowerCase();
                        if (v === 'true') return resolve(true);
                        if (v === 'false') return resolve(false);
                        // pending/empty -> 続行して待つ
                    }
                } catch (e) { }

                if (Date.now() - start >= timeout) return resolve(false);
                setTimeout(check, interval);
            };
            check();
        });
    }

    async function startTour() {

        // インストールボタンの表示状態が確定するまで待つ（最大1秒）
        try { await waitForInstallFlag('#install-pwa-btn-flag', 1000, 100); } catch (e) { }
        const steps = buildSteps();

        // 既存のツアーが残っていたら止めて破棄する（再表示時の壊れたUI対策）
        function stopExistingTour() {

            try {
                document.querySelectorAll('.tg-backdrop, .tg-dialog').forEach(n => {
                    try { n.remove(); } catch (e) { }
                });
            } catch (e) { }

            if (window._ncpTour) window._ncpTour.client = null;
        }

        stopExistingTour();

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

                const tg = new tourguide.TourGuideClient({ steps: tgSteps, ...tgOptions });

                if (tg) {
                    tg.onFinish(async () => {
                        handleComplete();
                    })

                    if (!tg.isFinished(Tour_Name)) {

                        tg.start(Tour_Name);

                    }

                    // 正常に start を呼んだので「このタブでは既に実行済み」とマーク
                    try { setSessionRun(); } catch (e) { }
                }

                return true;
            } catch (e) {
                console.debug('tour: TourGuideClient init failed', e);
            }
        }

        console.debug('tour: no compatible start method found');
        return false;
    }

    function isHomePath() {
        const base = (document.querySelector('base')?.getAttribute('href') || '/').replace(/\/$/, '');
        const path = location.pathname.replace(new RegExp('^' + base), '') || '/';
        return path === '/' || path === '';
    }

    window.startTourIfNeeded = async function (opts = {}) {

        function isEnabled() {
            const tg = new tourguide.TourGuideClient();
            if (tg.isFinished(Tour_Name)) return false;
            return true;
        }

        if (!isEnabled()) return;
        if (!isHomePath()) return;

        // 同一タブ内で既に実行済みなら再実行しない
        if (hasSessionRun()) {
            return;
        }

        const ok = await startTour();
        if (!ok) return;

    };

    window._ncpTour = {
        startTourIfNeeded: window.startTourIfNeeded,
    };
})();