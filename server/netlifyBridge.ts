import { IncomingMessage, ServerResponse } from 'node:http';
import type { OutgoingHttpHeaders } from 'node:http';
import { Socket } from 'node:net';
import type { Express } from 'express';

export interface BridgeContext {
  ip?: string;
}

function toNodeHeaders(request: Request, url: URL, bodyLength: number): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  if (!headers.host) {
    headers.host = url.host;
  }
  if (!headers['x-forwarded-proto']) {
    headers['x-forwarded-proto'] = url.protocol.replace(/:$/, '') || 'https';
  }
  if (bodyLength > 0 && !headers['content-length']) {
    headers['content-length'] = String(bodyLength);
  }
  return headers;
}

function toBufferChunk(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') return Buffer.from(chunk, encoding || 'utf8');
  return Buffer.alloc(0);
}

/**
 * Bridges a Web Fetch Request into an Express application while preserving
 * exact raw request bytes (Stripe signatures, multipart uploads) and binary
 * response payloads without spawning a listening TCP port.
 */
export async function handleExpressWebRequest(
  app: Express,
  request: Request,
  context: BridgeContext = {}
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const bodyBuffer =
    hasBody && request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);

  const socket = new Socket();
  if (context.ip) {
    Object.defineProperty(socket, 'remoteAddress', {
      value: context.ip,
      configurable: true,
    });
  }
  if (url.protocol === 'https:') {
    Object.defineProperty(socket, 'encrypted', {
      value: true,
      configurable: true,
    });
  }

  const nodeReq = new IncomingMessage(socket);
  nodeReq.method = method;
  nodeReq.url = `${url.pathname}${url.search}`;
  nodeReq.headers = toNodeHeaders(request, url, bodyBuffer.byteLength);

  // Feed body lazily when body-parser / multer actually begins reading (after async auth middleware)
  let bodyPushed = false;
  nodeReq._read = () => {
    if (bodyPushed) return;
    bodyPushed = true;
    if (bodyBuffer.byteLength > 0) {
      nodeReq.push(bodyBuffer);
    }
    nodeReq.complete = true;
    nodeReq.push(null);
  };

  return await new Promise<Response>((resolve, reject) => {
    const nodeRes = new ServerResponse(nodeReq);
    const chunks: Buffer[] = [];
    let headersCommitted = false;
    let settled = false;

    Object.defineProperty(nodeRes, 'headersSent', {
      get: () => headersCommitted,
      configurable: true,
    });

    const finalize = () => {
      if (settled) return;
      settled = true;
      headersCommitted = true;

      const webHeaders = new Headers();
      const outHeaders = nodeRes.getHeaders();
      for (const [key, value] of Object.entries(outHeaders)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            webHeaders.append(key, String(item));
          }
        } else {
          webHeaders.set(key, String(value));
        }
      }

      const status = nodeRes.statusCode || 200;
      const bodyPayload =
        method === 'HEAD' || status === 204 || status === 304
          ? null
          : new Uint8Array(Buffer.concat(chunks));

      resolve(
        new Response(bodyPayload, {
          status,
          statusText: nodeRes.statusMessage || undefined,
          headers: webHeaders,
        })
      );
      queueMicrotask(() => {
        nodeRes.emit('finish');
        nodeRes.emit('close');
      });
    };

    nodeRes.writeHead = function writeHeadOverride(
      statusCode: number,
      statusMessageOrHeaders?: string | OutgoingHttpHeaders | Array<string | number>,
      maybeHeaders?: OutgoingHttpHeaders | Array<string | number>
    ): ServerResponse {
      nodeRes.statusCode = statusCode;
      let headerBag = maybeHeaders;
      if (typeof statusMessageOrHeaders === 'string') {
        nodeRes.statusMessage = statusMessageOrHeaders;
      } else if (statusMessageOrHeaders) {
        headerBag = statusMessageOrHeaders;
      }

      if (headerBag && !Array.isArray(headerBag)) {
        for (const [k, v] of Object.entries(headerBag)) {
          if (v !== undefined) {
            nodeRes.setHeader(k, v as string | number | readonly string[]);
          }
        }
      }
      headersCommitted = true;
      return nodeRes;
    } as typeof nodeRes.writeHead;

    nodeRes.write = function writeOverride(
      chunk: unknown,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void
    ): boolean {
      if (!headersCommitted) {
        headersCommitted = true;
      }
      const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      const buf = toBufferChunk(chunk, encoding);
      if (buf.byteLength > 0) {
        chunks.push(buf);
      }
      callback?.();
      return true;
    } as typeof nodeRes.write;

    nodeRes.end = function endOverride(
      chunkOrCb?: unknown,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void
    ): ServerResponse {
      let callback: (() => void) | undefined = cb;
      let encoding: BufferEncoding | undefined;
      if (typeof chunkOrCb === 'function') {
        callback = chunkOrCb as () => void;
      } else if (chunkOrCb !== undefined && chunkOrCb !== null) {
        if (typeof encodingOrCb === 'function') {
          callback = encodingOrCb;
        } else {
          encoding = encodingOrCb;
        }
        const buf = toBufferChunk(chunkOrCb, encoding);
        if (buf.byteLength > 0) {
          chunks.push(buf);
        }
      }
      finalize();
      callback?.();
      return nodeRes;
    } as typeof nodeRes.end;

    nodeRes.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    app(nodeReq as unknown as Parameters<Express>[0], nodeRes as unknown as Parameters<Express>[1]);
  });
}
