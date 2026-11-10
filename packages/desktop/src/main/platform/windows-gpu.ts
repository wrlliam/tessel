// Graphics card readings on Windows from one long-running PowerShell, so the counters and the
// compiled helper below are set up once instead of every second.
//
// Temperature comes from the driver's adapter performance data (D3DKMTQueryAdapterInfo with
// KMTQAITYPE_ADAPTERPERFDATA, WDDM 2.4+), the same source as Task Manager's "GPU temperature".
// It works for AMD, NVIDIA and Intel cards without admin rights or vendor tools.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { GpuReading } from './stats.ts'

/** C# loaded with Add-Type. Exported so a test can compile it. */
export const GPU_HELPER_CS = String.raw`
using System;
using System.Runtime.InteropServices;

public static class TesselGpu
{
    [StructLayout(LayoutKind.Sequential)]
    struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    struct ADAPTERINFO { public uint hAdapter; public LUID AdapterLuid; public uint NumOfSources; public int bPrecisePresentRegionsPreferred; }

    [StructLayout(LayoutKind.Sequential)]
    struct ENUMADAPTERS2 { public uint NumAdapters; public IntPtr pAdapters; }

    [StructLayout(LayoutKind.Sequential)]
    struct QUERYADAPTERINFO { public uint hAdapter; public int Type; public IntPtr pPrivateDriverData; public uint PrivateDriverDataSize; }

    [StructLayout(LayoutKind.Sequential)]
    struct ADAPTER_PERFDATA
    {
        public uint PhysicalAdapterIndex;
        public ulong MemoryFrequency;
        public ulong MaxMemoryFrequency;
        public ulong MaxMemoryFrequencyOC;
        public ulong MemoryBandwidth;
        public ulong PCIEBandwidth;
        public uint FanRPM;
        public uint Power;
        public uint Temperature;
        public byte PowerStateOverride;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct CLOSEADAPTER { public uint hAdapter; }

    [DllImport("gdi32.dll")] static extern int D3DKMTEnumAdapters2(ref ENUMADAPTERS2 data);
    [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref QUERYADAPTERINFO data);
    [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref CLOSEADAPTER data);

    const int KMTQAITYPE_ADAPTERPERFDATA = 62;

    /// Hottest graphics card in degrees Celsius, or -1 when no driver reports one.
    public static double MaxTemperature()
    {
        var list = new ENUMADAPTERS2();
        if (D3DKMTEnumAdapters2(ref list) != 0 || list.NumAdapters == 0) return -1;
        int infoSize = Marshal.SizeOf(typeof(ADAPTERINFO));
        IntPtr infos = Marshal.AllocHGlobal(infoSize * (int)list.NumAdapters);
        double best = -1;
        try
        {
            list.pAdapters = infos;
            if (D3DKMTEnumAdapters2(ref list) != 0) return -1;
            int perfSize = Marshal.SizeOf(typeof(ADAPTER_PERFDATA));
            for (int i = 0; i < list.NumAdapters; i++)
            {
                var info = (ADAPTERINFO)Marshal.PtrToStructure(IntPtr.Add(infos, i * infoSize), typeof(ADAPTERINFO));
                IntPtr perf = Marshal.AllocHGlobal(perfSize);
                try
                {
                    Marshal.StructureToPtr(new ADAPTER_PERFDATA(), perf, false);
                    var query = new QUERYADAPTERINFO();
                    query.hAdapter = info.hAdapter;
                    query.Type = KMTQAITYPE_ADAPTERPERFDATA;
                    query.pPrivateDriverData = perf;
                    query.PrivateDriverDataSize = (uint)perfSize;
                    if (D3DKMTQueryAdapterInfo(ref query) == 0)
                    {
                        var data = (ADAPTER_PERFDATA)Marshal.PtrToStructure(perf, typeof(ADAPTER_PERFDATA));
                        // Tenths of a degree; 0 means this adapter doesn't report it.
                        if (data.Temperature > 0 && data.Temperature < 1500)
                            best = Math.Max(best, data.Temperature / 10.0);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(perf);
                    var close = new CLOSEADAPTER();
                    close.hAdapter = info.hAdapter;
                    D3DKMTCloseAdapter(ref close);
                }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(infos);
        }
        return best;
    }
}
`

/** The loop: one JSON line per reading, until Tessel quits. */
export function readerScript(parentPid: number): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -TypeDefinition @'",
    GPU_HELPER_CS.trim(),
    "'@",
    `$parent = ${Math.trunc(parentPid)}`,
    "$paths = @('\\GPU Engine(*engtype_3D)\\Utilization Percentage', '\\GPU Adapter Memory(*)\\Dedicated Usage')",
    'while ($true) {',
    '  if (-not (Get-Process -Id $parent)) { exit }',
    '  $gpu = $null; $mem = $null; $temp = $null',
    '  $samples = (Get-Counter -Counter $paths).CounterSamples',
    '  if ($samples) {',
    "    $gpu = ($samples | Where-Object { $_.Path -like '*utilization percentage' } | Measure-Object -Property CookedValue -Sum).Sum",
    "    $mem = ($samples | Where-Object { $_.Path -like '*dedicated usage' } | Measure-Object -Property CookedValue -Sum).Sum",
    '  }',
    '  try { $t = [TesselGpu]::MaxTemperature(); if ($t -ge 0) { $temp = $t } } catch {}',
    '  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ gpu = $gpu; memBytes = $mem; temp = $temp }))',
    '  [Console]::Out.Flush()',
    '  Start-Sleep -Milliseconds 500',
    '}',
  ].join('\n')
}

/** One line from the loop. Missing or broken values are left out. */
export function parseReaderLine(line: string): GpuReading | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const r: GpuReading = {}
  const gpu = n(o['gpu'])
  const mem = n(o['memBytes'])
  const temp = n(o['temp'])
  // Engines can add up past 100 on busy multi-engine cards; Task Manager caps it too.
  if (gpu !== undefined) r.gpu = Math.min(100, Math.max(0, gpu))
  if (mem !== undefined && mem > 0) r.gpuMemoryUsedGb = mem / 1024 ** 3
  if (temp !== undefined && temp > 0) r.gpuTemp = temp
  return Object.keys(r).length > 0 ? r : undefined
}

/**
 * Starts the loop on first use and keeps its latest reading. Restarts it if it dies, at most
 * three times; it also exits by itself when Tessel does.
 */
export function windowsGpuReader(start = spawn) {
  let last: GpuReading | undefined
  let running = false
  let starts = 0
  let first: Promise<void> | undefined

  function launch() {
    running = true
    starts++
    const script = Buffer.from(readerScript(process.pid), 'utf16le').toString('base64')
    const child = start(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const kill = () => child.kill()
    process.once('exit', kill)
    first = new Promise<void>((resolve) => {
      if (!child.stdout) return resolve()
      createInterface({ input: child.stdout }).on('line', (line) => {
        last = parseReaderLine(line)
        resolve()
      })
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })
    child.once('exit', () => {
      running = false
      last = undefined
      process.removeListener('exit', kill)
    })
    child.once('error', () => {
      running = false
    })
  }

  return async (): Promise<GpuReading | undefined> => {
    if (!running && starts < 3) launch()
    // The first reading takes a moment (compiling the helper, sampling counters); wait a little.
    if (first) {
      const waiting = first
      first = undefined
      await Promise.race([waiting, new Promise((r) => setTimeout(r, 5000))])
    }
    return last
  }
}
