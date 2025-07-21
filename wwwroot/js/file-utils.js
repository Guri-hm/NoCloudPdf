window.openFileDialog = function (elementId) {
    const fileInput = document.getElementById(elementId);
    if (fileInput) {
        fileInput.click();
    }
};

// 挿入メニューをクリック座標に直接表示
window.showInsertMenuAtExactPosition = function (position, clickX, clickY) {
    console.log(`=== showInsertMenuAtExactPosition called ===`);
    console.log(`Position: ${position}, ClickX: ${clickX}, ClickY: ${clickY}`);

    // 既存メニューをすべて削除
    window.hideAllInsertMenus();

    // 動的にメニューを作成
    const menu = document.createElement('div');
    menu.id = `dynamic-menu-${position}`;
    menu.className = 'insert-menu-dynamic';

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

    console.log(`Menu positioned at: top=${menuTop}px, left=${menuLeft}px (centered on click position)`);
    console.log(`Click position: (${clickX}, ${clickY}), Menu center: (${clickX}, ${menuTop})`);
    console.log(`Viewport: ${viewportWidth}x${viewportHeight}, Menu bounds: (${menuLeft}, ${menuTop}) to (${menuLeft + menuWidth}, ${menuTop + estimatedMenuHeight})`);

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

    // 背景オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.id = `overlay-${position}`;
    overlay.className = 'insert-menu-overlay';
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 999;';
    overlay.onclick = () => window.hideAllInsertMenus();

    document.body.appendChild(overlay);

    console.log(`✅ Dynamic menu created successfully at exact position (${menuLeft}, ${menuTop})`);
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

    console.log(`Dynamic menu ${position} removed`);
};

window.hideAllInsertMenus = function () {
    // 動的メニューをすべて削除
    const menus = document.querySelectorAll('.insert-menu-dynamic');
    const overlays = document.querySelectorAll('.insert-menu-overlay');

    menus.forEach(menu => menu.remove());
    overlays.forEach(overlay => overlay.remove());

    console.log('All dynamic insert menus removed');
};