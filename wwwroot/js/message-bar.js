window.messageBar = window.messageBar || {};

(function () {
    let autoCloseTimer = null;
    let progressInterval = null;
    let currentAutoCloseMs = 0;
    let progressStartTime = 0;

    const typeStyles = {
        success: {
            bar: 'bg-green-500',
            box: 'bg-green-100 text-green-900 border border-green-400'
        },
        warn: {
            bar: 'bg-yellow-400',
            box: 'bg-yellow-100 text-yellow-900 border border-yellow-400'
        },
        error: {
            bar: 'bg-red-500',
            box: 'bg-red-400 text-white'
        }
    };

    window.messageBar.show = function (message, type = 'success', autoCloseMs = 5000) {
        try {
            const container = document.getElementById('message-bar-container');
            const textEl = document.getElementById('message-bar-text');
            const boxEl = document.getElementById('message-bar-box');
            const progressEl = document.getElementById('message-bar-progress');
            const closeBtn = document.getElementById('message-bar-close');

            if (!container || !textEl || !boxEl || !progressEl) {
                console.warn('messageBar: required elements not found');
                return;
            }

            // 既存のタイマーとインターバルをキャンセル
            clearTimeout(autoCloseTimer);
            clearInterval(progressInterval);
            autoCloseTimer = null;
            progressInterval = null;

            // メッセージとスタイルを設定
            textEl.textContent = message;

            const style = typeStyles[type] || typeStyles.success;
            progressEl.className = `h-full transition-all ${style.bar}`;
            boxEl.className = `px-4 py-2 rounded-b-lg shadow transition-all duration-300 ${style.box}`;

            // プログレスバーを初期状態（100%）に設定
            progressEl.style.width = '100%';

            // 表示
            container.style.display = 'block';

            // プログレスバーのアニメーション（60fps で更新）
            currentAutoCloseMs = autoCloseMs;
            progressStartTime = Date.now();

            progressInterval = setInterval(() => {
                const elapsed = Date.now() - progressStartTime;
                const remaining = Math.max(0, currentAutoCloseMs - elapsed);
                const percent = (remaining / currentAutoCloseMs) * 100;
                progressEl.style.width = `${percent}%`;

                if (remaining <= 0) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }
            }, 16); // 約60fps

            // 自動クローズタイマー
            if (autoCloseMs > 0) {
                autoCloseTimer = setTimeout(() => {
                    window.messageBar.hide();
                    autoCloseTimer = null;
                }, autoCloseMs);
            }

            // 閉じるボタンのイベントリスナー（既存のリスナーを削除してから追加）
            const newCloseBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
            newCloseBtn.addEventListener('click', () => window.messageBar.hide());

        } catch (e) {
            console.error('messageBar.show error', e);
        }
    };

    window.messageBar.hide = function () {
        try {
            const container = document.getElementById('message-bar-container');
            if (container) {
                container.style.display = 'none';
            }

            clearTimeout(autoCloseTimer);
            clearInterval(progressInterval);
            autoCloseTimer = null;
            progressInterval = null;
        } catch (e) {
            console.error('messageBar.hide error', e);
        }
    };
})();