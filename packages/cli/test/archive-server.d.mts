export interface ArchiveFault {
  start: number;
  end: number;
  /** '404', 'reset', 'short' or 'corrupt' */
  kind: string;
  times?: number;
}
export interface ArchiveRequest {
  start: number;
  end: number;
  status: number;
  t0: number;
  t1: number;
  sent: number;
  fault: string | null;
}
export interface ArchiveStats {
  requests: number;
  ranges: number;
  whole: number;
  bytesSent: number;
  open: number;
  peak: number;
  log: ArchiveRequest[];
}
export interface ArchiveServerOptions {
  bytes: Buffer;
  mbps?: number;
  faults?: ArchiveFault[];
  cut?: { afterMs: number; forMs: number } | null;
  path?: string;
  chunk?: number;
}
export function startArchiveServer(
  opts: ArchiveServerOptions,
): Promise<{ url: string; stats: ArchiveStats; close: () => Promise<void> }>;
export function storedZip(files: [string, Buffer][]): Buffer;
export function pinFor(
  bytes: Buffer,
  version?: number,
): Promise<{
  version: number;
  sha256: string;
  size: number;
  files: [string, number, number, number, number, string][];
}>;
