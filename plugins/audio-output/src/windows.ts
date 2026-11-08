// Windows: list outputs and pick the default one through Core Audio, from PowerShell.
// IPolicyConfig is undocumented but stable since Windows 7; its unnamed members keep vtable slots.
const TYPES = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] public struct PropVariant { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PropertyKey k); int GetValue(ref PropertyKey k, out PropVariant v); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int OpenPropertyStore(int access, out IPropertyStore store); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); }
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int c); int Item(int i, out IMMDevice d); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig { int _0(); int _1(); int _2(); int _3(); int _4(); int _5(); int _6(); int _7(); int _8(); int _9(); int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role); }
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class CPolicyConfigClient { }
public static class TesselOutputs {
  static string Name(IMMDevice d) {
    IPropertyStore s; Marshal.ThrowExceptionForHR(d.OpenPropertyStore(0, out s));
    var k = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    PropVariant v; Marshal.ThrowExceptionForHR(s.GetValue(ref k, out v));
    return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
  }
  public static string List() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice def; e.GetDefaultAudioEndpoint(0, 1, out def); string defId = ""; if (def != null) def.GetId(out defId);
    IMMDeviceCollection c; Marshal.ThrowExceptionForHR(e.EnumAudioEndpoints(0, 1, out c));
    int n; c.GetCount(out n); var lines = new List<string>();
    for (int i = 0; i < n; i++) { IMMDevice d; c.Item(i, out d); string id; d.GetId(out id); lines.Add((id == defId ? "*" : " ") + Name(d) + "\\t" + id); }
    return string.Join("\\n", lines);
  }
  public static void Use(string id) {
    var p = (IPolicyConfig)new CPolicyConfigClient();
    for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(p.SetDefaultEndpoint(id, role));
  }
}
'@
`
export const listScript = `${TYPES}[TesselOutputs]::List()`
export const useScript = (id: string) => `${TYPES}[TesselOutputs]::Use('${id.replace(/'/g, "''")}')`
