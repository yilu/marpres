// Enter print layout before capturing. Reveals hide other slides on screen;
// Marp's ResizeObserver must resize their code blocks once they become visible.
export async function preparePrintPage(page) {
  await page.emulateMedia({ media: 'print' })
  await page.waitForFunction(() => window.__marpStagesReady === true)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
