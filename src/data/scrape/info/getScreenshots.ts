import nodeFetch from 'node-fetch'
import chalk from 'chalk'

export interface ScreenshotResult {
  screenshotUrls: string[]
  ipadScreenshotUrls: string[]
}

const EMPTY_RESULT: ScreenshotResult = {
  screenshotUrls: [],
  ipadScreenshotUrls: [],
}

function extractScreenshotUrls(
  items: any[],
  width: number,
  height: number,
): string[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const template = item?.screenshot?.template
      if (typeof template !== 'string') return null
      return template
        .replace('{w}', String(width))
        .replace('{h}', String(height))
        .replace('{c}', 'bb')
        .replace('{f}', 'png')
    })
    .filter((url): url is string => url !== null)
}

export async function getScreenshotsFromWeb(
  trackViewUrl: string,
  log: string,
): Promise<ScreenshotResult> {
  const url = `${trackViewUrl}${
    trackViewUrl.includes('?') ? '&' : '?'
  }timestamp=${Date.now()}`

  try {
    const html = await nodeFetch(url, {
      method: 'GET',
      headers: { Accept: '*/*' },
    }).then((res) => res.text())

    // Extract serialized-server-data JSON from script tag
    const match = html.match(
      /<script[^>]+id="serialized-server-data"[^>]*>\s*(\[[\s\S]*?\])\s*<\/script>/,
    )
    if (!match) {
      console.warn(chalk.yellow(`${log} serialized-server-data not found`))
      return EMPTY_RESULT
    }

    const serverData = JSON.parse(match[1])
    const shelfMapping = serverData?.[0]?.data?.shelfMapping
    if (!shelfMapping) {
      console.warn(chalk.yellow(`${log} shelfMapping not found`))
      return EMPTY_RESULT
    }

    const phoneItems = shelfMapping['product_media_phone_']?.items
    const padItems = shelfMapping['product_media_pad_']?.items

    const screenshotUrls = extractScreenshotUrls(phoneItems, 392, 696)
    const ipadScreenshotUrls = extractScreenshotUrls(padItems, 576, 768)

    return { screenshotUrls, ipadScreenshotUrls }
  } catch (error) {
    console.warn(chalk.yellow(`${log} 截图抓取失败:`), error)
    return EMPTY_RESULT
  }
}
