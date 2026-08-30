$ErrorActionPreference = 'Stop'

# This helper intentionally emits metadata only. The Electron main process must
# run clipboard-source.ts before it reads image bytes from an accepted event.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace TaClipboardMonitor
{
    internal static class NativeMethods
    {
        internal const int WM_CLIPBOARDUPDATE = 0x031D;
        internal const int WM_KEYDOWN = 0x0100;
        internal const int WM_SYSKEYDOWN = 0x0104;
        internal const int WH_KEYBOARD_LL = 13;
        internal const uint WM_QUIT = 0x0012;
        internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool AddClipboardFormatListener(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

        [DllImport("user32.dll")]
        internal static extern uint GetClipboardSequenceNumber();

        [DllImport("user32.dll")]
        internal static extern IntPtr GetClipboardOwner();

        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

        [DllImport("user32.dll")]
        internal static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindowVisible(IntPtr hwnd);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        internal static extern int GetWindowLong(IntPtr hwnd, int index);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);

        [DllImport("user32.dll")]
        internal static extern short GetAsyncKeyState(int virtualKey);

        internal delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern IntPtr SetWindowsHookEx(int hookId, LowLevelKeyboardProc callback, IntPtr module, uint threadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool UnhookWindowsHookEx(IntPtr hook);

        [DllImport("user32.dll")]
        internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool QueryFullProcessImageName(
            IntPtr process,
            uint flags,
            StringBuilder executablePath,
            ref uint size);

        [DllImport("kernel32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll")]
        internal static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool OpenClipboard(IntPtr newOwner);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern uint EnumClipboardFormats(uint format);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern int GetClipboardFormatName(uint format, StringBuilder name, int maxCount);

        [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = true, CharSet = CharSet.Unicode)]
        internal static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid actionId, IntPtr trustData);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct LowLevelKeyboardInput
    {
        internal uint VirtualKey;
        internal uint ScanCode;
        internal uint Flags;
        internal uint Time;
        internal IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WinTrustFileInfo
    {
        internal uint cbStruct;
        internal IntPtr pcwszFilePath;
        internal IntPtr hFile;
        internal IntPtr pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WinTrustData
    {
        internal uint cbStruct;
        internal IntPtr pPolicyCallbackData;
        internal IntPtr pSIPClientData;
        internal uint dwUIChoice;
        internal uint fdwRevocationChecks;
        internal uint dwUnionChoice;
        internal IntPtr pFile;
        internal uint dwStateAction;
        internal IntPtr hWVTStateData;
        internal IntPtr pwszURLReference;
        internal uint dwProvFlags;
        internal uint dwUIContext;
    }

    internal sealed class SignatureSummary
    {
        internal string Status;
        internal string Signer;
        internal string Subject;
        internal string Thumbprint;
    }

    internal static class SignatureInspector
    {
        private static readonly Guid GenericVerifyV2 =
            new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        internal static SignatureSummary Inspect(string executablePath)
        {
            if (String.IsNullOrWhiteSpace(executablePath) || !File.Exists(executablePath))
            {
                return new SignatureSummary { Status = "Unavailable" };
            }

            // Clipboard changes are infrequent enough to verify every event. Avoiding
            // a path/mtime cache prevents stale trust from being reused after replacement.
            return Verify(executablePath);
        }

        private static SignatureSummary Verify(string executablePath)
        {
            SignatureSummary summary = new SignatureSummary { Status = "NotSigned" };
            IntPtr pathPointer = IntPtr.Zero;
            IntPtr filePointer = IntPtr.Zero;
            IntPtr dataPointer = IntPtr.Zero;
            try
            {
                pathPointer = Marshal.StringToCoTaskMemUni(executablePath);
                WinTrustFileInfo fileInfo = new WinTrustFileInfo
                {
                    cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustFileInfo)),
                    pcwszFilePath = pathPointer,
                    hFile = IntPtr.Zero,
                    pgKnownSubject = IntPtr.Zero
                };
                filePointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WinTrustFileInfo)));
                Marshal.StructureToPtr(fileInfo, filePointer, false);

                WinTrustData data = new WinTrustData
                {
                    cbStruct = (uint)Marshal.SizeOf(typeof(WinTrustData)),
                    pPolicyCallbackData = IntPtr.Zero,
                    pSIPClientData = IntPtr.Zero,
                    dwUIChoice = 2, // WTD_UI_NONE
                    fdwRevocationChecks = 0, // WTD_REVOKE_NONE
                    dwUnionChoice = 1, // WTD_CHOICE_FILE
                    pFile = filePointer,
                    dwStateAction = 0, // WTD_STATEACTION_IGNORE
                    hWVTStateData = IntPtr.Zero,
                    pwszURLReference = IntPtr.Zero,
                    // Avoid a network call in a clipboard event handler.
                    dwProvFlags = 0x00000010 | 0x00001000,
                    dwUIContext = 0
                };
                dataPointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WinTrustData)));
                Marshal.StructureToPtr(data, dataPointer, false);

                int trustResult = NativeMethods.WinVerifyTrust(new IntPtr(-1), GenericVerifyV2, dataPointer);
                summary.Status = trustResult == 0 ? "Valid" : "Invalid";

                try
                {
                    X509Certificate certificate = X509Certificate.CreateFromSignedFile(executablePath);
                    X509Certificate2 certificate2 = new X509Certificate2(certificate);
                    try
                    {
                        summary.Signer = certificate2.GetNameInfo(X509NameType.SimpleName, false);
                        summary.Subject = certificate2.Subject;
                        summary.Thumbprint = certificate2.Thumbprint;
                    }
                    finally
                    {
                        certificate2.Reset();
                    }
                }
                catch (CryptographicException)
                {
                    summary.Status = "NotSigned";
                }
            }
            catch
            {
                summary.Status = "Unavailable";
            }
            finally
            {
                if (dataPointer != IntPtr.Zero) Marshal.FreeHGlobal(dataPointer);
                if (filePointer != IntPtr.Zero) Marshal.FreeHGlobal(filePointer);
                if (pathPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pathPointer);
            }
            return summary;
        }
    }

    internal sealed class ProcessSummary
    {
        internal string ExecutablePath;
        internal string Product;
        internal string Company;
        internal SignatureSummary Signature = new SignatureSummary { Status = "Unavailable" };
    }

    internal static class ProcessInspector
    {
        internal static string GetExecutablePath(uint processId)
        {
            if (processId == 0) return null;
            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                processId);
            if (process == IntPtr.Zero) return null;
            try
            {
                uint capacity = 32768;
                StringBuilder executablePath = new StringBuilder((int)capacity);
                return NativeMethods.QueryFullProcessImageName(process, 0, executablePath, ref capacity)
                    ? executablePath.ToString()
                    : null;
            }
            finally
            {
                NativeMethods.CloseHandle(process);
            }
        }

        internal static ProcessSummary Inspect(uint processId)
        {
            ProcessSummary result = new ProcessSummary();
            if (processId == 0) return result;

            IntPtr process = NativeMethods.OpenProcess(
                NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                processId);
            if (process == IntPtr.Zero) return result;
            try
            {
                uint capacity = 32768;
                StringBuilder path = new StringBuilder((int)capacity);
                if (!NativeMethods.QueryFullProcessImageName(process, 0, path, ref capacity)) return result;
                result.ExecutablePath = path.ToString();

                try
                {
                    FileVersionInfo version = FileVersionInfo.GetVersionInfo(result.ExecutablePath);
                    result.Product = version.ProductName;
                    result.Company = version.CompanyName;
                }
                catch
                {
                    // The full path is still useful even if version metadata is unavailable.
                }
                result.Signature = SignatureInspector.Inspect(result.ExecutablePath);

                uint finalCapacity = 32768;
                StringBuilder finalPath = new StringBuilder((int)finalCapacity);
                if (!NativeMethods.QueryFullProcessImageName(process, 0, finalPath, ref finalCapacity) ||
                    !String.Equals(result.ExecutablePath, finalPath.ToString(), StringComparison.OrdinalIgnoreCase))
                {
                    return new ProcessSummary();
                }
                return result;
            }
            finally
            {
                // Keeping the live process handle until after verification also keeps the
                // executable identity tied to the owner PID throughout this inspection.
                NativeMethods.CloseHandle(process);
            }
        }
    }

    internal static class CaptureIntentTracker
    {
        private static readonly object Gate = new object();
        private static string activeApp;
        private static DateTime activeUntilUtc;
        private static string boundApp;
        private static uint boundSequence;
        private static int pendingGeneration;
        private static IntPtr activeCaptureWindow;
        private static DateTime activeCaptureClosedUtc;
        private static uint activeCaptureProcessId;
        private static string activeCaptureExecutablePath;
        private static uint sequenceBeforeCapture;

        private static bool LooksLikeCaptureSurface(IntPtr window)
        {
            NativeRect rect;
            if (!NativeMethods.GetWindowRect(window, out rect)) return false;
            Screen screen = Screen.FromHandle(window);
            int width = Math.Max(0, rect.Right - rect.Left);
            int height = Math.Max(0, rect.Bottom - rect.Top);
            int style = NativeMethods.GetWindowLong(window, -16);
            bool borderlessPopup = (style & unchecked((int)0x80000000)) != 0 && (style & 0x00C00000) == 0;
            // Feishu's native capture surface covers most of one display. This
            // borderless-popup check also excludes maximized ordinary windows.
            return borderlessPopup && width >= Math.Max(640, (int)Math.Round(screen.Bounds.Width * 0.70)) &&
                height >= Math.Max(420, (int)Math.Round(screen.Bounds.Height * 0.70));
        }

        internal static void RecordAfterForegroundWindowChanges(IntPtr originalWindow, string app)
        {
            int generation;
            lock (Gate)
            {
                generation = ++pendingGeneration;
            }
            ThreadPool.QueueUserWorkItem(delegate
            {
                for (int attempt = 0; attempt < 30; attempt++)
                {
                    Thread.Sleep(50);
                    lock (Gate) { if (generation != pendingGeneration) return; }
                    IntPtr currentWindow = NativeMethods.GetForegroundWindow();
                    if (currentWindow == IntPtr.Zero || currentWindow == originalWindow) continue;
                    uint currentProcess = 0;
                    NativeMethods.GetWindowThreadProcessId(currentWindow, out currentProcess);
                    string currentPath = ProcessInspector.GetExecutablePath(currentProcess);
                    string currentName = Path.GetFileName(currentPath ?? String.Empty);
                    bool sameCaptureApp = String.Equals(app, "feishu", StringComparison.Ordinal) &&
                        String.Equals(currentName, "Feishu.exe", StringComparison.OrdinalIgnoreCase);
                    bool topmost = (NativeMethods.GetWindowLong(currentWindow, -20) & 0x00000008) != 0;
                    if (!sameCaptureApp || !topmost || !NativeMethods.IsWindowVisible(currentWindow) || !LooksLikeCaptureSurface(currentWindow)) return;
                    lock (Gate)
                    {
                        if (generation != pendingGeneration) return;
                        activeApp = app;
                        activeUntilUtc = DateTime.UtcNow.AddMinutes(5);
                        activeCaptureWindow = currentWindow;
                        activeCaptureClosedUtc = DateTime.MinValue;
                        activeCaptureProcessId = currentProcess;
                        activeCaptureExecutablePath = currentPath;
                        sequenceBeforeCapture = NativeMethods.GetClipboardSequenceNumber();
                    }
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        while (true)
                        {
                            Thread.Sleep(50);
                            lock (Gate)
                            {
                                if (generation != pendingGeneration || activeCaptureWindow == IntPtr.Zero) return;
                                if (!NativeMethods.IsWindow(activeCaptureWindow) || !NativeMethods.IsWindowVisible(activeCaptureWindow))
                                {
                                    activeCaptureClosedUtc = DateTime.UtcNow;
                                    activeCaptureWindow = IntPtr.Zero;
                                    return;
                                }
                            }
                        }
                    });
                    return;
                }
            });
        }

        internal static void Cancel()
        {
            lock (Gate)
            {
                activeApp = null;
                activeUntilUtc = DateTime.MinValue;
                pendingGeneration += 1;
                activeCaptureWindow = IntPtr.Zero;
                activeCaptureClosedUtc = DateTime.MinValue;
                activeCaptureProcessId = 0;
                activeCaptureExecutablePath = null;
                sequenceBeforeCapture = 0;
            }
        }

        private static bool OwnerMatches(string app, uint ownerProcessId, string executablePath)
        {
            string name = Path.GetFileName(executablePath ?? String.Empty);
            if (String.Equals(app, "feishu", StringComparison.Ordinal))
                return ownerProcessId != 0 && ownerProcessId == activeCaptureProcessId &&
                    String.Equals(name, "Feishu.exe", StringComparison.OrdinalIgnoreCase) &&
                    String.Equals(executablePath, activeCaptureExecutablePath, StringComparison.OrdinalIgnoreCase);
            return false;
        }

        internal static string ForClipboard(uint sequence, uint ownerProcessId, string executablePath, bool imagePresent, bool mayBind)
        {
            lock (Gate)
            {
                if (boundSequence == sequence && !String.IsNullOrWhiteSpace(boundApp)) return boundApp;
                if (!mayBind || String.IsNullOrWhiteSpace(activeApp)) return null;
                if (!imagePresent)
                {
                    activeApp = null;
                    pendingGeneration += 1;
                    activeCaptureWindow = IntPtr.Zero;
                    return null;
                }
                if (DateTime.UtcNow > activeUntilUtc)
                {
                    activeApp = null;
                    return null;
                }
                if (sequence == sequenceBeforeCapture)
                {
                    activeApp = null;
                    pendingGeneration += 1;
                    return null;
                }
                bool captureWindowActive = activeCaptureWindow != IntPtr.Zero &&
                    NativeMethods.IsWindow(activeCaptureWindow) && NativeMethods.IsWindowVisible(activeCaptureWindow);
                bool justClosed = activeCaptureClosedUtc != DateTime.MinValue &&
                    DateTime.UtcNow - activeCaptureClosedUtc <= TimeSpan.FromSeconds(1);
                if (!captureWindowActive && !justClosed)
                {
                    activeApp = null;
                    pendingGeneration += 1;
                    return null;
                }
                if (!OwnerMatches(activeApp, ownerProcessId, executablePath)) return null;
                boundSequence = sequence;
                boundApp = activeApp;
                activeApp = null;
                pendingGeneration += 1;
                activeCaptureWindow = IntPtr.Zero;
                return boundApp;
            }
        }
    }

    internal sealed class CaptureHotkeyHook : IDisposable
    {
        private readonly NativeMethods.LowLevelKeyboardProc callback;
        private IntPtr hook;

        internal CaptureHotkeyHook()
        {
            callback = OnKeyboard;
            hook = NativeMethods.SetWindowsHookEx(NativeMethods.WH_KEYBOARD_LL, callback, IntPtr.Zero, 0);
            if (hook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWindowsHookEx failed");
        }

        private static bool IsPressed(int virtualKey)
        {
            return (NativeMethods.GetAsyncKeyState(virtualKey) & 0x8000) != 0;
        }

        private IntPtr OnKeyboard(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && (wParam.ToInt32() == NativeMethods.WM_KEYDOWN || wParam.ToInt32() == NativeMethods.WM_SYSKEYDOWN))
            {
                LowLevelKeyboardInput input = (LowLevelKeyboardInput)Marshal.PtrToStructure(lParam, typeof(LowLevelKeyboardInput));
                // Ignore LLKHF_LOWER_IL_INJECTED (0x02) and LLKHF_INJECTED
                // (0x10). Automation is not proof of a physical screenshot.
                if ((input.Flags & 0x12) != 0)
                    return NativeMethods.CallNextHookEx(hook, code, wParam, lParam);
                if (input.VirtualKey == 0x1B)
                {
                    CaptureIntentTracker.Cancel();
                }
                else if (input.VirtualKey == 0x41)
                {
                    bool control = IsPressed(0x11);
                    bool shift = IsPressed(0x10);
                    bool alt = IsPressed(0x12);
                    IntPtr foreground = NativeMethods.GetForegroundWindow();
                    uint foregroundProcess = 0;
                    if (foreground != IntPtr.Zero) NativeMethods.GetWindowThreadProcessId(foreground, out foregroundProcess);
                    string foregroundPath = ProcessInspector.GetExecutablePath(foregroundProcess);
                    string foregroundName = Path.GetFileName(foregroundPath ?? String.Empty);
                    if (control && shift && !alt)
                        CaptureIntentTracker.RecordAfterForegroundWindowChanges(foreground, "feishu");
                }
            }
            return NativeMethods.CallNextHookEx(hook, code, wParam, lParam);
        }

        public void Dispose()
        {
            if (hook != IntPtr.Zero)
            {
                NativeMethods.UnhookWindowsHookEx(hook);
                hook = IntPtr.Zero;
            }
        }
    }

    internal sealed class FormatSummary
    {
        internal readonly List<string> Formats = new List<string>();
        internal bool ImagePresent;
    }

    internal static class ClipboardInspector
    {
        private static readonly Dictionary<uint, string> StandardNames = new Dictionary<uint, string>
        {
            { 1, "CF_TEXT" }, { 2, "CF_BITMAP" }, { 3, "CF_METAFILEPICT" },
            { 4, "CF_SYLK" }, { 5, "CF_DIF" }, { 6, "CF_TIFF" },
            { 7, "CF_OEMTEXT" }, { 8, "CF_DIB" }, { 9, "CF_PALETTE" },
            { 10, "CF_PENDATA" }, { 11, "CF_RIFF" }, { 12, "CF_WAVE" },
            { 13, "CF_UNICODETEXT" }, { 14, "CF_ENHMETAFILE" },
            { 15, "CF_HDROP" }, { 16, "CF_LOCALE" }, { 17, "CF_DIBV5" }
        };

        internal static FormatSummary Inspect(IntPtr monitorWindow)
        {
            FormatSummary result = new FormatSummary();
            bool opened = false;
            for (int attempt = 0; attempt < 5 && !opened; attempt++)
            {
                opened = NativeMethods.OpenClipboard(monitorWindow);
                if (!opened) Thread.Sleep(10);
            }
            if (!opened) return result;

            try
            {
                uint current = 0;
                while ((current = NativeMethods.EnumClipboardFormats(current)) != 0)
                {
                    string name;
                    if (!StandardNames.TryGetValue(current, out name))
                    {
                        StringBuilder registeredName = new StringBuilder(512);
                        int count = NativeMethods.GetClipboardFormatName(current, registeredName, registeredName.Capacity);
                        name = count > 0 ? registeredName.ToString() : "FORMAT_" + current.ToString(CultureInfo.InvariantCulture);
                    }
                    result.Formats.Add(name);
                    if (current == 2 || current == 6 || current == 8 || current == 17 || IsRegisteredImageFormat(name))
                    {
                        result.ImagePresent = true;
                    }
                }
            }
            finally
            {
                NativeMethods.CloseClipboard();
            }
            return result;
        }

        private static bool IsRegisteredImageFormat(string name)
        {
            if (String.IsNullOrWhiteSpace(name)) return false;
            string normalized = name.Trim().ToLowerInvariant();
            return normalized.StartsWith("image/", StringComparison.Ordinal) ||
                normalized == "png" || normalized == "jfif" || normalized == "gif";
        }
    }

    internal static class Json
    {
        internal static string String(string value)
        {
            if (value == null) return "null";
            StringBuilder result = new StringBuilder(value.Length + 2);
            result.Append('"');
            foreach (char character in value)
            {
                switch (character)
                {
                    case '"': result.Append("\\\""); break;
                    case '\\': result.Append("\\\\"); break;
                    case '\b': result.Append("\\b"); break;
                    case '\f': result.Append("\\f"); break;
                    case '\n': result.Append("\\n"); break;
                    case '\r': result.Append("\\r"); break;
                    case '\t': result.Append("\\t"); break;
                    default:
                        if (character < 0x20)
                            result.Append("\\u" + ((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            result.Append(character);
                        break;
                }
            }
            result.Append('"');
            return result.ToString();
        }

        internal static string Array(IEnumerable<string> values)
        {
            StringBuilder result = new StringBuilder("[");
            bool first = true;
            foreach (string value in values)
            {
                if (!first) result.Append(',');
                result.Append(String(value));
                first = false;
            }
            result.Append(']');
            return result.ToString();
        }
    }

    internal static class EventWriter
    {
        internal static void Write(IntPtr monitorWindow, string requestId)
        {
            uint sequence = 0;
            IntPtr owner = IntPtr.Zero;
            uint processId = 0;
            ProcessSummary process = new ProcessSummary();
            FormatSummary formats = new FormatSummary();
            bool stable = false;
            for (int attempt = 0; attempt < 3 && !stable; attempt++)
            {
                sequence = NativeMethods.GetClipboardSequenceNumber();
                owner = NativeMethods.GetClipboardOwner();
                processId = 0;
                if (owner != IntPtr.Zero) NativeMethods.GetWindowThreadProcessId(owner, out processId);

                // Only metadata and format names are inspected here; no clipboard data handle is read.
                process = ProcessInspector.Inspect(processId);
                formats = ClipboardInspector.Inspect(monitorWindow);

                uint sequenceAfter = NativeMethods.GetClipboardSequenceNumber();
                IntPtr ownerAfter = NativeMethods.GetClipboardOwner();
                uint processIdAfter = 0;
                if (ownerAfter != IntPtr.Zero) NativeMethods.GetWindowThreadProcessId(ownerAfter, out processIdAfter);
                stable = sequence == sequenceAfter && owner == ownerAfter && processId == processIdAfter;
                if (!stable) Thread.Sleep(5);
            }
            SignatureSummary signature = process.Signature;
            string captureIntentApp = CaptureIntentTracker.ForClipboard(
                sequence,
                processId,
                process.ExecutablePath,
                formats.ImagePresent,
                String.IsNullOrWhiteSpace(requestId));
            string json = "{" +
                "\"type\":\"clipboard-update\"," +
                "\"requestId\":" + Json.String(requestId) + "," +
                "\"sequence\":" + sequence.ToString(CultureInfo.InvariantCulture) + "," +
                "\"stable\":" + (stable ? "true" : "false") + "," +
                "\"ownerPid\":" + (processId == 0 ? "null" : processId.ToString(CultureInfo.InvariantCulture)) + "," +
                "\"executablePath\":" + Json.String(process.ExecutablePath) + "," +
                "\"product\":" + Json.String(process.Product) + "," +
                "\"company\":" + Json.String(process.Company) + "," +
                "\"signer\":" + Json.String(signature.Signer) + "," +
                "\"signatureStatus\":" + Json.String(signature.Status) + "," +
                "\"signerSubject\":" + Json.String(signature.Subject) + "," +
                "\"signerThumbprint\":" + Json.String(signature.Thumbprint) + "," +
                "\"formats\":" + Json.Array(formats.Formats) + "," +
                "\"imagePresent\":" + (formats.ImagePresent ? "true" : "false") + "," +
                "\"captureIntentApp\":" + Json.String(captureIntentApp) + "," +
                "\"observedAt\":" + Json.String(DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture)) +
                "}";
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }

    internal sealed class MonitorWindow : NativeWindow, IDisposable
    {
        private bool listening;

        internal MonitorWindow()
        {
            CreateParams parameters = new CreateParams();
            parameters.Caption = "Ta Clipboard Monitor";
            parameters.X = -32000;
            parameters.Y = -32000;
            parameters.Width = 0;
            parameters.Height = 0;
            parameters.ExStyle = 0x00000080; // WS_EX_TOOLWINDOW
            CreateHandle(parameters);
            listening = NativeMethods.AddClipboardFormatListener(Handle);
            if (!listening)
            {
                int error = Marshal.GetLastWin32Error();
                DestroyHandle();
                throw new Win32Exception(error, "AddClipboardFormatListener failed");
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == NativeMethods.WM_CLIPBOARDUPDATE)
            {
                try
                {
                    EventWriter.Write(Handle, null);
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine("clipboard-monitor: " + error.GetType().Name + ": " + error.Message);
                }
            }
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            if (listening && Handle != IntPtr.Zero)
            {
                NativeMethods.RemoveClipboardFormatListener(Handle);
                listening = false;
            }
            if (Handle != IntPtr.Zero) DestroyHandle();
        }
    }

    public static class Program
    {
        public static void Run()
        {
            uint messageThreadId = NativeMethods.GetCurrentThreadId();
            using (CaptureHotkeyHook hotkeys = new CaptureHotkeyHook())
            using (MonitorWindow monitor = new MonitorWindow())
            {
                Thread inputThread = new Thread(delegate()
                {
                    try
                    {
                        string line;
                        while ((line = Console.In.ReadLine()) != null)
                        {
                            string command = line.Trim();
                            if (String.Equals(command, "exit", StringComparison.OrdinalIgnoreCase)) break;
                            if (command.StartsWith("inspect ", StringComparison.OrdinalIgnoreCase))
                            {
                                string requestId = command.Substring(8).Trim();
                                if (!String.IsNullOrWhiteSpace(requestId))
                                {
                                    try { EventWriter.Write(monitor.Handle, requestId); }
                                    catch (Exception error) { Console.Error.WriteLine("clipboard-inspect: " + error.Message); }
                                }
                            }
                        }
                    }
                    catch
                    {
                        // A closed stdin means the owning Electron process is gone.
                    }
                    NativeMethods.PostThreadMessage(messageThreadId, NativeMethods.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                });
                inputThread.IsBackground = true;
                inputThread.Name = "TaClipboardMonitorInput";
                inputThread.Start();
                Application.Run();
            }
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing')
[TaClipboardMonitor.Program]::Run()
