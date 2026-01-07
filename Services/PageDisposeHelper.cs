using Microsoft.JSInterop;

namespace NoCloudPdf.Services;

/// <summary>
/// Blazor ページの Dispose 処理を共通化するヘルパークラス
/// </summary>
public static class PageDisposeHelper
{
    /// <summary>
    /// 標準的な Dispose 処理を実行
    /// </summary>
    public static async Task DisposePageAsync<T>(
        IJSRuntime jsRuntime,
        DotNetObjectReference<T>? dotNetRef,
        bool dropAreaRegistered,
        Action? onChangeHandler,
        PdfDataService pdfDataService,
        TaskCompletionSource<string?>? passwordTcs,
        CompletionStateService? completionState = null,
        Func<Task>? additionalCleanup = null) where T : class
    {
        // イベントハンドラを解除
        if (onChangeHandler != null)
        {
            pdfDataService.OnChange -= onChangeHandler;
        }

        // JS のイベント登録を解除
        if (dropAreaRegistered)
        {
            try { await jsRuntime.InvokeVoidAsync("unregisterDropArea", "drop-area"); }
            catch { /* 無視 */ }
        }

        try { await jsRuntime.InvokeVoidAsync("unregisterSelectDropArea"); }
        catch { /* 無視 */ }

        // 追加のクリーンアップ処理 (ページ固有)
        if (additionalCleanup != null)
        {
            try { await additionalCleanup(); }
            catch { /* 無視 */ }
        }

        // 非同期タスクのキャンセル
        passwordTcs?.TrySetCanceled();

        // DotNetObjectReference を破棄
        dotNetRef?.Dispose();

        // CompletionState をリセット (オプション)
        completionState?.Reset();
    }

    /// <summary>
    /// ドロップエリアの安全な解除
    /// </summary>
    public static async Task UnregisterDropAreaAsync(IJSRuntime jsRuntime, string elementId = "drop-area")
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("unregisterDropArea", elementId);
        }
        catch { /* 無視 */ }
    }

    /// <summary>
    /// 選択ドロップエリアの安全な解除
    /// </summary>
    public static async Task UnregisterSelectDropAreaAsync(IJSRuntime jsRuntime)
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("unregisterSelectDropArea");
        }
        catch { /* 無視 */ }
    }

    /// <summary>
    /// トリムプレビューエリアの安全な解除
    /// </summary>
    public static async Task UnregisterTrimPreviewAreaAsync(IJSRuntime jsRuntime)
    {
        try
        {
            await jsRuntime.InvokeVoidAsync("trimPreviewArea.unregister");
        }
        catch { /* 無視 */ }
    }
}