using NoCloudPdf.Services;
public static class AppResetHelper
{
    public static void ResetPage(
        PdfDataService pdfDataService,
        Action resetPageState,  // ページ固有の状態リセット
        Action resetResultState,// 結果表示用の状態リセット
        Action<string?> setErrorMessage,
        Action stateHasChanged)
    {
        pdfDataService.Clear();
        resetPageState();
        resetResultState();
        setErrorMessage(null);
        stateHasChanged();
    }
}