/**
 * A tiny static file server for the QA build's static export (`out-qa/`) — no dependency beyond
 * Node's own `http`/`fs`. Not a general-purpose server: it only needs to serve one static site to
 * one headless browser for the duration of a QA run.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
}

/**
 * Next's static export has no clean-URL rewriting server of its own; this mirrors what `next
 * start`/most static hosts do for it: an exact file, then `<path>/index.html`, then `<path>.html`.
 * @param {string} rootDir
 * @param {string} requestUrl
 * @returns {Promise<string | null>} absolute file path, or `null` if nothing matched
 */
async function resolveFile(rootDir, requestUrl) {
  const decoded = decodeURIComponent(requestUrl.split('?')[0])
  const candidates = [path.join(rootDir, decoded), path.join(rootDir, decoded, 'index.html'), path.join(rootDir, `${decoded}.html`)]
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (!resolved.startsWith(path.resolve(rootDir))) continue
    try {
      const info = await stat(resolved)
      if (info.isFile()) return resolved
    } catch {
      // try the next candidate
    }
  }
  return null
}

/**
 * @param {string} rootDir - absolute path to the directory to serve.
 * @param {number} [port] - `0` picks a free ephemeral port.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startStaticServer(rootDir, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      resolveFile(rootDir, req.url ?? '/')
        .then((file) => {
          if (file === null) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream' })
          createReadStream(file).pipe(res)
        })
        .catch((error) => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(String(error))
        })
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address !== null ? address.port : port
      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        close: () => new Promise((res) => server.close(() => res())),
      })
    })
  })
}
