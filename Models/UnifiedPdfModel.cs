namespace ClientPdfApp.Models;

/// <summary>
/// 統一PDFデータモデル - ファイル表示とページ表示の両方で共有する単一のデータソース
/// </summary>
public class UnifiedPdfModel
{
    /// <summary>
    /// 現在の表示順序でのページアイテムリスト（メインデータ）
    /// </summary>
    public List<PageItem> Pages { get; set; } = new();

    /// <summary>
    /// ファイルメタデータのマップ（FileId -> FileMetadata）
    /// </summary>
    public Dictionary<string, FileMetadata> Files { get; set; } = new();

    /// <summary>
    /// 現在の表示モード
    /// </summary>
    public DisplayMode CurrentMode { get; set; } = DisplayMode.File;
}

/// <summary>
/// 個別ページの情報
/// </summary>
public class PageItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString(); // ユニークID
    public string FileId { get; set; } = ""; // 所属ファイルのID
    public string FileName { get; set; } = ""; // ファイル名
    public int OriginalPageIndex { get; set; } = 0; // 元ファイル内でのページ番号（0始まり）
    public int OriginalPageNumber => OriginalPageIndex + 1; // 元ファイル内でのページ番号（1始まり）
    public string Thumbnail { get; set; } = ""; // サムネイル画像データ
    public string PageData { get; set; } = ""; // PDFページデータ
    public bool IsLoading { get; set; } = true; // ローディング中フラグ
    public bool HasError { get; set; } = false; // エラー状態フラグ
    public DateTime CreatedAt { get; set; } = DateTime.Now; // 作成日時（並び替えの参考用）
    public string ColorHsl { get; set; } = ""; // 色（HSL形式） - ファイルIDから生成
}

/// <summary>
/// ファイルのメタデータ
/// </summary>
public class FileMetadata
{
    public string FileId { get; set; } = ""; // ファイルID
    public string FileName { get; set; } = ""; // ファイル名
    public byte[] FileData { get; set; } = Array.Empty<byte>(); // 元ファイルデータ
    public int PageCount { get; set; } = 0; // 総ページ数
    public string CoverThumbnail { get; set; } = ""; // 表紙サムネイル
    public bool IsFullyLoaded { get; set; } = false; // 全ページ読み込み完了フラグ
    public DateTime CreatedAt { get; set; } = DateTime.Now; // ファイル追加日時
}

/// <summary>
/// 表示モード
/// </summary>
public enum DisplayMode
{
    File, // ファイル単位表示
    Page  // ページ単位表示
}

/// <summary>
/// 表示用アイテム（UIバインディング用）
/// </summary>
public class DisplayItem
{
    public string Id { get; set; } = ""; // PageItem.Id または FileId
    public string DisplayName { get; set; } = ""; // 表示名
    public string FullFileName { get; set; } = ""; // フルファイル名（パスを含む）
    public string Thumbnail { get; set; } = ""; // 表示用サムネイル
    public string PageInfo { get; set; } = ""; // ページ情報（"p.3" など）
    public bool IsLoading { get; set; } = false; // ローディング状態
    public bool HasError { get; set; } = false; // エラー状態
    public object RawData { get; set; } = null!; // 元データへの参照
    public int PageCount { get; set; }// ファイル単位表示時のページ数
    public string ColorHsl { get; set; } = ""; // 色（HSL形式） - ファイルIDから生成
}
