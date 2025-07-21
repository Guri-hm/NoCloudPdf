// 指定input要素をクリックしてファイル選択ダイアログを開く（PDF挿入用）
window.openInsertFileDialog = function (elementId) {
    const fileInput = document.getElementById(elementId);
    if (fileInput) {
        fileInput.value = null; // 連続選択対応
        fileInput.click();
    }
};
window.openFileDialog = function (elementId) {
    const fileInput = document.getElementById(elementId);
    if (fileInput) {
        fileInput.click();
    }
};

// 挿入メニューをクリック座標に直接表示
window.showInsertMenuAtExactPosition = function (position, clickX, clickY) {

    // 既存メニューをすべて削除
    window.hideAllInsertMenus();

    // 動的にメニューを作成
    const menu = document.createElement('div');
    menu.id = `dynamic-menu-${position}`;
    menu.className = 'insert-menu-dynamic';
    menu.setAttribute('data-position', position); // データ属性を追加（DOM再構築時の識別用）

    // メニューの幅を定義
    const menuWidth = 240;

    // クリック位置を基準にメニューの位置を計算
    // 水平方向：メニューの中心がクリック位置に来るように（メニュー幅の半分だけ左にずらす）
    // 垂直方向：メニューの上部がクリック位置に来るように
    let menuTop = clickY;                    // クリック位置と同じY座標（メニュー上部）
    let menuLeft = clickX - (menuWidth / 2); // クリック位置からメニュー幅の半分だけ左にずらす（メニュー中心）

    // 画面境界チェック（メニューが画面からはみ出ないように調整）
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 左端チェック
    if (menuLeft < 0) {
        menuLeft = 10; // 左端から10px離す
    }

    // 右端チェック
    if (menuLeft + menuWidth > viewportWidth) {
        menuLeft = viewportWidth - menuWidth - 10; // 右端から10px離す
    }

    // 下端チェック（概算メニュー高さ100pxとして）
    const estimatedMenuHeight = 100;
    if (menuTop + estimatedMenuHeight > viewportHeight) {
        menuTop = clickY - estimatedMenuHeight - 10; // クリック位置の上に表示
    }

    menu.style.cssText = `
        position: fixed;
        top: ${menuTop}px;
        left: ${menuLeft}px;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        width: ${menuWidth}px;
        z-index: 1000;
        display: block;
    `;

    // メニューボタンを作成
    const blankPageBtn = document.createElement('button');
    blankPageBtn.innerHTML = '📄 空白ページの挿入';
    blankPageBtn.className = 'w-full px-4 py-2 text-left hover:bg-gray-100 border-b border-gray-200';
    blankPageBtn.style.cssText = 'border: none; background: none; cursor: pointer;';
    blankPageBtn.onclick = () => {
        window.DotNet.invokeMethodAsync('ClientPdfApp', 'InsertBlankPageFromJS', position);
        window.hideAllInsertMenus();
    };

    const insertPdfBtn = document.createElement('button');
    insertPdfBtn.innerHTML = '📁 PDFを選択して挿入';
    insertPdfBtn.className = 'w-full px-4 py-2 text-left hover:bg-gray-100';
    insertPdfBtn.style.cssText = 'border: none; background: none; cursor: pointer;';
    insertPdfBtn.onclick = () => {
        window.DotNet.invokeMethodAsync('ClientPdfApp', 'InsertPdfAtPositionFromJS', position);
        window.hideAllInsertMenus();
    };

    menu.appendChild(blankPageBtn);
    menu.appendChild(insertPdfBtn);

    // bodyに追加
    document.body.appendChild(menu);

    // 背景オーバーレイを作成（イベント委譲で永続化）
    const overlay = document.createElement('div');
    overlay.id = `overlay-${position}`;
    overlay.className = 'insert-menu-overlay';
    overlay.setAttribute('data-position', position);
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 999; background: transparent;';

    // より強力なイベントハンドリング（キャプチャフェーズで処理）
    overlay.addEventListener('click', function (event) {
        console.log('Overlay clicked - hiding menus');
        event.preventDefault();
        event.stopPropagation();
        window.hideAllInsertMenus();
    }, true); // true = キャプチャフェーズ

    // ESCキーでメニューを閉じる
    const escapeHandler = function (event) {
        if (event.key === 'Escape') {
            console.log('Escape key pressed - hiding menus');
            window.hideAllInsertMenus();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);

    document.body.appendChild(overlay);

};

window.hideInsertMenu = function (position) {
    const menu = document.getElementById(`dynamic-menu-${position}`);
    const overlay = document.getElementById(`overlay-${position}`);

    if (menu) {
        menu.remove();
    }
    if (overlay) {
        overlay.remove();
    }

};

window.hideAllInsertMenus = function () {

    // 動的メニューをすべて削除
    const menus = document.querySelectorAll('.insert-menu-dynamic');
    const overlays = document.querySelectorAll('.insert-menu-overlay');

    menus.forEach((menu, index) => {
        menu.remove();
    });

    overlays.forEach((overlay, index) => {
        overlay.remove();
    });

    // ESCキーハンドラーも削除
    document.removeEventListener('keydown', window.currentEscapeHandler);

};

// DOM変更の監視とメニューの復元
window.setupMenuProtection = function () {
    // DOM変更を監視してメニューを保護
    const observer = new MutationObserver(function (mutations) {
        let needsMenuCheck = false;

        mutations.forEach(function (mutation) {
            // 大きなDOM変更（Blazorの再レンダリング）を検出
            if (mutation.type === 'childList' && mutation.addedNodes.length > 5) {
                needsMenuCheck = true;
            }
        });

        if (needsMenuCheck) {
            // メニューが存在するかチェック
            const existingMenus = document.querySelectorAll('.insert-menu-dynamic');
            if (existingMenus.length > 0) {
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    window.menuProtectionObserver = observer;
};

// ページ読み込み時に保護機能を有効化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.setupMenuProtection);
} else {
    window.setupMenuProtection();
}