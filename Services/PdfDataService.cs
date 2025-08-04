using ClientPdfApp.Models;
using Microsoft.JSInterop;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Components.Forms;

namespace ClientPdfApp.Services;

/// <summary>
/// 統一PDFデータサービス - ファイル表示とページ表示の統一データ管理
/// </summary>
public class PdfDataService
{
    private readonly IJSRuntime _jsRuntime;
    private UnifiedPdfModel _model = new();
    public event Action? OnChange;

    public PdfDataService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    /// <summary>
    /// 現在のデータモデルを取得
    /// </summary>
    public UnifiedPdfModel GetModel() => _model;

    public SplitInfo SplitInfo { get; private set; } = new SplitInfo();

    // PdfDataService.cs など
    public static readonly string[] SupportedImageExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg" };
    public static readonly string[] SupportedPdfExtensions = new[] { ".pdf" };

    /// <summary>
    /// 表示モードを切り替え
    /// </summary>
    public void SwitchDisplayMode(DisplayMode mode)
    {
        _model.CurrentMode = mode;
    }

    /// <summary>
    /// バックグラウンド読み込みが必要なファイルをチェック
    /// </summary>
    public async Task EnsureAllPagesLoadedAsync()
    {
        var pendingFiles = _model.Files.Where(f => !f.Value.IsFullyLoaded).ToList();

        if (pendingFiles.Any())
        {
            Console.WriteLine($"Found {pendingFiles.Count} files with pending background loading");

            foreach (var file in pendingFiles)
            {
                try
                {
                    Console.WriteLine($"Loading remaining pages for: {file.Value.FileName}");
                    await LoadAllPagesForFileAsync(file.Key);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error loading pages for {file.Value.FileName}: {ex.Message}");
                }
            }
        }
        else
        {
            Console.WriteLine("All files already have background loading completed");
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
                IsLoading = isLoading,
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
            var coverThumbnail = await _jsRuntime.InvokeAsync<string>("renderFirstPDFPage", fileData);
            var pageCount = await _jsRuntime.InvokeAsync<int>("getPDFPageCount", fileData);
            if (string.IsNullOrEmpty(coverThumbnail) || pageCount <= 0)
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
                CoverThumbnail = coverThumbnail,
                IsFullyLoaded = false,
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
                    Thumbnail = i == 0 ? coverThumbnail : "", // 1ページ目は表紙
                    PageData = "",
                    IsLoading = true,
                    HasThumbnailError = false,
                    HasPageDataError = false,
                    ColorHsl = GenerateColorHsl(fileId)
                };
                _model.Pages.Insert(baseIndex + i, loadingItem);
            }

            // バックグラウンドで全ページのPageData読み込みを開始
            _ = Task.Run(async () =>
            {
                try
                {
                    await LoadAllPagesForFileAsync(fileId);
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

    public class RenderResult
    {
        public string thumbnail { get; set; } = "";
        public bool isError { get; set; }
    }
    /// <summary>
    /// 特定ファイルの全ページをバックグラウンド読み込み（ページ単位表示用）
    /// </summary>
    public async Task LoadAllPagesForFileAsync(string fileId)
    {
        if (!_model.Files.TryGetValue(fileId, out var fileMetadata) || fileMetadata.IsFullyLoaded)
        {
            Console.WriteLine($"Skipping load for {fileId}: already loaded or not found");
            return;
        }

        try
        {

            // 既存のページアイテムを取得
            var existingPageItems = _model.Pages.Where(p => p.FileId == fileId).ToList();

            int successfulPages = 0;
            int failedPages = 0;

            for (int pageIndex = 0; pageIndex < fileMetadata.PageCount; pageIndex++)
            {
                try
                {
                    var pageId = $"{fileId}_p{pageIndex}";
                    var pageItem = existingPageItems.FirstOrDefault(p => p.Id == pageId);
                    if (pageItem == null || !_model.Pages.Contains(pageItem))
                    {
                        // PageItemが存在しない場合はスキップ（追加はしない）
                        failedPages++;
                        Console.WriteLine($"Warning: PageItem not found for {pageId}, skipping update.");
                        continue;
                    }

                    string thumbnail = "";
                    string pageData = "";
                    bool thumbError = false;
                    bool dataError = false;

                    if (pageIndex == 0)
                    {
                        thumbnail = fileMetadata.CoverThumbnail;
                        pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", fileMetadata.FileData, pageIndex);
                        thumbError = string.IsNullOrEmpty(thumbnail);
                        dataError = string.IsNullOrEmpty(pageData);
                    }
                    else
                    {
                        var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                        try
                        {
                            var renderResult = await _jsRuntime.InvokeAsync<RenderResult>(
                                "renderPdfPage", cts.Token, fileMetadata.FileData, pageIndex);
                            thumbnail = renderResult.thumbnail;
                            thumbError = renderResult.isError || string.IsNullOrEmpty(thumbnail);
                            pageData = await _jsRuntime.InvokeAsync<string>("extractPdfPage", cts.Token, fileMetadata.FileData, pageIndex);
                            dataError = string.IsNullOrEmpty(pageData);
                        }
                        catch (OperationCanceledException)
                        {
                            Console.WriteLine($"Timeout loading page {pageIndex + 1} of {fileMetadata.FileName}");
                            thumbnail = "";
                            thumbError = true;
                            dataError = false;
                        }
                    }

                    pageItem.Thumbnail = thumbnail;
                    pageItem.PageData = pageData;
                    pageItem.IsLoading = false;
                    pageItem.HasThumbnailError = thumbError;
                    pageItem.HasPageDataError = dataError;

                    // UI更新イベント発火
                    await InvokeOnChangeAsync();

                    if (!thumbError && !dataError)
                    {
                        successfulPages++;
                    }
                    else
                    {
                        failedPages++;
                        Console.WriteLine($"Warning: Page {pageIndex + 1} of {fileMetadata.FileName} failed to load properly");
                    }
                }
                catch (Exception pageEx)
                {
                    failedPages++;
                    Console.WriteLine($"Error loading page {pageIndex + 1} of {fileMetadata.FileName}: {pageEx.Message}");

                    var pageId = $"{fileId}_p{pageIndex}";
                    var pageItem = existingPageItems.FirstOrDefault(p => p.Id == pageId);
                    if (pageItem != null)
                    {
                        pageItem.IsLoading = false;
                        pageItem.HasThumbnailError = true;
                        pageItem.HasPageDataError = true;
                        pageItem.Thumbnail = "";
                        pageItem.PageData = "";
                        // エラー時もUI更新イベント発火
                        await InvokeOnChangeAsync();
                    }
                }
            }

            fileMetadata.IsFullyLoaded = true;
            Console.WriteLine($"Background loading completed: {successfulPages}/{fileMetadata.PageCount} pages successfully for {fileMetadata.FileName} ({failedPages} failed)");
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
            setErrorMessage?.Invoke($"ファイル選択ダイアログの表示に失敗しました: {ex.Message}");
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

            if (pageIndex == 0)
            {
                thumbnail = fileMetadata.CoverThumbnail;
                pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", fileMetadata.FileData, pageIndex);
                thumbError = string.IsNullOrEmpty(thumbnail);
                dataError = string.IsNullOrEmpty(pageData);
            }
            else
            {
                var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                try
                {
                    var renderResult = await _jsRuntime.InvokeAsync<RenderResult>("renderPDFPage", cts.Token, fileMetadata.FileData, pageIndex);
                    thumbnail = renderResult.thumbnail;
                    thumbError = renderResult.isError || string.IsNullOrEmpty(thumbnail);

                    pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", cts.Token, fileMetadata.FileData, pageIndex);
                    dataError = string.IsNullOrEmpty(pageData);
                }
                catch (OperationCanceledException)
                {
                    Console.WriteLine($"Timeout reloading page {pageIndex + 1} of {fileMetadata.FileName}");
                    thumbnail = "";
                    thumbError = true;
                    dataError = false;
                }
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
                var pagesToRemove = _model.Pages.Where(p => p.FileId == fileId).ToList();
                foreach (var page in pagesToRemove)
                {
                    Console.WriteLine($"Removing page: {page.FileName}, Index: {page.OriginalPageIndex}");
                    _model.Pages.Remove(page);
                }
                _model.Files.Remove(item.Id);
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
            var blankThumbnail = await _jsRuntime.InvokeAsync<string>("renderSinglePDFPage", blankPageData);

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
    public async Task<bool> RotateItemAsync(int index, int angle = 90)
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

            await InvokeOnChangeAsync();
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error rotating page {index}: {ex.Message}");
            return false;
        }
    }

    public async Task<bool> RotateFileAsync(string fileId, int angle)
    {
        var pageIndexes = _model.Pages
            .Select((p, idx) => new { Page = p, Index = idx })
            .Where(x => x.Page.FileId == fileId)
            .Select(x => x.Index)
            .ToList();

        bool allSuccess = true;
        foreach (var idx in pageIndexes)
        {
            var success = await RotateItemAsync(idx, angle);
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
        _model.CurrentMode = DisplayMode.File;
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

        try
        {
            var previewImage = await _jsRuntime.InvokeAsync<string>(
            "generatePreviewImage", pageItem.PageData, pageItem.RotateAngle);
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
    int? insertPosition = null,
    Action<string>? setErrorMessage = null,
    Action? setIsLoading = null,
    Action? setIsLoaded = null)
    {
        if (e.FileCount == 0) return;

        setIsLoading?.Invoke();
        setErrorMessage?.Invoke("");

        const long maxFileSize = 52428800; // 50MB

        foreach (var file in e.GetMultipleFiles())
        {
            var ext = Path.GetExtension(file.Name).ToLowerInvariant();
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
                    setErrorMessage?.Invoke($"未対応のファイル形式です: {file.Name}");
                }

                if (!success)
                {
                    setErrorMessage?.Invoke($"ファイルの処理に失敗しました: {file.Name}");
                }
            }
            catch (Exception ex)
            {
                setErrorMessage?.Invoke($"ファイル処理エラー: {file.Name} - {ex.Message}");
            }
        }

        setIsLoaded?.Invoke();
    }

    public async Task<bool> HandleDroppedFileAsync(
        string fileName,
        string base64Data,
        Action<string>? setErrorMessage = null,
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
            setErrorMessage?.Invoke($"未対応のファイル形式です: {fileName}");
        }

        if (!success)
        {
            setErrorMessage?.Invoke($"ファイルの処理に失敗しました: {fileName}");
        }

        return success;
    }

    public async Task RotateAllAsync(DisplayMode mode, IList<DisplayItem> displayItems, int angle)
    {
        if (mode == DisplayMode.File)
        {
            foreach (var file in displayItems)
            {
                await RotateFileAsync(file.Id, angle);
            }
        }
        else
        {
            for (int i = 0; i < displayItems.Count; i++)
            {
                await RotateItemAsync(i, angle);
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
}

