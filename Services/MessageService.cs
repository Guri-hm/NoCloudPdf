using Microsoft.JSInterop;

namespace NoCloudPdf.Services;

public class MessageService
{
    private readonly IJSRuntime _jsRuntime;

    public MessageService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    public async Task ShowAsync(string? text, MessageType type = MessageType.Success, int autoCloseMs = 3000)
    {
        if (string.IsNullOrEmpty(text)) return;

        try
        {
            var typeStr = type switch
            {
                MessageType.Success => "success",
                MessageType.Warn => "warn",
                MessageType.Error => "error",
                _ => "success"
            };

            await _jsRuntime.InvokeVoidAsync("messageBar.show", text, typeStr, autoCloseMs);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"MessageService.ShowAsync error: {ex.Message}");
        }
    }

    public async Task HideAsync()
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("messageBar.hide");
        }
        catch { }
    }
    
    public async Task ShowLoadingAsync(string message = "処理中です...")
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("loadingOverlay.show", message);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"MessageService.ShowLoadingAsync error: {ex.Message}");
        }
    }

    public async Task HideLoadingAsync()
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("loadingOverlay.hide");
        }
        catch { }
    }
}

public enum MessageType
{
    Success,
    Warn,
    Error
}