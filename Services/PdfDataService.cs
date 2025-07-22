using ClientPdfApp.Models;
using Microsoft.JSInterop;

namespace ClientPdfApp.Services;

/// <summary>
/// 統一PDFデータサービス - ファイル表示とページ表示の統一データ管理
/// </summary>
public class PdfDataService
{
    private readonly IJSRuntime _jsRuntime;
    private UnifiedPdfModel _model = new();

    public PdfDataService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    /// <summary>
    /// 現在のデータモデルを取得
    /// </summary>
    public UnifiedPdfModel GetModel() => _model;

    /// <summary>
    /// 表示モードを切り替え
    /// </summary>
    public void SwitchDisplayMode(DisplayMode mode)
    {
        _model.CurrentMode = mode;
    }

    /// <summary>
    /// ページアイテムが存在することを確保（読み込み中状態でも即座に表示）
    /// </summary>
    private void EnsurePageItemsExist()
    {
        // 不要: ファイル追加時にページ数分のPageItemを生成するため、以降は何もしない
    }

    /// <summary>
    /// 読み込み中状態のページアイテムを作成
    /// </summary>
    private void CreateLoadingPageItems(string fileId, FileMetadata fileMetadata)
    {
        // 不要: ファイル追加時にページ数分のPageItemを生成するため、以降は何もしない

        Console.WriteLine($"Created {fileMetadata.PageCount} loading page items for {fileMetadata.FileName}");
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
        foreach (var fileMetadata in _model.Files.Values.OrderBy(f => f.CreatedAt))
        {
            var firstPage = _model.Pages.FirstOrDefault(p => p.FileId == fileMetadata.FileId);
            var hasError = firstPage?.HasError ?? false;
            var isLoading = (string.IsNullOrEmpty(fileMetadata.CoverThumbnail) && !(firstPage?.HasError ?? false));
            var item = new DisplayItem
            {
                Id = fileMetadata.FileId,
                DisplayName = TruncateFileName(fileMetadata.FileName),
                Thumbnail = fileMetadata.CoverThumbnail,
                PageInfo = fileMetadata.PageCount > 1 ? $"{fileMetadata.PageCount}ページ" : "",
                IsLoading = isLoading,
                HasError = hasError,
                RawData = fileMetadata,
                PageCount = fileMetadata.PageCount // ← ここを追加
            };
            result.Add(item);
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
            Thumbnail = page.Thumbnail,
            PageInfo = $"p.{page.OriginalPageNumber}",
            IsLoading = page.IsLoading,
            HasError = page.HasError,
            RawData = page
        }).ToList();
    }

    /// <summary>
    /// 新しいPDFファイルを追加（高速ロード - 表紙のみ + バックグラウンド全ページ読み込み）
    /// </summary>
    public async Task<bool> AddPdfFileAsync(string fileName, byte[] fileData)
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
                IsFullyLoaded = false // バックグラウンド読み込み開始前
            };
            _model.Files[fileId] = fileMetadata;

            // base64データは必要な時に変換する
            var base64Data = Convert.ToBase64String(fileData);

            // ページ単位表示用：ページ数分のPageItemを必ず生成
            for (int i = 0; i < pageCount; i++)
            {
                var pageItem = new PageItem
                {
                    Id = $"{fileId}_p{i}",
                    FileId = fileId,
                    FileName = fileName,
                    OriginalPageIndex = i,
                    Thumbnail = i == 0 ? coverThumbnail : "",
                    PageData = "",
                    IsLoading = i > 0 || string.IsNullOrEmpty(coverThumbnail),
                    HasError = false
                };
                _model.Pages.Add(pageItem);
            }

            // 追加直後のPageItem順を出力
            try
            {
                var order = _model.Pages.Select(p => $"{p.FileName}[{p.FileId}]_p{p.OriginalPageIndex}").ToList();
                Console.WriteLine($"[PageItemOrder] After Add: {string.Join(", ", order)}");
            }
            catch { }

            // バックグラウンドで全ページの読み込みを開始（非同期・非ブロッキング）
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
            Console.WriteLine($"Error adding PDF file {fileName}: {ex.Message}");
            Console.WriteLine($"Stack trace: {ex.StackTrace}");
            if (ex.InnerException != null)
            {
                Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
            }

            // エラーが発生してもPageItemを追加してエラー状態を表示
            try
            {
                var fileId = $"{fileName}_{DateTime.Now.Ticks}";
                var base64Data = Convert.ToBase64String(fileData);

                // エラー状態のファイルメタデータを追加
                var errorFileMetadata = new FileMetadata
                {
                    FileId = fileId,
                    FileName = fileName,
                    FileData = fileData,
                    PageCount = 1, // エラー時は1ページとして扱う
                    CoverThumbnail = "", // エラー画像は後で生成
                    IsFullyLoaded = false
                };
                _model.Files[fileId] = errorFileMetadata;

                // エラー状態のPageItemを追加
                var errorPageItem = new PageItem
                {
                    FileId = fileId,
                    FileName = fileName,
                    OriginalPageIndex = 0,
                    Thumbnail = "", // 空にしてエラー状態を表示
                    PageData = base64Data,
                    IsLoading = false,
                    HasError = true
                };
                _model.Pages.Add(errorPageItem);
            }
            catch (Exception addErrorEx)
            {
                Console.WriteLine($"Failed to add error item: {addErrorEx.Message}");
            }

            return false;
        }
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
            Console.WriteLine($"Background loading all pages for file: {fileMetadata.FileName} ({fileMetadata.PageCount} pages)");

            // 既存のページアイテムを取得
            var existingPageItems = _model.Pages.Where(p => p.FileId == fileId).ToList();

            int successfulPages = 0;
            int failedPages = 0;

            for (int pageIndex = 0; pageIndex < fileMetadata.PageCount; pageIndex++)
            {
                try
                {
                    var pageId = $"{fileId}_p{pageIndex}";
                    var existingPageItem = existingPageItems.FirstOrDefault(p => p.Id == pageId);
                    if (existingPageItem == null)
                    {
                        // PageItemが存在しない場合はスキップ（追加はしない）
                        failedPages++;
                        Console.WriteLine($"Warning: PageItem not found for {pageId}, skipping update.");
                        continue;
                    }

                    string thumbnail;
                    string pageData;

                    if (pageIndex == 0)
                    {
                        thumbnail = fileMetadata.CoverThumbnail;
                        pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", fileMetadata.FileData, pageIndex);
                    }
                    else
                    {
                        var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                        try
                        {
                            thumbnail = await _jsRuntime.InvokeAsync<string>("renderPDFPage", cts.Token, fileMetadata.FileData, pageIndex);
                            pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", cts.Token, fileMetadata.FileData, pageIndex);
                        }
                        catch (OperationCanceledException)
                        {
                            Console.WriteLine($"Timeout loading page {pageIndex + 1} of {fileMetadata.FileName}");
                            thumbnail = "";
                            pageData = "";
                        }
                    }

                    existingPageItem.Thumbnail = thumbnail;
                    existingPageItem.PageData = pageData;
                    existingPageItem.IsLoading = false;
                    existingPageItem.HasError = string.IsNullOrEmpty(thumbnail) || string.IsNullOrEmpty(pageData);

                    if (!string.IsNullOrEmpty(thumbnail) && !string.IsNullOrEmpty(pageData))
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
                    var existingPageItem = existingPageItems.FirstOrDefault(p => p.Id == pageId);
                    if (existingPageItem != null)
                    {
                        existingPageItem.IsLoading = false;
                        existingPageItem.HasError = true;
                        existingPageItem.Thumbnail = "";
                        existingPageItem.PageData = "";
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
                item.HasError = true;
                item.Thumbnail = "";
            }
        }
    }

    /// <summary>
    /// アイテムの順序を変更（ドラッグ&ドロップ対応）
    /// </summary>
    public void MoveItem(int fromIndex, int toIndex)
    {
        var displayItems = GetDisplayItems();
        if (fromIndex < 0 || fromIndex >= displayItems.Count ||
            toIndex < 0 || toIndex >= displayItems.Count ||
            fromIndex == toIndex)
        {
            return;
        }

        if (_model.CurrentMode == DisplayMode.Page)
        {
            // ページ単位表示：Pages内で直接移動
            var item = _model.Pages[fromIndex];
            _model.Pages.RemoveAt(fromIndex);
            _model.Pages.Insert(toIndex, item);
        }
        else
        {
            // ファイル単位表示：ファイルごとのページブロックを移動
            MoveFileBlock(fromIndex, toIndex);
        }
    }

    /// <summary>
    /// ファイルブロック単位での移動
    /// </summary>
    private void MoveFileBlock(int fromFileIndex, int toFileIndex)
    {
        var fileGroups = _model.Pages.GroupBy(p => p.FileId).ToList();

        if (fromFileIndex >= fileGroups.Count || toFileIndex >= fileGroups.Count)
        {
            return;
        }

        var sourceGroup = fileGroups[fromFileIndex];
        var sourcePages = sourceGroup.ToList();

        // 移動元のページを削除
        foreach (var page in sourcePages)
        {
            _model.Pages.Remove(page);
        }

        // 挿入位置を計算
        int insertIndex = 0;
        for (int i = 0; i < toFileIndex && i < fileGroups.Count; i++)
        {
            if (i != fromFileIndex) // 移動元は除外
            {
                insertIndex += fileGroups[i].Count();
            }
        }

        // 新しい位置に挿入
        _model.Pages.InsertRange(insertIndex, sourcePages);
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
            var pagesToRemove = _model.Pages.Where(p => p.FileId == item.Id).ToList();
            foreach (var page in pagesToRemove)
            {
                _model.Pages.Remove(page);
            }
            _model.Files.Remove(item.Id);
        }
    }

    /// <summary>
    /// 2つのアイテムを入れ替え
    /// </summary>
    public void SwapItems(int index1, int index2)
    {
        if (index1 < 0 || index1 >= _model.Pages.Count ||
            index2 < 0 || index2 >= _model.Pages.Count ||
            index1 == index2)
        {
            Console.WriteLine($"Invalid swap indices: {index1}, {index2}");
            return;
        }

        // PageItemを直接入れ替え
        var temp = _model.Pages[index1];
        _model.Pages[index1] = _model.Pages[index2];
        _model.Pages[index2] = temp;

        Console.WriteLine($"Successfully swapped items at indices {index1} and {index2}");
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
            var fileName = $"空白ページ_{DateTime.Now:HHmmss}.pdf";

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
                HasError = false
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
    /// 指定位置にPDFファイルを挿入
    /// </summary>
    public async Task<bool> InsertPdfFileAsync(int position, string fileName, byte[] fileData)
    {
        try
        {
            var fileId = $"inserted_{DateTime.Now.Ticks}";
            var base64Data = Convert.ToBase64String(fileData);
            var pageCount = await _jsRuntime.InvokeAsync<int>("getPDFPageCount", base64Data);
            if (pageCount <= 0) return false;

            var coverThumbnail = await _jsRuntime.InvokeAsync<string>("renderPDFPage", base64Data, 0);
            if (string.IsNullOrEmpty(coverThumbnail)) return false;

            var fileMetadata = new FileMetadata
            {
                FileId = fileId,
                FileName = fileName,
                FileData = fileData,
                PageCount = pageCount,
                CoverThumbnail = coverThumbnail,
                IsFullyLoaded = false
            };
            _model.Files[fileId] = fileMetadata;

            // すべてのページを position の位置に Insert
            for (int pageIndex = 0; pageIndex < pageCount; pageIndex++)
            {
                var thumbnail = pageIndex == 0 ? coverThumbnail :
                    await _jsRuntime.InvokeAsync<string>("renderPDFPage", base64Data, pageIndex);

                var pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", base64Data, pageIndex);

                var pageItem = new PageItem
                {
                    FileId = fileId,
                    FileName = fileName,
                    OriginalPageIndex = pageIndex,
                    Thumbnail = thumbnail,
                    PageData = pageData,
                    IsLoading = false,
                    HasError = string.IsNullOrEmpty(thumbnail) || string.IsNullOrEmpty(pageData)
                };

                _model.Pages.Insert(position + pageIndex, pageItem);
            }
            fileMetadata.IsFullyLoaded = true;

            Console.WriteLine($"Successfully inserted PDF file: {fileName} at position {position}");
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error inserting PDF file: {ex.Message}");
            return false;
        }
    }
    /// <summary>
    /// 結合用のページデータリストを取得
    /// </summary>
    public List<object> GetMergeData()
    {
        return _model.Pages.Select(page => new
        {
            FileName = page.FileName,
            PageIndex = page.OriginalPageIndex,
            ThumbnailData = page.Thumbnail,
            PageData = page.PageData
        }).Cast<object>().ToList();
    }

    /// <summary>
    /// ファイル単位表示でのファイル展開（全ページを個別表示に切り替え）
    /// </summary>
    public async Task<bool> ExpandFileAsync(int fileIndex)
    {
        try
        {
            if (_model.CurrentMode != DisplayMode.File)
            {
                Console.WriteLine("ExpandFileAsync can only be called in File mode");
                return false;
            }

            if (fileIndex < 0 || fileIndex >= _model.Pages.Count)
            {
                Console.WriteLine($"Invalid file index: {fileIndex}");
                return false;
            }

            var fileItem = _model.Pages[fileIndex];
            var fileId = fileItem.FileId;

            if (!_model.Files.ContainsKey(fileId))
            {
                Console.WriteLine($"File metadata not found for fileId: {fileId}");
                return false;
            }

            var fileMetadata = _model.Files[fileId];

            // ファイルが複数ページの場合のみ展開処理を実行
            if (fileMetadata.PageCount <= 1)
            {
                Console.WriteLine($"File has only {fileMetadata.PageCount} page(s), no expansion needed");
                return true; // 1ページしかない場合は成功として扱う
            }

            // 全ページが読み込まれていない場合は読み込み
            if (!fileMetadata.IsFullyLoaded)
            {
                await LoadAllPagesForFileAsync(fileId);
            }

            // 現在のファイルアイテムを削除
            _model.Pages.RemoveAt(fileIndex);

            // 該当ファイルの全ページを個別に挿入
            var base64Data = Convert.ToBase64String(fileMetadata.FileData);
            for (int pageIndex = 0; pageIndex < fileMetadata.PageCount; pageIndex++)
            {
                var thumbnail = pageIndex == 0 ? fileMetadata.CoverThumbnail :
                              await _jsRuntime.InvokeAsync<string>("renderPDFPage", base64Data, pageIndex);

                var pageData = await _jsRuntime.InvokeAsync<string>("extractPDFPage", base64Data, pageIndex);

                var pageItem = new PageItem
                {
                    FileId = fileId,
                    FileName = fileMetadata.FileName,
                    OriginalPageIndex = pageIndex,
                    Thumbnail = thumbnail,
                    PageData = pageData,
                    IsLoading = false,
                    HasError = string.IsNullOrEmpty(thumbnail) || string.IsNullOrEmpty(pageData)
                };

                _model.Pages.Insert(fileIndex + pageIndex, pageItem);
            }

            // ファイルが完全に読み込まれたことをマーク
            fileMetadata.IsFullyLoaded = true;

            Console.WriteLine($"Successfully expanded file {fileMetadata.FileName} into {fileMetadata.PageCount} pages");
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error expanding file: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 指定されたアイテムを回転
    /// </summary>
    public async Task<bool> RotateItemAsync(int index)
    {
        try
        {
            if (index < 0 || index >= _model.Pages.Count)
            {
                Console.WriteLine($"Invalid index for rotation: {index}");
                return false;
            }

            var pageItem = _model.Pages[index];

            // JavaScriptでページを90度回転
            var rotatedPageData = await _jsRuntime.InvokeAsync<string>("rotatePDFPage", pageItem.PageData, 90);
            if (string.IsNullOrEmpty(rotatedPageData))
            {
                Console.WriteLine("Failed to rotate page data");
                return false;
            }

            // 回転後のサムネイルを生成
            var rotatedThumbnail = await _jsRuntime.InvokeAsync<string>("renderSinglePDFPage", rotatedPageData);
            if (string.IsNullOrEmpty(rotatedThumbnail))
            {
                Console.WriteLine("Failed to generate rotated thumbnail");
                return false;
            }

            // ページアイテムを更新
            pageItem.PageData = rotatedPageData;
            pageItem.Thumbnail = rotatedThumbnail;
            pageItem.IsLoading = false;
            pageItem.HasError = false;

            Console.WriteLine($"Successfully rotated page {index}");
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error rotating page {index}: {ex.Message}");
            return false;
        }
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
}
