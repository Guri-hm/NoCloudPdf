# 引継ぎ書類 — ClientPdfApp (NoCloudPDF)

作成日: 2026-02-28  
ブランチ: `dev`  
リポジトリ: `Guri-hm/ClientPdfApp`

---

## 1. プロジェクト概要

Blazor WebAssembly製のPDF編集Webアプリ（NoCloudPDF）。  
PDFの加工処理はすべてブラウザ内で完結（サーバーレス）。

主要ライブラリ:
- pdf-lib（PDFの生成・編集）
- PDF.js（PDFレンダリング・ラスタライズ）
- Blazor WASM（C# / Razor）
- Tailwind CSS

---

## 2. 直近の作業内容と現在の状態

### 2-A. コミット `275a28f` 「PDFメモリ最適化」の概要

PDFページデータをC#のメモリ（base64文字列）ではなく、JSのメモリに保持するように変更した。

**変更の核心:**
- `PdfDataService.cs` に `LoadAllPagesForFileAsync` を追加し、ページデータをJSの `_pdfPageStorage`（`PdfPageStorageManager`）に格納するようにした
- `PageItem` に `IsPageDataStoredInJs`（bool）と `PageDataSizeBytes`（long）プロパティを追加
- データがJSに格納されている場合、`page.PageData`はnull。代わりに `page.FileId` + `page.OriginalPageIndex` でJSから取り出す

**JS側の新規関数（pdf-utils.js）:**
- `extractPdfPageToStorage(pdfData, pageIndex, fileId)` — PDFページをJSストレージに格納
- `mergePdfPagesFromStorage(pageKeys)` — ストレージからページを取り出して結合
- `generatePreviewFromStorage(fileId, pageIndex, rotateAngle, scaleKey)` — ストレージからプレビュー生成
- `cropPdfPageVectorFromStorage(...)` — ストレージからベクタートリミング
- `cropPdfPageRasterizedFromStorage(...)` — ストレージからラスタートリミング
- `getStoredPageData / hasStoredPageData / setStoredPageData / deleteStoredPageData / _clearPageStorage` — ストレージ管理API

**対応済みページ（コミット275a28f時点）:**
- `Pages/Merge.razor` ✅
- `Pages/Split.razor` ✅
- `Pages/Trim.razor` ✅
- `Pages/Layout.razor` ✅
- `Pages/EditPage.razor` ✅（※ただし `notReadyCount` チェックは未修正の可能性あり、後述）

---

### 2-B. 今回のセッションで実施した作業（**未コミット**）

以下の3ファイルに変更を加えたが、**まだコミットしていない**。

```
git diff HEAD --name-only
→ Pages/Ocr.razor
→ Pages/Slice.razor
→ wwwroot/js/pdf-utils.js
```

#### ① `wwwroot/js/pdf-utils.js` に `cropPdfPageToImageFromStorage` 追加

```javascript
// 画像トリミング（ストレージから）
window.cropPdfPageToImageFromStorage = async function (fileId, pageIndex, normX, normY, normWidth, normHeight, rotateAngle = 0, dpi = 150) {
    const pageBytes = window._pdfPageStorage.get(fileId, pageIndex);
    if (!pageBytes) {
        throw new Error(`Page not found in storage: ${fileId}_${pageIndex}`);
    }
    const pdfBase64 = uint8ArrayToBase64(pageBytes);
    return await window.cropPdfPageToImage(pdfBase64, normX, normY, normWidth, normHeight, rotateAngle, dpi);
};
```

`cropPdfPageVectorFromStorage` / `cropPdfPageRasterizedFromStorage` と同じパターン。  
挿入位置: `getImageSizeFromDataUrl` 関数の直後、`cropPdfPageToImage` 関数の直前。

#### ② `Pages/Ocr.razor` — `ShowOcrPreview()` 内を修正（約 line 705付近）

変更前:
```csharp
var imageDataUrl = await JSRuntime.InvokeAsync<string>(
    "cropPdfPageToImage",
    page.PageData,
    rect.X, rect.Y, rect.Width, rect.Height,
    rotate,
    exportDpi
);
```

変更後:
```csharp
string imageDataUrl;
if (page.IsPageDataStoredInJs)
{
    imageDataUrl = await JSRuntime.InvokeAsync<string>(
        "cropPdfPageToImageFromStorage",
        page.FileId,
        page.OriginalPageIndex,
        rect.X, rect.Y, rect.Width, rect.Height,
        rotate,
        exportDpi
    );
}
else
{
    imageDataUrl = await JSRuntime.InvokeAsync<string>(
        "cropPdfPageToImage",
        page.PageData,
        rect.X, rect.Y, rect.Width, rect.Height,
        rotate,
        exportDpi
    );
}
```

#### ③ `Pages/Slice.razor` — 2箇所を修正

**変更点1** (line 1102付近) — スキップ条件の修正:

```csharp
// 変更前
if (string.IsNullOrEmpty(page.PageData) || page.HasPageDataError)
    continue;

// 変更後
if (string.IsNullOrEmpty(page.PageData) && !page.IsPageDataStoredInJs || page.HasPageDataError)
    continue;
```

**変更点2** (line 1134付近) — `cropPdfPageToImage` 呼び出しを分岐:

```csharp
// 変更前（制限なしページの通常処理）
imageDataUrl = await JSRuntime.InvokeAsync<string>(
    "cropPdfPageToImage",
    page.PageData,
    rect.X, rect.Y, rect.Width, rect.Height,
    rotate,
    exportDpi
);

// 変更後
if (page.IsPageDataStoredInJs)
{
    imageDataUrl = await JSRuntime.InvokeAsync<string>(
        "cropPdfPageToImageFromStorage",
        page.FileId,
        page.OriginalPageIndex,
        rect.X, rect.Y, rect.Width, rect.Height,
        rotate,
        exportDpi
    );
}
else
{
    imageDataUrl = await JSRuntime.InvokeAsync<string>(
        "cropPdfPageToImage",
        page.PageData,
        rect.X, rect.Y, rect.Width, rect.Height,
        rotate,
        exportDpi
    );
}
```

---

## 3. 残作業

### 3-A. 今回の変更をコミットする

```bash
git add Pages/Ocr.razor Pages/Slice.razor wwwroot/js/pdf-utils.js
git commit -m "OCR・Sliceページにメモリ最適化を反映"
```

### 3-B. `QrCodePdf.razor` と `QrCodeImage.razor` の確認（対応不要と判断済み）

- **`QrCodePdf.razor`**: `page.PageData` を直接使っていない。`PdfDataService.GetPreviewImageAsync()` 経由でプレビュー生成しており、同メソッドは既に `IsPageDataStoredInJs` に対応済み → **対応不要**
- **`QrCodeImage.razor`**: PDFファイル自体を扱わず、アップロードされた画像ファイルのQRコードを読むページ → **対応不要**

### 3-C. `Pages/Edit.razor` の `notReadyCount` チェック（要確認）

`Edit.razor` (line 461付近) のチェックが古い形式のまま残っている可能性がある:

```csharp
// 現状（未確認）
var notReadyCount = mergeItems.Count(item => string.IsNullOrEmpty(item.PageData) || item.HasError);

// 修正が必要な場合
var notReadyCount = mergeItems.Count(item =>
    (!item.IsPageDataStoredInJs && string.IsNullOrEmpty(item.PageData)) || item.HasError);
```

実際のファイルを確認してから対応を判断すること。

---

## 4. 未解決の別バグ: `cropPdfPageToTrimVector` 270度回転の座標変換

**症状**: Trim機能で `rotateAngle=270` のPDFページに対してトリミング範囲が鏡像になる（右側を選択→左側がトリムされる、上側を選択→下側がトリムされる）

**場所**: `wwwroot/js/pdf-utils.js` 内の `cropPdfPageToTrimVector` 関数（line 1768～1794付近）

**デバッグデータ:**
```
Canvas: 1541x1085, PageOriginal: 723x1027
TrimNorm: X=0.514, Y=0.055, W=0.464, H=0.260, Rotate=270
cropPdfPageToTrimVector Input: pageW=723, pageH=1027
displayW=pageH=1027, displayH=pageW=723
```

**現状の 270度ケースのコード（未修正）:**
```javascript
} else if (quant === 90 || quant === 270) {
    // ← ここに 90/270 度の変換ロジックがある（要確認）
```

**試行済みの変換式（すべて失敗）:**
- `llx = sy, lly = displayW - sx - sw, urx = sy + sh, ury = displayW - sx`
  → 「1回前の状態に戻った」（上下鏡像）
- 複数の組み合わせを試したが左右鏡像・上下鏡像を繰り返し

**ヒント:**
- 90度と270度は同じ式では解決しない（非対称）
- displayW = pageH（元PDFの高さ）、displayH = pageW（元PDFの幅）
- Canvasでは`normX, normY`は「回転後の表示上の座標」として渡ってくる
- PDFのCropBoxは「元の無回転座標系」で指定する必要がある
- 90度の正しい式が分かれば、270度は逆変換として導ける

---

## 5. アーキテクチャ参照

### データフロー（メモリ最適化後）

```
ファイルアップロード
    ↓
PdfDataService.LoadFirstPageAsync()  ← 1ページ目: C#で処理（base64返却）
PdfDataService.LoadAllPagesForFileAsync()  ← 2ページ目以降: JSストレージに格納
    ↓ JSRuntime.InvokeAsync("extractPdfPageToStorage", ...)
    ↓
window._pdfPageStorage (JS Map: "{fileId}_{pageIndex}" → Uint8Array)
    ↓
各ページ処理時:
  page.IsPageDataStoredInJs == true  → JSストレージから取得 (fileId + originalPageIndex)
  page.IsPageDataStoredInJs == false → page.PageData (base64) を直接使用
```

### `PageItem` の主要プロパティ

| プロパティ | 型 | 説明 |
|---|---|---|
| `PageData` | `string?` | base64 PDFデータ（JS格納時はnull） |
| `IsPageDataStoredInJs` | `bool` | JSストレージ使用フラグ |
| `PageDataSizeBytes` | `long` | ページデータサイズ（バイト） |
| `FileId` | `string` | ファイル識別子（JSストレージキーに使用） |
| `OriginalPageIndex` | `int` | 元PDFでのページインデックス（0始まり） |
| `RotateAngle` | `int` | 表示上の回転角度 |
| `IsOperationRestricted` | `bool` | 操作制限付きPDF |
| `IsPasswordProtected` | `bool` | パスワード付きPDF |

### JSストレージAPI（pdf-utils.js）

```javascript
window._pdfPageStorage.get(fileId, pageIndex)      // Uint8Array取得
window._pdfPageStorage.set(fileId, pageIndex, u8)  // 保存
window._pdfPageStorage.has(fileId, pageIndex)      // 存在確認
window._pdfPageStorage.deleteAllForFile(fileId)    // ファイル全ページ削除
window._pdfPageStorage.clear()                     // 全クリア
```

---

## 6. 関連ファイル一覧

| ファイル | 役割 |
|---|---|
| `Services/PdfDataService.cs` | PDFデータ管理サービス（メモリ最適化の中心） |
| `Models/UnifiedPdfModel.cs` | PageItemモデル定義 |
| `wwwroot/js/pdf-utils.js` | JS PDF処理関数群 |
| `Pages/Ocr.razor` | OCR機能（今回修正済・未コミット） |
| `Pages/Slice.razor` | 範囲切り出し機能（今回修正済・未コミット） |
| `Pages/Trim.razor` | トリミング機能（275a28fで修正済・270度バグあり） |
| `Pages/Merge.razor` | 結合機能（275a28fで修正済） |
| `Pages/Split.razor` | 分割機能（275a28fで修正済） |
| `Pages/Layout.razor` | Nアップ機能（275a28fで修正済） |
| `Pages/EditPage.razor` | 編集機能（275a28fで修正済・notReadyCount要確認） |
| `Pages/QrCodePdf.razor` | PDF QRコードスキャン（対応不要） |
| `Pages/QrCodeImage.razor` | 画像 QRコードスキャン（対応不要） |
