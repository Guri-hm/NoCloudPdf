public class CompletionStateService
{
    public bool ShowSplitResult { get; set; }
    public bool ShowMergedResult { get; set; }

    public enum CompletionType
    {
        None,
        Split,
        Merged
    }

    public CompletionType Current { get; private set; } = CompletionType.None;

    public void SetCompletion(CompletionType type)
    {
        // すべてfalseに
        ShowSplitResult = false;
        ShowMergedResult = false;

        // 指定されたものだけtrueに
        switch (type)
        {
            case CompletionType.Split:
                ShowSplitResult = true;
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
        ShowSplitResult = false;
        ShowMergedResult = false;
    }
}