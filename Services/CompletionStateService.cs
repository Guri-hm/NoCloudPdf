public class CompletionStateService
{
    // 結果を表示するかどうか（Merge/Splitの区別は不要）
    public bool ShowResult { get; private set; } = false;

    // 結果表示を設定
    public void SetShowResult(bool show)
    {
        ShowResult = show;
    }

    // すべてリセット（結果非表示）
    public void Reset()
    {
        ShowResult = false;
    }
}