using System.Threading.Tasks;
using Microsoft.JSInterop;
using ClientPdfApp.Pages;

namespace ClientPdfApp.Services
{
    /// <summary>
    /// JS連携用の共通サービス
    /// </summary>
    public static class PdfInteropService
    {
        /// <summary>
        /// JSから呼び出される並び替え処理
        /// </summary>
        [JSInvokable("UpdateOrder")]
        public static async Task UpdateOrder(string pageType, int oldIndex, int newIndex)
        {
            // ページタイプで分岐して各ページのインスタンスに処理を委譲
            if (pageType == "split" && Split._currentInstance != null)
            {
                await Split._currentInstance.UpdateOrderInternal(pageType, oldIndex, newIndex);
            }
            else if (pageType == "merge" && Merge._currentInstance != null)
        {
                await Merge._currentInstance.UpdateOrderInternal(pageType, oldIndex, newIndex);
            }
        }

        /// <summary>
        /// JSから呼び出される空白ページ挿入
        /// </summary>
        [JSInvokable("InsertBlankPageFromJS")]
        public static Task InsertBlankPageFromJS(string pageType, int position)
        {
            if (pageType == "split" && Split._currentInstance != null)
            {
                return Split._currentInstance.InsertBlankPage(position);
            }
            else if (pageType == "merge" && Merge._currentInstance != null)
            {
                return Merge._currentInstance.InsertBlankPage(position);
            }
            return Task.CompletedTask;
        }

        /// <summary>
        /// JSから呼び出されるPDF挿入
        /// </summary>
        [JSInvokable("InsertPdfAtPositionFromJS")]
        public static async Task InsertPdfAtPositionFromJS(string pageType, int position)
        {
            if (pageType == "split" && Split._currentInstance != null)
            {
                await Split._currentInstance.InsertPdfAtPosition(position);
            }
            else if (pageType == "merge" && Merge._currentInstance != null)
            {
                await Merge._currentInstance.InsertPdfAtPosition(position);
            }
        }
    }
}