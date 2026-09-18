import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Builds the run's contact sheet: every shot's screenshot in a labelled grid, as one PNG. No
 * image-compositing dependency (ImageMagick, sharp) — the grid is a plain HTML page loaded in
 * the same browser this run already has open, screenshotted like anything else.
 */

/**
 * @param {import('playwright').Browser} browser
 * @param {{ name: string, pngPath: string, pass: boolean, description: string }[]} shots
 * @param {string} outDir directory the shots were written to; the sheet is written there too
 * @returns {Promise<Buffer>} PNG bytes of the whole sheet
 */
export async function buildContactSheet(browser, shots, outDir) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
  try {
    const cells = shots
      .map((shot) => {
        const fileUrl = encodeURI(basename(shot.pngPath))
        return `
          <figure class="cell ${shot.pass ? 'pass' : 'fail'}">
            <img src="${fileUrl}" alt="${escapeHtml(shot.name)}" />
            <figcaption>
              <strong>${escapeHtml(shot.name)}</strong> — ${shot.pass ? 'PASS' : 'FAIL'}
              <div class="desc">${escapeHtml(shot.description)}</div>
            </figcaption>
          </figure>`
      })
      .join('\n')

    const html = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  body { margin: 0; padding: 16px; background: #111; font: 12px/1.4 -apple-system, sans-serif; color: #eee; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .cell { margin: 0; background: #1b1b1b; border: 2px solid #333; border-radius: 6px; overflow: hidden; }
  .cell.fail { border-color: #d33; }
  .cell img { display: block; width: 100%; height: auto; background: #000; }
  figcaption { padding: 6px 8px; }
  .desc { color: #999; margin-top: 2px; }
</style></head>
<body><div class="grid">${cells}</div></body></html>`

    // The sheet is written next to the shots and opened as a real file:// page, rather than
    // injected with setContent: a page with no origin cannot load file:// images, which renders
    // every cell blank while still reporting the images as "complete".
    const sheetPath = join(outDir, 'contact-sheet.html')
    await writeFile(sheetPath, html)
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: 'load' })
    await page.waitForFunction(() =>
      Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
    )
    const grid = page.locator('.grid')
    return await grid.screenshot()
  } finally {
    await page.close()
  }
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
