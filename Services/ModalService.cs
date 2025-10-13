using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace NoCloudPdf.Services
{
    public class ModalService
    {
        // show event: component subscribes to this
        public event Func<List<(string title, int pageIndex)>, Task>? OnShowBookmarkDialog;

        // 呼び出し側が await できるよう TaskCompletionSource を使う
        private TaskCompletionSource<List<int>?>? _tcs;

        public async Task<List<int>?> ShowBookmarkDialogAsync(List<(string title, int pageIndex)> items)
        {
            _tcs = new TaskCompletionSource<List<int>?>();
            var handler = OnShowBookmarkDialog;
            if (handler != null)
            {
                await handler(items); // component will render and wait for user
                return await _tcs.Task;
            }
            // no UI handler -> return null (no selection)
            return null;
        }

        // コンポーネントから結果を返す
        public void CloseBookmarkDialog(List<int>? result)
        {
            try { _tcs?.TrySetResult(result); } catch { }
        }
    }
}