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

    // クリック位置の少し下に配置（ボタンの高さ分オフセット）
    const menuTop = clickY + 10; // クリック位置の10px下
    const menuLeft = clickX;     // クリック位置と同じX座標

    menu.style.cssText = `
        position: fixed;
        top: ${menuTop}px;
        left: ${menuLeft}px;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        width: 240px;
        z-index: 1000;
        display: block;
    `;

    console.log(`Menu positioned at: top=${menuTop}px, left=${menuLeft}px`);

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