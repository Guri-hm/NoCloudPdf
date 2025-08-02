public class CompletionStateService
{
    public bool ShowSplitOrExtractResult { get; set; }
    public bool ShowMergedResult { get; set; }

    public enum CompletionType
    {
        None,
        SplitOrExtract,
        Merged,
    }

    public CompletionType Current { get; private set; } = CompletionType.None;

    public void SetCompletion(CompletionType type)
    {
        // すべてfalseに
        ShowSplitOrExtractResult = false;
        ShowMergedResult = false;

        // 指定されたものだけtrueに
        switch (type)
        {
            case CompletionType.SplitOrExtract:
                ShowSplitOrExtractResult = true;
                break;
            case CompletionType.Merged:
                ShowMergedResult = true;
                break;
            case CompletionType.None:
            default:
                break;
        }
        Current = type;
    }

    public void ResetAll()
    {
        ShowSplitOrExtractResult = false;
        ShowMergedResult = false;
    }
}