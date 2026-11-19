import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import type { LookupAddress } from 'node:dns';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

export interface ValidatedImagePayload {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export type ExternalImageFetcher = (rawUrl: string) => Promise<ValidatedImagePayload>;

export type DnsLookupAllFn = (hostname: string) => Promise<LookupAddress[]>;

export interface FetchExternalImageOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  lookupAll?: DnsLookupAllFn;
}

export class ExternalImageError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'INVALID_IMAGE_URL') {
    super(message);
    this.name = 'ExternalImageError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Inspects leading magic bytes so file type validation never trusts remote
 * Content-Type headers or URL extensions. Only PNG, JPEG, WEBP, and GIF pass.
 */
export function detectImageFormat(
  buffer: Buffer
): { contentType: string; extension: string } | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { contentType: 'image/png', extension: '.png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: '.jpg' };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { contentType: 'image/gif', extension: '.gif' };
  }

  // WEBP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { contentType: 'image/webp', extension: '.webp' };
  }

  return null;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0], nums[1], nums[2], nums[3]];
}

function isPrivateIpv4Octets(o: [number, number, number, number]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8 (this network)
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local & cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // 224.0.0.0/4 multicast & 240.0.0.0/4 reserved/broadcast
  return false;
}

function expandIpv6ToWords(ip: string): number[] | null {
  const zoneStripped = ip.split('%')[0].toLowerCase();
  let normalized = zoneStripped;

  // Handle IPv4-embedded tail (e.g. ::ffff:127.0.0.1)
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon !== -1 && normalized.slice(lastColon + 1).includes('.')) {
    const ipv4 = parseIpv4Octets(normalized.slice(lastColon + 1));
    if (!ipv4) return null;
    const hi = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const lo = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const sides = normalized.split('::');
  if (sides.length > 2) return null;

  const parseSide = (part: string): number[] | null => {
    if (!part) return [];
    const tokens = part.split(':');
    const out: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      out.push(parseInt(token, 16));
    }
    return out;
  };

  const left = parseSide(sides[0]);
  const right = sides.length === 2 ? parseSide(sides[1]) : [];
  if (!left || !right) return null;

  if (sides.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = ip.trim().replace(/^\[|\]$/g, '');
  const version = net.isIP(cleaned);
  if (version === 4) {
    const octets = parseIpv4Octets(cleaned);
    return octets ? isPrivateIpv4Octets(octets) : true;
  }
  if (version === 6) {
    const words = expandIpv6ToWords(cleaned);
    if (!words) return true;

    const allZero = words.every((w) => w === 0);
    if (allZero) return true; // :: unspecified

    const isLoopback = words.slice(0, 7).every((w) => w === 0) && words[7] === 1;
    if (isLoopback) return true; // ::1 loopback

    // IPv4-mapped (::ffff:0:0/96) or IPv4-compatible (::/96)
    const isIpv4Mapped =
      words[0] === 0 &&
      words[1] === 0 &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      words[5] === 0xffff;
    if (isIpv4Mapped) {
      return isPrivateIpv4Octets([
        words[6] >> 8,
        words[6] & 0xff,
        words[7] >> 8,
        words[7] & 0xff,
      ]);
    }

    // NAT64 well-known prefix 64:ff9b::/96
    const isNat64 =
      words[0] === 0x0064 &&
      words[1] === 0xff9b &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      words[5] === 0;
    if (isNat64) {
      return isPrivateIpv4Octets([
        words[6] >> 8,
        words[6] & 0xff,
        words[7] >> 8,
        words[7] & 0xff,
      ]);
    }

    if ((words[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((words[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true; // 2001:db8::/32 docs
    return false;
  }

  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export function parseAndValidateExternalUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2000) {
    throw new ExternalImageError(
      'Provide a valid external HTTPS image URL.',
      400,
      'INVALID_IMAGE_URL'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ExternalImageError(
      'Provide a valid external HTTPS image URL.',
      400,
      'INVALID_IMAGE_URL'
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new ExternalImageError(
      'Only public HTTPS image URLs are supported.',
      400,
      'INVALID_IMAGE_URL'
    );
  }

  if (parsed.username || parsed.password) {
    throw new ExternalImageError(
      'Image URLs with embedded credentials are not allowed.',
      400,
      'INVALID_IMAGE_URL'
    );
  }

  if (parsed.port && parsed.port !== '443') {
    throw new ExternalImageError(
      'External image URLs must use the standard HTTPS port (443).',
      400,
      'BLOCKED_IMAGE_HOST'
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) {
    throw new ExternalImageError(
      'Provide a valid external HTTPS image URL.',
      400,
      'INVALID_IMAGE_URL'
    );
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new ExternalImageError(
      'Private or internal image hosts are not allowed.',
      400,
      'BLOCKED_IMAGE_HOST'
    );
  }

  const strippedIp = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(strippedIp) !== 0 && isPrivateOrReservedIp(strippedIp)) {
    throw new ExternalImageError(
      'Private or reserved IP addresses are not allowed for image imports.',
      400,
      'BLOCKED_IMAGE_HOST'
    );
  }

  return parsed;
}

async function resolvePublicIp(
  hostname: string,
  lookupAll: DnsLookupAllFn
): Promise<LookupAddress> {
  const stripped = hostname.replace(/^\[|\]$/g, '');
  const literalVersion = net.isIP(stripped);
  if (literalVersion !== 0) {
    if (isPrivateOrReservedIp(stripped)) {
      throw new ExternalImageError(
        'Private or reserved IP addresses are not allowed for image imports.',
        400,
        'BLOCKED_IMAGE_HOST'
      );
    }
    return { address: stripped, family: literalVersion };
  }

  let records: LookupAddress[];
  try {
    records = await lookupAll(hostname);
  } catch {
    throw new ExternalImageError(
      'Unable to resolve the image URL hostname. Check the URL or upload the image file directly.',
      422,
      'IMAGE_DOWNLOAD_FAILED'
    );
  }

  if (!records || records.length === 0) {
    throw new ExternalImageError(
      'Unable to resolve the image URL hostname. Check the URL or upload the image file directly.',
      422,
      'IMAGE_DOWNLOAD_FAILED'
    );
  }

  // Block if ANY resolved address points to a private/reserved IP (defends against split-horizon / rebinding)
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new ExternalImageError(
        'The image URL resolves to a private or blocked network address.',
        400,
        'BLOCKED_IMAGE_HOST'
      );
    }
  }

  return records[0];
}

function isDisallowedDeclaredContentType(rawHeader: string | undefined): boolean {
  if (!rawHeader) return false;
  const mime = rawHeader.split(';')[0].trim().toLowerCase();
  if (!mime) return false;
  if (mime === 'image/svg+xml') return true;
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/xhtml+xml' || mime === 'application/xml' || mime === 'application/json') {
    return true;
  }
  return false;
}

async function defaultLookupAll(hostname: string): Promise<LookupAddress[]> {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

interface RawHopResult {
  statusCode: number;
  location?: string;
  contentType?: string;
  buffer?: Buffer;
}

function downloadPinnedHttps(
  url: URL,
  pinned: LookupAddress,
  maxBytes: number,
  remainingMs: number
): Promise<RawHopResult> {
  return new Promise<RawHopResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
        headers: {
          Host: url.host,
          'User-Agent': 'PostProofs-ImageImporter/1.0',
          Accept: 'image/png,image/jpeg,image/webp,image/gif,*/*;q=0.5',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, opts, callback) => {
          if (typeof opts === 'object' && opts && opts.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;

        // Handle redirects manually so every hop is re-validated against SSRF rules
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          finish(() =>
            resolve({
              statusCode,
              location: Array.isArray(res.headers.location)
                ? res.headers.location[0]
                : res.headers.location,
            })
          );
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          finish(() =>
            reject(
              new ExternalImageError(
                'Could not download the image from that URL (remote server returned an error). Try uploading the image file directly.',
                422,
                'IMAGE_DOWNLOAD_FAILED'
              )
            )
          );
          return;
        }

        const declaredType = Array.isArray(res.headers['content-type'])
          ? res.headers['content-type'][0]
          : res.headers['content-type'];
        if (isDisallowedDeclaredContentType(declaredType)) {
          res.destroy();
          finish(() =>
            reject(
              new ExternalImageError(
                'The URL does not point to a supported image. Use a direct PNG, JPEG, WEBP, or GIF image URL, or upload the file.',
                400,
                'UNSUPPORTED_IMAGE_TYPE'
              )
            )
          );
          return;
        }

        const contentLengthRaw = res.headers['content-length'];
        const contentLength =
          typeof contentLengthRaw === 'string' ? Number.parseInt(contentLengthRaw, 10) : NaN;
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          res.destroy();
          finish(() =>
            reject(
              new ExternalImageError(
                `Image exceeds the maximum allowed size of ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
                413,
                'IMAGE_TOO_LARGE'
              )
            )
          );
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        res.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > maxBytes) {
            res.destroy();
            req.destroy();
            finish(() =>
              reject(
                new ExternalImageError(
                  `Image exceeds the maximum allowed size of ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
                  413,
                  'IMAGE_TOO_LARGE'
                )
              )
            );
            return;
          }
          chunks.push(buf);
        });

        res.on('end', () => {
          finish(() =>
            resolve({
              statusCode,
              contentType: declaredType,
              buffer: Buffer.concat(chunks, total),
            })
          );
        });

        res.on('error', () => {
          finish(() =>
            reject(
              new ExternalImageError(
                'Image download was interrupted. Please try again or upload the file directly.',
                422,
                'IMAGE_DOWNLOAD_FAILED'
              )
            )
          );
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(() =>
        reject(
          new ExternalImageError(
            'Image download timed out. Try a faster host or upload the image file directly.',
            422,
            'IMAGE_DOWNLOAD_TIMEOUT'
          )
        )
      );
    }, Math.max(100, remainingMs));

    req.on('error', () => {
      finish(() =>
        reject(
          new ExternalImageError(
            'Unable to connect to the external image host. Check the URL or upload the image file directly.',
            422,
            'IMAGE_DOWNLOAD_FAILED'
          )
        )
      );
    });

    req.end();
  });
}

/**
 * Safely downloads an external HTTPS image with SSRF protection (pinned public IP
 * lookup, redirect re-validation, strict timeout, 5 MB streaming cap) and
 * authoritative magic-byte format detection.
 */
export async function fetchSafeExternalImage(
  rawUrl: string,
  options: FetchExternalImageOptions = {}
): Promise<ValidatedImagePayload> {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookupAll = options.lookupAll ?? defaultLookupAll;

  const deadline = Date.now() + timeoutMs;
  let currentUrl = parseAndValidateExternalUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new ExternalImageError(
        'Image download timed out. Try a faster host or upload the image file directly.',
        422,
        'IMAGE_DOWNLOAD_TIMEOUT'
      );
    }

    const pinned = await resolvePublicIp(currentUrl.hostname, lookupAll);
    const hopResult = await downloadPinnedHttps(currentUrl, pinned, maxBytes, remainingMs);

    if (hopResult.location) {
      if (hop >= maxRedirects) {
        throw new ExternalImageError(
          'Image URL redirected too many times. Use a direct image URL or upload the file.',
          422,
          'IMAGE_DOWNLOAD_FAILED'
        );
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(hopResult.location, currentUrl).toString();
      } catch {
        throw new ExternalImageError(
          'External image server returned an invalid redirect.',
          422,
          'IMAGE_DOWNLOAD_FAILED'
        );
      }
      currentUrl = parseAndValidateExternalUrl(nextUrl);
      continue;
    }

    const buffer = hopResult.buffer;
    if (!buffer || buffer.length === 0) {
      throw new ExternalImageError(
        'The remote image file was empty.',
        400,
        'UNSUPPORTED_IMAGE_TYPE'
      );
    }

    const detected = detectImageFormat(buffer);
    if (!detected) {
      throw new ExternalImageError(
        'Unsupported image file format. Only PNG, JPEG, WEBP, and GIF images are allowed.',
        400,
        'UNSUPPORTED_IMAGE_TYPE'
      );
    }

    return {
      buffer,
      contentType: detected.contentType,
      extension: detected.extension,
    };
  }

  throw new ExternalImageError(
    'Unable to import the external image.',
    422,
    'IMAGE_DOWNLOAD_FAILED'
  );
}
