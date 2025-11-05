using NoCloudPdf.Models;
using Microsoft.JSInterop;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Components.Forms;

namespace NoCloudPdf.Services;

/// <summary>
/// 統一PDFデータサービス - ファイル表示とページ表示の統一データ管理
/// </summary>
public class PdfDataService
{
    private readonly IJSRuntime _jsRuntime;
    private readonly MessageService _messageService;
    public PdfDataService(IJSRuntime jsRuntime, MessageService messageService)
    {
        _jsRuntime = jsRuntime;
        _messageService = messageService;
    }

    private UnifiedPdfModel _model = new();
    public event Action? OnChange;
    // キャンセル用トークン管理
    private Dictionary<string, CancellationTokenSource> _loadingTokens = new();
    public long TotalFileSize => _model.Files.Values.Sum(f => f.FileData?.LongLength ?? 0);

    /// <summary>
    /// 現在のデータモデルを取得
    /// </summary>
    public UnifiedPdfModel GetModel() => _model;

    public SplitInfo SplitInfo { get; private set; } = new SplitInfo();

    public Func<List<(string title, int pageIndex)>, Task<List<int>?>>? BookmarkSelectionDialogFunc { get; set; }

    internal static readonly string[] SupportedImageExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg" };
    internal static readonly string[] SupportedPdfExtensions = new[] { ".pdf" };

    /// <summary>
    /// 表示モードを切り替え
    /// </summary>
    public void SwitchDisplayMode(DisplayMode mode)
    {
        _model.CurrentMode = mode;
        // ファイル単位→ページ単位に切り替えたとき
        if (mode == DisplayMode.Page)
        {
            // 全ファイルの読み込みタスクをキャンセル
            foreach (var cts in _loadingTokens.Values)
            {
                cts.Cancel();
                // cts.Dispose();
            }
            _loadingTokens.Clear();

            // 必要なファイルで再度LoadAllPagesForFileAsyncをサムネイル取得ありで呼び出す
            foreach (var fileId in _model.Files.Keys)
            {
                _ = LoadAllPagesForFileAsync(fileId, loadThumbnails: true);
            }
        }
    }

    /// <summary>
    /// 現在の表示モードでの表示アイテムリストを取得
    /// </summary>
    public List<DisplayItem> GetDisplayItems()
    {
        return _model.CurrentMode switch
        {
            DisplayMode.File => GetFileDisplayItems(),
            DisplayMode.Page => GetPageDisplayItems(),
            _ => new List<DisplayItem>()
        };
    }

    /// <summary>
    /// ファイル単位表示用のアイテムリストを生成
    /// </summary>
    private List<DisplayItem> GetFileDisplayItems()
    {
        var result = new List<DisplayItem>();
        if (_model.Pages.Count == 0) return result;

        int start = 0;
        while (start < _model.Pages.Count)
        {
            var fileId = _model.Pages[start].FileId;
            var fileName = _model.Pages[start].FileName;
            int count = 1;
            // 連続する同じFileIdをカウント
            while (start + count < _model.Pages.Count && _model.Pages[start + count].FileId == fileId)
            {
                count++;
            }

            // 代表ページ（最初のページ）からサムネイルやエラー状態を取得
            var firstPage = _model.Pages[start];
            var hasError = firstPage.HasError;
            var isLoading = firstPage.IsLoading;

            // ファイルメタデータ（表紙サムネイルなど）
            var fileMetadata = _model.Files.ContainsKey(fileId) ? _model.Files[fileId] : null;
            // 代表ページのサムネイルではなく、グループ先頭ページのサムネイルを使う
            var thumbnail = firstPage.Thumbnail;

            // サムネイル未生成かつエラーでない場合はローディング扱い
            bool isThumbnailLoading = false;
            if (string.IsNullOrEmpty(thumbnail) && !firstPage.HasThumbnailError)
            {
                // サムネイル生成はLoadAllPagesForFileAsyncがバックグランドでおこなう(一度でもページ単位表示にすると実行される)
                isThumbnailLoading = true;
            }

            var colorHsl = string.IsNullOrEmpty(firstPage.ColorHsl)
                ? GenerateColorHsl(fileId)
                : firstPage.ColorHsl;

            // ページ単位表示の時と同じIDはKey設定時にエラーが発生
            var uniqueId = $"{firstPage.Id}_file";

            var item = new DisplayItem
            {
                Id = uniqueId,
                DisplayName = TruncateFileName(fileName),
                FullFileName = fileName,
                Thumbnail = thumbnail,
                PageInfo = count > 1 ? $"{count}ページ" : "",
                IsLoading = isLoading || isThumbnailLoading,
                HasError = hasError,
                RawData = fileMetadata ?? new FileMetadata(), // nullの場合は空のFileMetadataを代入
                PageCount = count,
                ColorHsl = colorHsl,
                RotateAngle = firstPage.RotateAngle
            };
            result.Add(item);

            start += count; // 次のグループへ
        }
        return result;
    }

    /// <summary>
    /// ページ単位表示用のアイテムリストを生成
    /// </summary>
    private List<DisplayItem> GetPageDisplayItems()
    {
        return _model.Pages.Select(page => new DisplayItem
        {
            Id = page.Id,
            DisplayName = TruncateFileName(page.FileName),
            FullFileName = page.FileName,
            Thumbnail = page.Thumbnail,
            PageInfo = $"{page.OriginalPageNumber}",
            IsLoading = page.IsLoading,
            HasError = page.HasError,
            RawData = page,
            PageCount = 1,
            ColorHsl = page.ColorHsl,
            RotateAngle = page.RotateAngle,
            IsSelectedForExtract = page.IsSelectedForExtract
        }).ToList();
    }

    /// <summary>
    /// 新しいPDFファイルを追加（高速ロード - 表紙のみ + バックグラウンド全ページ読み込み）
    /// </summary>
    public async Task<bool> AddOrInsertPdfFileAsync(string fileName, byte[] fileData, int? insertPosition = null)
    {
        try
        {
            // ファイルヘッダーの検証
            var header = System.Text.Encoding.ASCII.GetString(fileData.Take(8).ToArray());
            if (!header.StartsWith("%PDF-"))
            {
                return false;
            }

            var fileId = $"{fileName}_{DateTime.Now.Ticks}";
            string? password = null;
            int retryCount = 0;
            RenderResult? renderResult = null;

            bool wasPasswordProtected = false;
            // パスワード付きPDF対応（最大3回リトライ）
            while (retryCount < 3)
            {
                renderResult = await _jsRuntime.InvokeAsync<RenderResult>("renderFirstPDFPage", fileData, password);

                // パスワード付きPDFの場合
                if (renderResult.isPasswordProtected)
                {
                    //fileMetadataに利用
                    wasPasswordProtected = true;
                    // パスワード入力ダイアログを表示
                    password = await ShowPasswordInputDialogAsync(fileName);
                    if (string.IsNullOrEmpty(password))
                        // キャンセル時
                        return false;

                    // パスワード解除PDFを生成
                    var unlockedBase64 = await _jsRuntime.InvokeAsync<string>("unlockPdf", Convert.ToBase64String(fileData), password);
                    fileData = Convert.FromBase64String(unlockedBase64);
                    // passwordは以降不要になるので安全のためnullに設定
                    password = null;

                    renderResult = await _jsRuntime.InvokeAsync<RenderResult>("renderFirstPDFPage", fileData, password);
                    if (!renderResult.isPasswordProtected)
                        break;
                    retryCount++;
                    continue;
                }

                // 操作制限がある場合
                // if (renderResult.isOperationRestricted)
                // {
                //     var unlockedBase64 = await _jsRuntime.InvokeAsync<string>("unlockPdf", Convert.ToBase64String(fileData), password);
                //     fileData = Convert.FromBase64String(unlockedBase64);
                // }
                break;
            }

            if (renderResult == null || string.IsNullOrEmpty(renderResult.thumbnail))
            {
                return false;
            }

            var pageCount = await _jsRuntime.InvokeAsync<int>("getPDFPageCount", fileData);
            if (pageCount <= 0)
            {
                return false;
            }

            // ファイルメタデータを追加
            var fileMetadata = new FileMetadata
            {
                FileId = fileId,
                FileName = fileName,
                FileData = fileData,
                PageCount = pageCount,
                CoverThumbnail = renderResult.thumbnail,
                IsFullyLoaded = false,
                IsPasswordProtected = wasPasswordProtected,
                IsOperationRestricted = renderResult.isOperationRestricted,
                SecurityInfo = renderResult.securityInfo,
                Bookmarks = renderResult.bookmarks,
                DefaultRotateAngle = renderResult.pageRotation
            };

            _model.Files[fileId] = fileMetadata;

            // ページ分のItemを準備
            // 先頭ページのItemはサムネイルを優先処理
            int baseIndex = insertPosition ?? _model.Pages.Count;
            for (int i = 0; i < pageCount; i++)
            {
                var loadingItem = new PageItem
                {
                    Id = $"{fileId}_p{i}",
                    FileId = fileId,
                    FileName = fileName,
                    OriginalPageIndex = i,
                    Thumbnail = i == 0 ? renderResult.thumbnail : "", // 1ページ目は表紙
                    PageData = "",
                    IsLoading = true,
                    HasThumbnailError = false,
                    HasPageDataError = false,
                    ColorHsl = GenerateColorHsl(fileId),
                    RotateAngle = fileMetadata.DefaultRotateAngle,
                    IsPasswordProtected = wasPasswordProtected,
                    IsOperationRestricted = renderResult.isOperationRestricted,
                };
                _model.Pages.Insert(baseIndex + i, loadingItem);
            }

            try
            {
                if (fileMetadata?.Bookmarks != null && fileMetadata.Bookmarks.Count > 0)
                {
                    var baseIndex2 = insertPosition ?? _model.Pages.Count - pageCount;
                    await HandleBookmarksForFileAsync(fileMetadata, baseIndex2);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Bookmark split prompt failed: {ex.Message}");
            }

            // バックグラウンドで全ページのPageData読み込みを開始
            _ = Task.Run(async () =>
            {
                try
                {
                    // 現在の表示モードに応じてサムネイル取得有無を切り替え
                    bool loadThumbnails = _model.CurrentMode == DisplayMode.Page;
                    await LoadAllPagesForFileAsync(fileId, loadThumbnails: loadThumbnails);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Background page loading failed for {fileName}: {ex.Message}");
                }
            });

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error adding/inserting PDF file {fileName}: {ex.Message}");
            return false;
        }
    }

    // しおりの一覧を平坦化してダイアログ経由で選択を受け、SplitInfo を更新する処理を切り出し
    private async Task HandleBookmarksForFileAsync(FileMetadata fileMetadata, int baseIndex)
    {
        try
        {
            var flat = new List<(string title, int pageIndex)>();
            void Walk(List<Bookmark> items)
            {
                foreach (var b in items)
                {
                    flat.Add((b.Title ?? "", b.PageIndex));
                    if (b.Items != null && b.Items.Count > 0) Walk(b.Items);
                }
            }
            Walk(fileMetadata.Bookmarks);

            var candidates = flat.Where(f => f.pageIndex > 0).ToList();
            if (candidates.Count == 0) return;

            List<int>? selected = null;
            try
            {
                if (BookmarkSelectionDialogFunc != null)
                {
                    selected = await BookmarkSelectionDialogFunc(candidates);
                }
            }
            catch
            {
                selected = null;
            }

            if (selected != null && selected.Count > 0)
            {
                var toAdd = selected.Select(sel => baseIndex + sel)
                                    .Where(pos => pos > 0 && pos < _model.Pages.Count)
                                    .Distinct()
                                    .OrderBy(i => i);
                foreach (var pos in toAdd)
                {
                    if (!SplitInfo.SplitPositions.Contains(pos)) SplitInfo.SplitPositions.Add(pos);
                }
                await InvokeOnChangeAsync();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"HandleBookmarksForFileAsync failed: {ex.Message}");
        }
    }

    public Func<string, Task<string?>>? PasswordInputDialogFunc { get; set; }

    private async Task<string?> ShowPasswordInputDialogAsync(string fileName)
    {
        if (PasswordInputDialogFunc != null)
            return await PasswordInputDialogFunc(fileName);
        Console.WriteLine($"PasswordInputDialogFunc is not set, using fallback prompt for {PasswordInputDialogFunc}");
        // fallback: window.prompt
        return await _jsRuntime.InvokeAsync<string?>(
            "prompt",
            $"「{fileName}」はパスワード付きPDFです。パスワードを入力してください。",
            ""
        );
    }

    internal class RenderResult
    {
        public string thumbnail { get; set; } = "";
        public bool isError { get; set; }
        public bool isPasswordProtected { get; set; }
        public bool isOperationRestricted { get; set; }
        public string securityInfo { get; set; } = "";
        public List<Bookmark> bookmarks { get; set; } = [];
        public int pageRotation { get; set; } = 0; // ページのデフォルト回転角度(ページ固有の回転情報が含まれるPDFでサムネイルとプレビューの傾きがずれるためjs側で取得)
    }

    private readonly object _renderLock = new();
    private int _pendingRenders = 0;
    private readonly int _renderBatchSize = 5; 

    /// <summary>
    /// 特定ファイルの全ページをバックグラウンド読み込み（ページ単位表示，ファイル単位表示で処理切り分け）
    /// モード切替時に処理をキャンセル
    /// ファイル単位は先頭ページを優先取得
    /// </summary>
    public async Task LoadAllPagesForFileAsync(string fileId, bool loadThumbnails = true)
    {

        // 既存の読み込みタスクがあればキャンセル
        if (_loadingTokens.TryGetValue(fileId, out var oldCts))
        {
            oldCts.Cancel();
        }

        // 新しいキャンセルトークンを作成
        var cts = new CancellationTokenSource();
        _loadingTokens[fileId] = cts;

        if (!_model.Files.TryGetValue(fileId, out var fileMetadata))
        {
            Console.WriteLine($"Skipping load for {fileId}: not found");
            return;
        }

        // ファイルのサムネイルがそろっていない
        if (!loadThumbnails)
        {
            // ファイルIDで該当ページを抽出
            var filePages = _model.Pages
                .Select((p, idx) => new { Page = p, Index = idx })
                .Where(x => x.Page.FileId == fileId)
                .ToList();

            // 束の先頭ページを特定
            int? lastIndex = null;
            foreach (var x in filePages)
            {
                // 先頭 or 直前のページが別ファイルなら「束」の先頭
                if (lastIndex == null || x.Index != lastIndex + 1)
                {
                    var pageItem = x.Page;
                    // サムネイル未生成なら生成
                    if (string.IsNullOrEmpty(pageItem.Thumbnail) && !pageItem.HasThumbnailError)
                    {
                        try
                        {
                            var renderResult = await _jsRuntime.InvokeAsync<RenderResult>(
                                "generatePdfThumbnailFromFileMetaData", fileMetadata.FileData, pageItem.OriginalPageIndex);
                            pageItem.Thumbnail = renderResult.thumbnail;
                            pageItem.HasThumbnailError = renderResult.isError || string.IsNullOrEmpty(renderResult.thumbnail);
                            pageItem.IsLoading = false;
                            await BufferedNotifyChangeAsync();
                        }
                        catch
                        {
                            pageItem.HasThumbnailError = true;
                            pageItem.Thumbnail = "";
                            pageItem.IsLoading = false;
                        }
                    }
                }
                lastIndex = x.Index;
            }

            // PageData取得（従来通り）
            var existingPageItems = _model.Pages.Where(p => p.FileId == fileId).ToList();
            foreach (var pageItem in existingPageItems)
            {
                if (!string.IsNullOrEmpty(pageItem.PageData) && !pageItem.HasPageDataError)
                    continue;

                try
                {
                    pageItem.PageData = await _jsRuntime.InvokeAsync<string>("extractPdfPage", fileMetadata.FileData, pageItem.OriginalPageIndex, fileMetadata.FileId);
                    pageItem.HasPageDataError = string.IsNullOrEmpty(pageItem.PageData);
                    pageItem.IsLoading = false;
                    try
                    {
                        if (!fileMetadata.IsOperationRestricted)
                        {
                            var isRestricted = await _jsRuntime.InvokeAsync<bool>("_pdfLibFileIsRestricted", fileMetadata.FileId);
                            if (isRestricted)
                            {
                                fileMetadata.IsOperationRestricted = true;
                                pageItem.IsOperationRestricted = true;
                            }
                        }
                        else
                        {
                            pageItem.IsOperationRestricted = true;
                        }
                    }
                    catch
                    {
                        // 無視（冗長問い合わせは失敗しても処理続行）
                    }
                    await BufferedNotifyChangeAsync();
                }
                catch
                {
                    pageItem.HasPageDataError = true;
                    pageItem.PageData = "";
                    pageItem.IsLoading = false;
                }
            }

            await InvokeOnChangeAsync();
            return;
        }

        // ページ単位表示時（サムネイルも全ページ分取得）
        try
        {
            // 既存のページアイテムを取得
            var existingPageItems = _model.Pages.Where(p => p.FileId == fileId).ToList();
            int successfulPages = 0;
            int failedPages = 0;

            for (int pageIndex = 0; pageIndex < fileMetadata.PageCount; pageIndex++)
            {
                if (cts.Token.IsCancellationRequested)
                {
                    Console.WriteLine($"Loading for {fileId} was cancelled.");
                    return;
                }

                var pageId = $"{fileId}_p{pageIndex}";
                var pageItem = existingPageItems.FirstOrDefault(p => p.Id == pageId);
                if (pageItem == null || !_model.Pages.Contains(pageItem))
                {
                    // PageItemが存在しない場合はスキップ（追加はしない）
                    failedPages++;
                    Console.WriteLine($"Warning: PageItem not found for {pageId}, skipping update.");
                    continue;
                }

                // ページ単位表示時：PageDataがあり、サムネイルもあり、エラーもなければ何もしない
                if (loadThumbnails)
                {
                    if (!string.IsNullOrEmpty(pageItem.PageData) &&
                        !string.IsNullOrEmpty(pageItem.Thumbnail) &&
                        !pageItem.HasThumbnailError && !pageItem.HasPageDataError)
                    {
                        continue;
                    }
                }
                else
                {
                    // ファイル単位表示時：PageDataがあり、サムネイル（先頭のみ）があれば何もしない
                    if (!string.IsNullOrEmpty(pageItem.PageData) &&
                        (pageIndex != 0 || !string.IsNullOrEmpty(pageItem.Thumbnail)) &&
                        !pageItem.HasPageDataError)
                    {
                        continue;
                    }
                }

                string thumbnail = "";
                string pageData = "";
                bool thumbError = false;
                bool dataError = false;

                if (pageIndex == 0)
                {
                    thumbnail = fileMetadata.CoverThumbnail;
                    // すでにPageDataがあれば再取得しない
                    if (!string.IsNullOrEmpty(pageItem.PageData))
                    {
                        pageData = pageItem.PageData;
                    }
                    else
                    {
                        pageData = await _jsRuntime.InvokeAsync<string>("extractPdfPage", fileMetadata.FileData, pageIndex, fileMetadata.FileId);

                        try
                        {
                            if (!fileMetadata.IsOperationRestricted)
                            {
                                var isRestricted = await _jsRuntime.InvokeAsync<bool>("_pdfLibFileIsRestricted", fileMetadata.FileId);
                                if (isRestricted)
                                {
                                    fileMetadata.IsOperationRestricted = true;
                                    if (pageItem != null) pageItem.IsOperationRestricted = true;
                                }
                            }
                            else
                            {
                                if (pageItem != null) pageItem.IsOperationRestricted = true;
                            }
                        }
                        catch
                        {
                            // 無視（冗長問い合わせは失敗しても処理続行）
                        }
                    }
                    thumbError = string.IsNullOrEmpty(thumbnail);
                    dataError = string.IsNullOrEmpty(pageData);
                }
                else
                {
                    if (loadThumbnails)
                    {
                        // サムネイルが未生成またはエラーの場合のみ生成
                        if (string.IsNullOrEmpty(pageItem.Thumbnail) || pageItem.HasThumbnailError)
                        {
                            // サムネイルも取得
                            var renderCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                            try
                            {
                                var renderResult = await _jsRuntime.InvokeAsync<RenderResult>(
                                    "generatePdfThumbnailFromFileMetaData", renderCts.Token, fileMetadata.FileData, pageIndex);
                                thumbnail = renderResult.thumbnail;
                                thumbError = renderResult.isError || string.IsNullOrEmpty(thumbnail);
                            }
                            catch (OperationCanceledException)
                            {
                                Console.WriteLine($"Timeout loading page {pageIndex + 1} of {fileMetadata.FileName}");
                                thumbnail = "";
                                thumbError = true;
                            }
                        }
                        else
                        {
                            thumbnail = pageItem.Thumbnail;
                            thumbError = false;
                        }
                    }

                    // PageDataは常に取得（既にあれば再取得しない）
                    if (!string.IsNullOrEmpty(pageItem.PageData))
                    {
                        pageData = pageItem.PageData;
                    }
                    else
                    {
                        var dataCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                        try
                        {
                            pageData = await _jsRuntime.InvokeAsync<string>("extractPdfPage", dataCts.Token, fileMetadata.FileData, pageIndex, fileMetadata.FileId);
                            try
                            {
                                if (!fileMetadata.IsOperationRestricted)
                                {
                                    var isRestricted = await _jsRuntime.InvokeAsync<bool>("_pdfLibFileIsRestricted", fileMetadata.FileId);
                                    if (isRestricted)
                                    {
                                        fileMetadata.IsOperationRestricted = true;
                                        if (pageItem != null) pageItem.IsOperationRestricted = true;
                                    }
                                }
                                else
                                {
                                    pageItem.IsOperationRestricted = true;
                                }
                            }
                            catch
                            {
                                // 無視（冗長問い合わせは失敗しても処理続行）
                            }
                        }
                        catch (OperationCanceledException)
                        {
                            Console.WriteLine($"Timeout extracting pageData for page {pageIndex + 1} of {fileMetadata.FileName}");
                            pageData = "";
                        }
                    }
                    dataError = string.IsNullOrEmpty(pageData);
                }

                if (pageItem == null)
                {
                    // 競合や削除で pageItem が消えている可能性があるため保護
                    continue;
                }

                pageItem.Thumbnail = thumbnail;
                pageItem.PageData = pageData;
                pageItem.IsLoading = false;
                pageItem.HasThumbnailError = thumbError;
                pageItem.HasPageDataError = dataError;

                if (!thumbError && !dataError)
                {
                    successfulPages++;
                }
                else
                {
                    failedPages++;
                }

                // バッチレンダリング：N件ごとにUIを更新
                lock (_renderLock)
                {
                    _pendingRenders++;
                    if (_pendingRenders >= _renderBatchSize)
                    {
                        _pendingRenders = 0;
                        _ = InvokeOnChangeAsync(); // await しない（fire-and-forget）
                    }
                }

            }

            // 最後に残りを反映
            lock (_renderLock)
            {
                if (_pendingRenders > 0)
                {
                    _pendingRenders = 0;
                }
            }
            await InvokeOnChangeAsync();

            // 全ページのPageDataとサムネイルが揃っている場合のみIsFullyLoadedをtrueに
            var allPages = _model.Pages.Where(p => p.FileId == fileId).ToList();
            bool allPageDataReady = allPages.All(p => !string.IsNullOrEmpty(p.PageData));
            bool allThumbnailsReadyFinal = allPages.All(p => !string.IsNullOrEmpty(p.Thumbnail));
            fileMetadata.IsFullyLoaded = allPageDataReady && allThumbnailsReadyFinal;

        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error loading all pages for file {fileId}: {ex.Message}");
            Console.WriteLine($"Stack trace: {ex.StackTrace}");

            var existingPageItems = _model.Pages.Where(p => p.FileId == fileId).ToList();
            foreach (var item in existingPageItems)
            {
                item.IsLoading = false;
                item.HasThumbnailError = true;
                item.HasPageDataError = true;
                item.Thumbnail = "";
                item.PageData = "";
            }
        }
    }

    /// <summary>
    /// PDF挿入用ダイアログを開き、挿入位置を保存
    /// </summary>
    public async Task<bool> OpenInsertPdfDialogAsync(
    DisplayMode mode,
    IReadOnlyList<DisplayItem> displayItems,
    int position,
    Action<int> setInsertPosition,
    Action<string>? setErrorMessage = null)
    {
        try
        {
            int insertPosition;
            if (mode == DisplayMode.File)
            {
                int pageInsertPosition = 0;
                for (int i = 0; i < position && i < displayItems.Count; i++)
                {
                    pageInsertPosition += displayItems[i].PageCount;
                }
                insertPosition = pageInsertPosition;
            }
            else
            {
                insertPosition = position;
            }

            await _jsRuntime.InvokeVoidAsync("openInsertFileDialog", "fileInput");
            setInsertPosition(insertPosition);
            return true;
        }
        catch (Exception ex)
        {
            await _messageService.ShowAsync($"ファイル選択ダイアログの表示に失敗しました: {ex.Message}", MessageType.Warn);
            return false;
        }
    }

    public async Task<string?> ReloadPageAsync(string fileId, int pageIndex)
    {
        if (!_model.Files.TryGetValue(fileId, out var fileMetadata))
            return "ファイル情報が見つかりませんでした。";

        var pageId = $"{fileId}_p{pageIndex}";
        var pageItem = _model.Pages.FirstOrDefault(p => p.Id == pageId);
        if (pageItem == null)
            return "ページ情報が見つかりませんでした。";

        try
        {
            pageItem.IsLoading = true;
            pageItem.HasThumbnailError = false;
            pageItem.HasPageDataError = false;
            pageItem.Thumbnail = "";
            pageItem.PageData = "";
            await InvokeOnChangeAsync();

            string thumbnail = "";
            string pageData = "";
            bool thumbError = false;
            bool dataError = false;

            var ext = Path.GetExtension(fileMetadata.FileName).ToLowerInvariant();

            if (SupportedImageExtensions.Contains(ext))
            {
                // 画像ファイルの場合はPDF化
                string base64 = Convert.ToBase64String(fileMetadata.FileData);
                thumbnail = fileMetadata.CoverThumbnail;
                pageData = await _jsRuntime.InvokeAsync<string>("embedImageAsPdf", base64, ext);
                thumbError = string.IsNullOrEmpty(thumbnail);
                dataError = string.IsNullOrEmpty(pageData);
            }
            else if (SupportedPdfExtensions.Contains(ext))
            {
                if (pageIndex == 0)
                {
                    thumbnail = fileMetadata.CoverThumbnail;
                    pageData = await _jsRuntime.InvokeAsync<string>("extractPdfPage", fileMetadata.FileData, pageIndex, fileMetadata.FileId);
                    thumbError = string.IsNullOrEmpty(thumbnail);
                    dataError = string.IsNullOrEmpty(pageData);

                    if (!fileMetadata.IsOperationRestricted)
                    {
                        try
                        {
                            var isRestricted = await _jsRuntime.InvokeAsync<bool>("_pdfLibFileIsRestricted", fileMetadata.FileId);
                            if (isRestricted)
                            {
                                fileMetadata.IsOperationRestricted = true;
                                pageItem.IsOperationRestricted = true;
                            }
                        }
                        catch
                        {
                            // 無視
                        }
                    }
                    else
                    {
                        // 既に制限フラグが立っているなら pageItem にも反映しておく
                        pageItem.IsOperationRestricted = true;
                    }
                }
                else
                {
                    var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                    try
                    {
                        var renderResult = await _jsRuntime.InvokeAsync<RenderResult>("generatePdfThumbnailFromFileMetaData", cts.Token, fileMetadata.FileData, pageIndex);
                        thumbnail = renderResult.thumbnail;
                        thumbError = renderResult.isError || string.IsNullOrEmpty(thumbnail);

                        pageData = await _jsRuntime.InvokeAsync<string>("extractPdfPage", cts.Token, fileMetadata.FileData, pageIndex, fileMetadata.FileId);
                        dataError = string.IsNullOrEmpty(pageData);

                        if (!fileMetadata.IsOperationRestricted)
                        {
                            try
                            {
                                var isRestricted = await _jsRuntime.InvokeAsync<bool>("_pdfLibFileIsRestricted", fileMetadata.FileId);
                                if (isRestricted)
                                {
                                    fileMetadata.IsOperationRestricted = true;
                                    pageItem.IsOperationRestricted = true;
                                }
                            }
                            catch
                            {
                                // 無視
                            }
                        }
                        else
                        {
                            // 既に制限フラグが立っているなら pageItem にも反映しておく
                            pageItem.IsOperationRestricted = true;
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        Console.WriteLine($"Timeout reloading page {pageIndex + 1} of {fileMetadata.FileName}");
                        thumbnail = "";
                        thumbError = true;
                        dataError = false;
                    }
                }
            }
            else
            {
                return "未対応のファイル形式です。";
            }

            pageItem.Thumbnail = thumbnail;
            pageItem.PageData = pageData;
            pageItem.IsLoading = false;
            pageItem.HasThumbnailError = thumbError;
            pageItem.HasPageDataError = dataError;

            await InvokeOnChangeAsync();

            if (pageItem.HasPageDataError)
                return "ページデータの取得に失敗しました。このページは再読み込みできません。";
            if (pageItem.HasThumbnailError)
                return "サムネイルの取得に失敗しました。";

            return null;
        }
        catch (Exception ex)
        {
            pageItem.IsLoading = false;
            pageItem.HasThumbnailError = true;
            pageItem.HasPageDataError = true;
            pageItem.Thumbnail = "";
            pageItem.PageData = "";
            await InvokeOnChangeAsync();
            Console.WriteLine($"Error reloading page {pageIndex + 1} of {fileMetadata.FileName}: {ex.Message}");
            return "ページの再読み込み中にエラーが発生しました。";
        }
    }

    /// <summary>
    /// アイテムの順序を変更（ドラッグアンドドロップ対応）
    /// </summary>
    public void MoveItem(int fromIndex, int toIndex)
    {
        if (_model.CurrentMode == DisplayMode.File)
        {
            // ファイル単位表示：ファイルグループごと入れ替え
            MoveFileBlock(fromIndex, toIndex);
        }
        else
        {
            // ページ単位表示：Pages内で直接移動
            var pages = _model.Pages;
            if (fromIndex < 0 || fromIndex >= pages.Count ||
                toIndex < 0 || toIndex >= pages.Count ||
                fromIndex == toIndex)
            {
                return;
            }
            var item = pages[fromIndex];
            // Console.WriteLine($"Moving item from index {fromIndex} to {toIndex}: {item.Id}");
            pages.RemoveAt(fromIndex);
            pages.Insert(toIndex, item);

            // ここで全PageItemsを出力
            // Console.WriteLine("=== After MoveItem ===");
            // for (int i = 0; i < pages.Count; i++)
            // {
            //     var p = pages[i];
            //     Console.WriteLine($"Index: {i}, Id: {p.Id}, FileName: {p.FileName}, OriginalPageIndex: {p.OriginalPageIndex}");
            // }
        }
    }

    /// <summary>
    /// ファイルブロック単位での移動
    /// </summary>
    private void MoveFileBlock(int fromFileIndex, int toFileIndex)
    {
        var fileGroups = _model.Pages.GroupBy(p => p.FileId).ToList();

        if (fromFileIndex < 0 || fromFileIndex >= fileGroups.Count ||
            toFileIndex < 0 || toFileIndex >= fileGroups.Count ||
            fromFileIndex == toFileIndex)
        {
            return;
        }

        var sourceGroup = fileGroups[fromFileIndex].ToList();

        // 移動元のページを削除
        foreach (var page in sourceGroup)
        {
            _model.Pages.Remove(page);
        }

        // 挿入位置を計算
        int insertIndex = 0;
        for (int i = 0; i < fileGroups.Count; i++)
        {
            if (i == toFileIndex)
                break;
            if (i == fromFileIndex)
                continue;
            insertIndex += fileGroups[i].Count();
        }

        // from→toの移動で、toがfromより後ろの場合は挿入位置を調整
        if (toFileIndex > fromFileIndex)
        {
            insertIndex += fileGroups[toFileIndex].Count();
        }

        // 新しい位置に挿入
        _model.Pages.InsertRange(insertIndex, sourceGroup);
    }

    /// <summary>
    /// アイテムを削除
    /// </summary>
    public void RemoveItem(int index)
    {
        var displayItems = GetDisplayItems();
        if (index < 0 || index >= displayItems.Count)
        {
            return;
        }

        var item = displayItems[index];

        if (_model.CurrentMode == DisplayMode.Page)
        {
            // ページ単位表示：該当ページを削除
            var pageToRemove = _model.Pages.FirstOrDefault(p => p.Id == item.Id);
            if (pageToRemove != null)
            {
                _model.Pages.Remove(pageToRemove);

                // そのファイルの他のページがなくなった場合、ファイルメタデータも削除
                if (!_model.Pages.Any(p => p.FileId == pageToRemove.FileId))
                {
                    _model.Files.Remove(pageToRemove.FileId);
                }
            }
        }
        else
        {
            // ファイル単位表示：ファイル全体を削除
            if (item.RawData is FileMetadata file)
            {
                var fileId = file.FileId;

                //    DisplayItem.Idは $"{firstPage.Id}_file" なので、firstPage.Idを復元
                var firstPageId = item.Id.Replace("_file", "");
                var startIndex = _model.Pages.FindIndex(p => p.Id == firstPageId);

                if (startIndex == -1)
                    return;

                // 連続する同じFileIdの範囲を特定
                int endIndex = startIndex;
                while (endIndex + 1 < _model.Pages.Count && _model.Pages[endIndex + 1].FileId == fileId)
                {
                    endIndex++;
                }

                for (int i = endIndex; i >= startIndex; i--)
                {
                    _model.Pages.RemoveAt(i);
                }

                // そのFileIdのページが0になったらファイルメタデータも削除
                if (!_model.Pages.Any(p => p.FileId == fileId))
                {
                    _model.Files.Remove(fileId);
                }
            }
        }
    }



    public void RemovePageFromFile(string fileId, int pageIndex)
    {
        // fileIdで絞った残っているページリストを取得
        var filePages = _model.Pages.Where(p => p.FileId == fileId).OrderBy(p => p.OriginalPageIndex).ToList();
        if (pageIndex >= 0 && pageIndex < filePages.Count)
        {
            var pageToRemove = filePages[pageIndex];
            _model.Pages.Remove(pageToRemove);

            // ページが0になったらファイルごと削除
            if (!_model.Pages.Any(p => p.FileId == fileId))
            {
                _model.Files.Remove(fileId);
            }
        }
    }

    /// <summary>
    /// 指定インデックスのアイテムと次のアイテムを入れ替える
    /// </summary>
    public void SwapWithNext(int index)
    {
        var items = GetDisplayItems();
        if (index >= 0 && index < items.Count - 1)
        {
            MoveItem(index, index + 1);
        }
    }

    public async Task InsertBlankPageWithDisplayModeAsync(
        DisplayMode mode,
        IReadOnlyList<DisplayItem> displayItems,
        int position)
    {
        int insertPosition;
        if (mode == DisplayMode.File)
        {
            int pageInsertPosition = 0;
            for (int i = 0; i < position && i < displayItems.Count; i++)
            {
                pageInsertPosition += displayItems[i].PageCount;
            }
            insertPosition = pageInsertPosition;
        }
        else
        {
            insertPosition = position;
        }

        await InsertBlankPageAsync(insertPosition);
    }
    /// <summary>
    /// 空白ページを挿入
    /// </summary>
    public async Task<bool> InsertBlankPageAsync(int position)
    {
        try
        {
            // 空白ページのPDFデータを生成
            var blankPageData = await _jsRuntime.InvokeAsync<string>("createBlankPage");
            var blankThumbnail = await _jsRuntime.InvokeAsync<string>("generatePdfThumbnailFromPageData", blankPageData);

            if (string.IsNullOrEmpty(blankPageData) || string.IsNullOrEmpty(blankThumbnail))
            {
                return false;
            }

            var fileId = $"blank_page_{DateTime.Now.Ticks}";
            var fileName = $"空白ページ";

            // ファイルメタデータを追加
            var fileMetadata = new FileMetadata
            {
                FileId = fileId,
                FileName = fileName,
                FileData = Convert.FromBase64String(blankPageData),
                PageCount = 1,
                CoverThumbnail = blankThumbnail,
                IsFullyLoaded = true
            };
            _model.Files[fileId] = fileMetadata;

            // ページアイテムを作成
            var pageItem = new PageItem
            {
                FileId = fileId,
                FileName = fileName,
                OriginalPageIndex = 0,
                Thumbnail = blankThumbnail,
                PageData = blankPageData,
                IsLoading = false,
                HasThumbnailError = false,
                HasPageDataError = false,
            };

            // 指定位置に挿入
            var safePosition = Math.Min(position, _model.Pages.Count);
            _model.Pages.Insert(safePosition, pageItem);

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error inserting blank page: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 結合用のページデータリストを取得
    /// </summary>
    public List<object> GetMergeData()
    {
        foreach (var page in _model.Pages)
        {
            if (!IsBase64String(page.PageData))
            {
                Console.WriteLine($"[Base64Check] NG: {page.FileName}");
            }
        }
        return _model.Pages.Select(page => new
        {
            FileName = page.FileName,
            PageIndex = page.OriginalPageIndex,
            ThumbnailData = page.Thumbnail,
            PageData = page.PageData
        }).Cast<object>().ToList();
    }
    private bool IsBase64String(string s)
    {
        if (string.IsNullOrEmpty(s)) return false;
        Span<byte> buffer = new Span<byte>(new byte[s.Length]);
        return Convert.TryFromBase64String(s, buffer, out _);
    }
    public async Task DuplicateItemAsync(string id, bool isFile, int insertIndex)
    {
        if (isFile)
        {
            var file = _model.Files.ContainsKey(id) ? _model.Files[id] : null;
            if (file == null) return;

            var pagesToCopy = _model.Pages.Where(p => p.FileId == id).ToList();
            var newFileId = Guid.NewGuid().ToString();

            // FileMetadataも複製して追加
            var newFileMetadata = new FileMetadata
            {
                FileId = newFileId,
                FileName = file.FileName,
                FileData = file.FileData,
                PageCount = file.PageCount,
                CoverThumbnail = file.CoverThumbnail,
                IsFullyLoaded = file.IsFullyLoaded,
                CreatedAt = DateTime.Now
            };
            _model.Files[newFileId] = newFileMetadata;

            // ファイル単位の挿入位置を計算
            // insertIndexは「ファイルの次の位置」なので、ページリストのインデックスに変換
            var fileGroups = _model.Pages.GroupBy(p => p.FileId).ToList();
            int fileGroupIndex = fileGroups.FindIndex(g => g.Key == id);
            int pageInsertIndex = 0;
            for (int i = 0; i < fileGroups.Count; i++)
            {
                if (i == insertIndex)
                    break;
                pageInsertIndex += fileGroups[i].Count();
            }

            foreach (var page in pagesToCopy)
            {
                var copy = new PageItem
                {
                    Id = $"{newFileId}_p{page.OriginalPageIndex}",
                    FileId = newFileId,
                    FileName = page.FileName,
                    OriginalPageIndex = page.OriginalPageIndex,
                    Thumbnail = page.Thumbnail,
                    PageData = page.PageData,
                    IsLoading = false,
                    HasThumbnailError = false,
                    HasPageDataError = false,
                    ColorHsl = GenerateColorHsl(newFileId)
                };
                _model.Pages.Insert(pageInsertIndex++, copy);
            }
        }
        else
        {
            // ページ単位複製はそのまま
            var page = _model.Pages.FirstOrDefault(p => p.Id == id);
            if (page == null) return;

            var newPage = new PageItem
            {
                Id = Guid.NewGuid().ToString(),
                FileId = page.FileId,
                FileName = page.FileName,
                OriginalPageIndex = page.OriginalPageIndex,
                Thumbnail = page.Thumbnail,
                PageData = page.PageData,
                IsLoading = false,
                HasThumbnailError = false,
                HasPageDataError = false,
                ColorHsl = page.ColorHsl
            };
            int pageIndex = _model.Pages.FindIndex(p => p.Id == id);
            if (pageIndex >= 0)
                _model.Pages.Insert(pageIndex + 1, newPage);
            else
                _model.Pages.Add(newPage);
        }
        await InvokeOnChangeAsync();
    }

    /// <summary>
    /// 指定されたアイテムを回転
    /// </summary>
    public bool RotateItem(int index, int angle = 90)
    {
        try
        {
            if (index < 0 || index >= _model.Pages.Count)
            {
                Console.WriteLine($"Invalid index for rotation: {index}");
                return false;
            }

            var pageItem = _model.Pages[index];
            // ここでデータ自体は変更せず、回転角度だけを更新
            pageItem.RotateAngle = (pageItem.RotateAngle + angle + 360) % 360;
            pageItem.PreviewImage = null;

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error rotating page {index}: {ex.Message}");
            return false;
        }
    }

    public bool RotateFile(string fileId, int angle)
    {
        var pageIndexes = _model.Pages
            .Select((p, idx) => new { Page = p, Index = idx })
            .Where(x => x.Page.FileId == fileId)
            .Select(x => x.Index)
            .ToList();

        bool allSuccess = true;
        foreach (var idx in pageIndexes)
        {
            var success = RotateItem(idx, angle);
            if (!success) allSuccess = false;
        }
        return allSuccess;
    }

    /// <summary>
    /// データをクリア
    /// </summary>
    public void Clear()
    {
        _model.Pages.Clear();
        _model.Files.Clear();
        SplitInfo = new SplitInfo();
        // 表示単位はクリアしない
        // _model.CurrentMode = DisplayMode.File;

        // JS側の pdf-lib キャッシュを非同期でクリア
        try
        {
            // 呼び出しに await を使わないため戻り値は無視する
            _ = _jsRuntime.InvokeVoidAsync("_pdfLibCacheClear");
            _ = _jsRuntime.InvokeVoidAsync("_pdfLibFileRestrictedClear");
        }
        catch
        {
            // 何もしない（Clear は同期APIなので例外は抑える）
        }
        CancelBufferedNotify();
    }

    /// <summary>
    /// ファイル名を短縮表示用にトリミング
    /// </summary>
    private static string TruncateFileName(string fileName, int maxLength = 12)
    {
        if (string.IsNullOrEmpty(fileName) || fileName.Length <= maxLength)
        {
            return fileName;
        }

        var nameWithoutExtension = Path.GetFileNameWithoutExtension(fileName);
        var extension = Path.GetExtension(fileName);

        if (nameWithoutExtension.Length <= maxLength - extension.Length)
        {
            return fileName;
        }

        var truncated = nameWithoutExtension.Substring(0, maxLength - extension.Length - 1) + "…";
        return truncated + extension;
    }

    private async Task InvokeOnChangeAsync()
    {
        OnChange?.Invoke();
        await Task.CompletedTask;
    }

    public async Task<string?> GetPreviewImageAsync(string id, int? pageIndex = null)
    {
        PageItem? pageItem;

        if (pageIndex.HasValue)
        {
            // ファイル単位表示: fileId + pageIndex で検索
            pageItem = _model.Pages.FirstOrDefault(p => p.FileId == id && p.OriginalPageIndex == pageIndex.Value);
        }
        else
        {
            // ページ単位表示: id で検索
            pageItem = _model.Pages.FirstOrDefault(p => p.Id == id);
        }

        if (pageItem == null || string.IsNullOrEmpty(pageItem.PageData))
            return null;

        // キャッシュがあればそのまま返す（回転時はキャッシュをクリア）
        if (!string.IsNullOrEmpty(pageItem.PreviewImage))
        {
            return pageItem.PreviewImage;
        }

        try
        {
            var previewImage = await _jsRuntime.InvokeAsync<string>(
            "generatePreviewImage", pageItem.PageData, pageItem.RotateAngle);
            if (!string.IsNullOrEmpty(previewImage))
            {
                pageItem.PreviewImage = previewImage;
            }
            return previewImage;
        }
        catch
        {
            return null;
        }
    }

    // ファイルIDから安定したパステルカラー（HSL）を生成
    private static string GenerateColorHsl(string fileId)
    {
        // SHA256で安定したハッシュ値を取得
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(fileId));
        int hue = bytes[0]; // 0～255
        hue = (int)(hue / 255.0 * 360); // 0～359に変換
        int saturation = 60; // 彩度（見やすい値）
        int lightness = 85;  // 明度（背景向きの淡い色）
        return $"hsl({hue}, {saturation}%, {lightness}%)";
    }

    // ファイル単位の並び替え
    public void ReorderFiles(List<string> newOrder)
    {
        var newPages = new List<PageItem>();
        foreach (var fileId in newOrder)
        {
            newPages.AddRange(_model.Pages.Where(p => p.FileId == fileId));
        }
        _model.Pages = newPages;
        OnChange?.Invoke();
    }

    // ページ単位の逆順
    public void ReversePages()
    {
        _model.Pages.Reverse();
        OnChange?.Invoke();
    }

    public void SortPagesByName(bool ascending)
    {
        if (_model.Pages == null) return;
        if (ascending)
            _model.Pages = _model.Pages.OrderBy(p => p.FileName).ToList();
        else
            _model.Pages = _model.Pages.OrderByDescending(p => p.FileName).ToList();
        OnChange?.Invoke();
    }

    public async Task<bool> AddOrInsertImageFileAsync(string fileName, byte[] fileData, int? insertPosition = null)
    {
        try
        {
            var fileId = $"{fileName}_{DateTime.Now.Ticks}";
            string base64 = Convert.ToBase64String(fileData);
            string ext = Path.GetExtension(fileName).ToLowerInvariant();

            // サムネイル用データURL生成
            string mime = ext switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".gif" => "image/gif",
                ".bmp" => "image/bmp",
                ".webp" => "image/webp",
                ".svg" => "image/svg+xml",
                _ => "application/octet-stream"
            };
            string dataUrl = $"data:{mime};base64,{base64}";

            // 画像をPDF化
            string pdfBase64 = await _jsRuntime.InvokeAsync<string>("embedImageAsPdf", base64, ext);

            var fileMetadata = new FileMetadata
            {
                FileId = fileId,
                FileName = fileName,
                FileData = fileData,
                PageCount = 1,
                CoverThumbnail = dataUrl,
                IsFullyLoaded = true
            };
            _model.Files[fileId] = fileMetadata;

            var pageItem = new PageItem
            {
                Id = $"{fileId}_p0",
                FileId = fileId,
                FileName = fileName,
                OriginalPageIndex = 0,
                Thumbnail = dataUrl,
                PageData = pdfBase64,
                IsLoading = false,
                HasThumbnailError = false,
                HasPageDataError = false,
                ColorHsl = GenerateColorHsl(fileId)
            };

            if (insertPosition.HasValue)
            {
                var safePosition = Math.Min(insertPosition.Value, _model.Pages.Count);
                _model.Pages.Insert(safePosition, pageItem);
            }
            else
            {
                _model.Pages.Add(pageItem);
            }

            await InvokeOnChangeAsync();
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error adding/inserting image file {fileName}: {ex.Message}");
            return false;
        }
    }

    public void ToggleSplitBefore(int pageIndex)
    {
        if (pageIndex < 0 || pageIndex >= _model.Pages.Count) return;
        // すでに分割位置に含まれていれば削除、なければ追加
        if (SplitInfo.SplitPositions.Contains(pageIndex))
        {
            SplitInfo.SplitPositions.Remove(pageIndex);
        }
        else
        {
            SplitInfo.SplitPositions.Add(pageIndex);
        }
        OnChange?.Invoke();
    }

    public void ToggleExtractSelection(int pageIndex)
    {
        if (pageIndex < 0 || pageIndex >= _model.Pages.Count) return;
        var pageItem = _model.Pages[pageIndex];
        pageItem.IsSelectedForExtract = !pageItem.IsSelectedForExtract;
        OnChange?.Invoke();
    }

    public void SetExtractSelection(DisplayItem item, bool selected)
    {
        if (item.RawData is PageItem page)
        {
            page.IsSelectedForExtract = selected;
            OnChange?.Invoke();
        }
    }

    public async Task HandleFileInputAsync(
    InputFileChangeEventArgs e,
    int? insertPosition = null)
    {
        if (e.FileCount == 0) return;

        const long maxFileSize = 100 * 1024 * 1024; // 100MB
        const long maxTotalSize = 200 * 1024 * 1024; // 200MB

        // 合計サイズチェック
        long newFilesSize = e.GetMultipleFiles().Sum(f => f.Size);
        if (TotalFileSize + newFilesSize > maxTotalSize)
        {
            await _messageService.ShowAsync($"合計ファイルサイズが上限（{maxTotalSize / 1024 / 1024}MB）を超えています。");
            return;
        }

        foreach (var file in e.GetMultipleFiles())
        {
            var ext = Path.GetExtension(file.Name).ToLowerInvariant();

            // 1ファイルごとのサイズチェック
            if (file.Size > maxFileSize)
            {
                await _messageService.ShowAsync($"ファイル「{file.Name}」は最大サイズ（{maxFileSize / 1024 / 1024}MB）を超えています。", MessageType.Warn);
                continue;
            }

            try
            {
                // 許容する最大メモリを引数で指定
                using var stream = file.OpenReadStream(maxFileSize);
                using var memoryStream = new MemoryStream();
                await stream.CopyToAsync(memoryStream);
                var fileData = memoryStream.ToArray();

                bool success = false;
                if (SupportedPdfExtensions.Contains(ext))
                {
                    success = await AddOrInsertPdfFileAsync(file.Name, fileData, insertPosition);
                }
                else if (SupportedImageExtensions.Contains(ext))
                {
                    if (insertPosition.HasValue)
                        success = await AddOrInsertImageFileAsync(file.Name, fileData, insertPosition);
                    else
                        success = await AddOrInsertImageFileAsync(file.Name, fileData);
                }
                else
                {
                    await _messageService.ShowAsync($"未対応のファイル形式です: {file.Name}");
                    continue;
                }

                if (!success)
                {
                    await _messageService.ShowAsync($"ファイルの処理に失敗しました: {file.Name}", MessageType.Warn);
                }
            }
            catch (Exception ex)
            {
                await _messageService.ShowAsync($"ファイル処理エラー: {file.Name} - {ex.Message}", MessageType.Error);
            }
        }

    }

    public async Task<bool> HandleDroppedFileAsync(
        string fileName,
        string base64Data,
        Func<string, byte[], Task<bool>>? onPdf = null,
        Func<string, byte[], Task<bool>>? onImage = null)
    {
        var fileData = Convert.FromBase64String(base64Data);
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        bool success = false;

        if (SupportedPdfExtensions.Contains(ext))
        {
            if (onPdf != null)
                success = await onPdf(fileName, fileData);
        }
        else if (SupportedImageExtensions.Contains(ext))
        {
            if (onImage != null)
                success = await onImage(fileName, fileData);
        }
        else
        {
            await _messageService.ShowAsync($"未対応のファイル形式です: {fileName}", MessageType.Warn);
            return false;
        }

        if (!success)
        {
            await _messageService.ShowAsync($"ファイルの処理に失敗しました: {fileName}", MessageType.Error);
        }

        return success;
    }

    public void RotateAll(DisplayMode mode, IList<DisplayItem> displayItems, int angle)
    {
        if (mode == DisplayMode.File)
        {
            foreach (var file in displayItems)
            {
                RotateFile(file.Id, angle);
            }
        }
        else
        {
            for (int i = 0; i < displayItems.Count; i++)
            {
                RotateItem(i, angle);
            }
        }
    }

    /// <summary>
    /// デバッグ用：現在のページアイテムをコンソールに出力      
    /// </summary>
    public void DebugPrintPages()
    {
        var pages = GetModel().Pages;
        Console.WriteLine("=== 現在のPageItems ===");
        for (int i = 0; i < pages.Count; i++)
        {
            var p = pages[i];
            Console.WriteLine($"Index: {i}, Id: {p.Id}, FileName: {p.FileName}, OriginalPageIndex: {p.OriginalPageIndex}, IsSelectedForExtract: {p.IsSelectedForExtract}");
        }

        OnChange?.Invoke();
    }
    /// <summary>
    /// デバッグ用：_model.Pages の FileId 一覧をコンソールに出力
    /// </summary>
    public void DebugPrintFileIds()
    {
        Console.WriteLine("=== _model.Pages の FileId 一覧 ===");
        foreach (var page in _model.Pages)
        {
            Console.WriteLine(page.FileId);
        }
    }
    // public void SwapPages(int index)
    // {
    //     // indexとindex+1を入れ替え
    //     if (index >= 0 && index < _model.Pages.Count - 1)
    //     {
    //         var tmp = _model.Pages[index];
    //         _model.Pages[index] = _model.Pages[index + 15];
    //         _model.Pages[index + 15] = tmp;
    //         OnChange?.Invoke();
    //     }
    // }

    public void  SetTrimRect(int pageIndex, double x, double y, double width, double height, bool notify = true)
    {
        // 優先して PageItem 側に格納する
        if (pageIndex >= 0 && pageIndex < _model.Pages.Count)
        {
            var page = _model.Pages[pageIndex];
            page.TrimRects.Clear();
            page.TrimRects.Add(new TrimRectInfo { X = x, Y = y, Width = width, Height = height });
        }

        if (notify)
            _ = InvokeOnChangeAsync();
    }

    public void SetTrimRects(int pageIndex, List<TrimRectInfo> rects, bool notify = true)
    {
        if (pageIndex >= 0 && pageIndex < _model.Pages.Count)
        {
            var page = _model.Pages[pageIndex];
            page.TrimRects.Clear();
            if (rects != null && rects.Count > 0)
            {
                page.TrimRects.AddRange(rects);
            }
        }
        if (notify)
        {
            _ = InvokeOnChangeAsync();
        }
    }

    public void ClearTrimRect(int pageIndex)
    {
        if (pageIndex >= 0 && pageIndex < _model.Pages.Count)
        {
            var page = _model.Pages[pageIndex];
            page.TrimRects.Clear();
        }
    }

    public TrimRectInfo? GetTrimRect(int pageIndex)
    {
        if (pageIndex >= 0 && pageIndex < _model.Pages.Count)
        {
            var page = _model.Pages[pageIndex];
            if (page.TrimRects != null && page.TrimRects.Count > 0)
                return page.TrimRects[0];
        }

        return null;
    }

    public List<TrimRectInfo> GetTrimRects(int pageIndex)
    {
        if (pageIndex >= 0 && pageIndex < _model.Pages.Count)
        {
            var page = _model.Pages[pageIndex];
            return page.TrimRects ?? new List<TrimRectInfo>();
        }
        return new List<TrimRectInfo>();
    }

    public Dictionary<int, TrimRectInfo> GetAllTrimRects()
    {
        var result = new Dictionary<int, TrimRectInfo>();
        for (int i = 0; i < _model.Pages.Count; i++)
        {
            var p = _model.Pages[i];
            if (p.TrimRects != null && p.TrimRects.Count > 0)
            {
                result[i] = p.TrimRects[0];
            }
        }
        return result;
    }

    /// <summary>
    /// サービスに保存された全ページの矩形をクリアして再描画する（JS呼び出しを行う）
    /// UI側で再レンダリングを避けたい場合は呼び出し側で await しない運用でも可
    /// </summary>
    public async Task RedrawAllTrimOverlaysAsync()
    {
        try
        {
            var count = _model.Pages?.Count ?? 0;
            if (count == 0) return;

            // まず全オーバーレイをクリア（順次実行してDOMを初期化）
            var clearTasks = Enumerable.Range(0, count)
                .Select(i => _jsRuntime.InvokeVoidAsync("drawTrimOverlayAsSvg", $"trim-preview-canvas-{i}", Array.Empty<object>()).AsTask())
                .ToArray();
            try { await Task.WhenAll(clearTasks); } catch { /* per-canvas ignore */ }

            // サービスに保存されている矩形を全ページ分描画
            var drawTasks = new List<Task>(count);
            for (int i = 0; i < count; i++)
            {
                try
                {
                    var rects = GetTrimRects(i);
                    if (rects != null && rects.Count > 0)
                    {
                        var rectsToRender = rects.Select(r => new { X = r.X, Y = r.Y, Width = r.Width, Height = r.Height }).ToArray();
                        drawTasks.Add(_jsRuntime.InvokeVoidAsync("drawTrimOverlayAsSvg", $"trim-preview-canvas-{i}", rectsToRender).AsTask());
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"RedrawAllTrimOverlaysAsync: draw failed for page {i}: {ex.Message}");
                }
            }

            if (drawTasks.Count > 0)
            {
                try { await Task.WhenAll(drawTasks); } catch { /* ignore per-canvas errors */ }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"RedrawAllTrimOverlaysAsync error: {ex.Message}");
        }
    }

    /// <summary>
    /// 指定ページの矩形を再描画する（非同期 fire-and-forget 呼び出しが可能）
    /// </summary>
    public Task RedrawTrimOverlayForPageAsync(int pageIndex)
    {
        try
        {
            var rects = GetTrimRects(pageIndex);
            if (rects != null && rects.Count > 0)
            {
                var rectsToRender = rects.Select(r => new { X = r.X, Y = r.Y, Width = r.Width, Height = r.Height }).ToArray();
                _ = _jsRuntime.InvokeVoidAsync("drawTrimOverlayAsSvg", $"trim-preview-canvas-{pageIndex}", rectsToRender);
            }
            else
            {
                _ = _jsRuntime.InvokeVoidAsync("drawTrimOverlayAsSvg", $"trim-preview-canvas-{pageIndex}", Array.Empty<object>());
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"RedrawTrimOverlayForPageAsync error page={pageIndex}: {ex.Message}");
        }
        return Task.CompletedTask;
    }

    // バッファリング用フィールド（クラス内）
    private readonly object _notifyLock = new();
    private CancellationTokenSource? _bufferNotifyCts;
    private bool _bufferNotifyScheduled = false;
   private readonly TimeSpan _bufferNotifyDelay = TimeSpan.FromMilliseconds(300); // 調整
   /// <summary>
   /// 頻繁に呼ばれる箇所用のバッファ通知（LoadAllPagesForFileAsync 等で使う）
   /// 呼び出し側は await して問題なし。短時間内はまとめて 1 回だけ OnChange を発火する。
   /// </summary>
    private async Task BufferedNotifyChangeAsync()
    {
        lock (_notifyLock)
        {
            if (_bufferNotifyScheduled) return; // 既にスケジュール済みならまとめる
            _bufferNotifyScheduled = true;
            _bufferNotifyCts = new CancellationTokenSource();
        }
        try
        {
            var cts = _bufferNotifyCts;
            await Task.Delay(_bufferNotifyDelay, cts.Token);
        }
        catch (OperationCanceledException) { }
        finally
        {
            lock (_notifyLock)
            {
                _bufferNotifyScheduled = false;
                _bufferNotifyCts?.Dispose();
                _bufferNotifyCts = null;
            }
        }
        OnChange?.Invoke();
        await Task.CompletedTask;
    }
    /// <summary>
    /// スケジュール済みのバッファ通知があればキャンセル（Clear 等で呼ぶ）
    /// </summary>
    private void CancelBufferedNotify()
    {
        lock (_notifyLock)
        {
            try { _bufferNotifyCts?.Cancel(); } catch { }
            _bufferNotifyScheduled = false;
            _bufferNotifyCts = null;
        }
    }

}

