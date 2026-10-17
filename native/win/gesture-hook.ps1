# IVE — Windows gesture hook
#
# Plays the role of the Swift fn-listener on macOS:
#   hold Ctrl + Alt, then right-drag anywhere.
#
# A low-level WH_MOUSE_LL hook swallows right-button events while the combo is
# held (so no context menu appears) and streams newline-delimited JSON to IVE:
#
#   {"t":"ready","trusted":true}
#   {"t":"fn","down":true,"x":800,"y":420}
#   {"t":"right","down":true,"x":800,"y":420}
#   {"t":"right","drag":true,"x":910,"y":470}
#   {"t":"right","down":false,"x":910,"y":470}
#
# Run by IVE automatically:  powershell -NoProfile -ExecutionPolicy Bypass -File gesture-hook.ps1
# No admin rights required.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class IveGestureHook
{
    public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);

    const int WH_MOUSE_LL = 14;
    const int WM_MOUSEMOVE = 0x0200;
    const int WM_RBUTTONDOWN = 0x0204;
    const int WM_RBUTTONUP = 0x0205;
    const int VK_CONTROL = 0x11;
    const int VK_MENU = 0x12;

    static LowLevelMouseProc _proc;
    static IntPtr _hook = IntPtr.Zero;
    static bool _dragging = false;
    static bool _comboWasDown = false;
    public static bool Suppress = true;

    static bool ComboDown()
    {
        return (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 && (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
    }

    static void Emit(string json)
    {
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }

    static string Right(bool down, int x, int y)
    {
        return "{\"t\":\"right\",\"down\":" + (down ? "true" : "false") + ",\"x\":" + x + ",\"y\":" + y + "}";
    }

    static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            MSLLHOOKSTRUCT info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            int msg = wParam.ToInt32();
            bool combo = ComboDown();

            if (combo != _comboWasDown)
            {
                _comboWasDown = combo;
                Emit("{\"t\":\"fn\",\"down\":" + (combo ? "true" : "false") + ",\"x\":" + info.pt.X + ",\"y\":" + info.pt.Y + "}");
            }

            if (msg == WM_RBUTTONDOWN && combo)
            {
                _dragging = true;
                Emit(Right(true, info.pt.X, info.pt.Y));
                if (Suppress) return (IntPtr)1;
            }
            else if (msg == WM_MOUSEMOVE && _dragging)
            {
                Emit("{\"t\":\"right\",\"drag\":true,\"x\":" + info.pt.X + ",\"y\":" + info.pt.Y + "}");
                if (Suppress) return (IntPtr)1;
            }
            else if (msg == WM_RBUTTONUP && _dragging)
            {
                _dragging = false;
                Emit(Right(false, info.pt.X, info.pt.Y));
                if (Suppress) return (IntPtr)1;
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static void Start()
    {
        _proc = Callback;
        _hook = SetWindowsHookEx(WH_MOUSE_LL, _proc, GetModuleHandle(null), 0);
        if (_hook == IntPtr.Zero)
        {
            int err = Marshal.GetLastWin32Error();
            Emit("{\"t\":\"permission\",\"accessibility\":false,\"error\":\"SetWindowsHookEx failed: " + err + "\"}");
            throw new Exception("SetWindowsHookEx failed: " + err);
        }
    }
}
"@

try {
    [IveGestureHook]::Start()
    '{"t":"ready","trusted":true}'
    [Console]::Out.Flush()
} catch {
    '{"t":"permission","accessibility":false,"error":"' + ($_.Exception.Message -replace '"','') + '"}'
    exit 2
}

Add-Type -AssemblyName System.Windows.Forms
while ($true) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 12
}
