// Windows has no command-line volume control, so talk to Core Audio from PowerShell.
// Interface layouts follow the Windows SDK (endpointvolume.h, mmdeviceapi.h); the
// unnamed members are placeholders that keep the vtable slots in order.
const AUDIO_TYPE = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3();
  int SetMasterVolumeLevelScalar(float level, Guid context);
  int _5();
  int GetMasterVolumeLevelScalar(out float level);
  int _7(); int _8(); int _9(); int _10();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
  int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class TesselAudio {
  static IAudioEndpointVolume Endpoint() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    var id = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static void SetVolume(float v) { Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(v, Guid.Empty)); }
  public static float GetVolume() { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, Guid.Empty)); }
}
'@
`

export const volumeScript = (level: number) =>
  `${AUDIO_TYPE}[TesselAudio]::SetVolume(${(Math.round(level) / 100).toFixed(2)})`

export const muteScript = (on: boolean | 'toggle') =>
  `${AUDIO_TYPE}[TesselAudio]::SetMute(${on === 'toggle' ? '-not [TesselAudio]::GetMute()' : on ? '$true' : '$false'})`

/** Prints "42,False". */
export const readVolumeScript = `${AUDIO_TYPE}'{0},{1}' -f [math]::Round([TesselAudio]::GetVolume() * 100), [TesselAudio]::GetMute()`
