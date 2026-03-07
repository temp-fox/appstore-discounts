import nodeFetch from 'node-fetch'

/**
 * https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html#//apple_ref/doc/uid/TP40017632-CH5-SW1
 */
const BASE_URL = 'https://itunes.apple.com/lookup'

export function getUrl(appIds: Array<string | number>, region: Region) {
  const url = new URL(BASE_URL)

  const params: Record<string, string> = {
    id: appIds.join(','),
    country: region,
    entity: 'software',
    limit: `${appIds.length}`,
    timestamp: Date.now() + '',
  }
  // 中文区优先请求中文内容
  if (region === 'cn') params.l = 'zh_CN'
  const search = new URLSearchParams(params).toString()
  url.search = search

  return url
}

export default async function getAppInfo(
  appIds: Array<string | number>,
  region: Region,
  log: string,
): Promise<RequestAppInfo[]> {
  let res: RequestAppInfo[] = []
  try {
    const tempRes = (await nodeFetch(getUrl(appIds, region), {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    }).then((res) => res.json())) as ResponseResult

    const errorMessage = tempRes.errorMessage

    if (errorMessage) {
      throw errorMessage
    }

    res = (tempRes as ResponseResult).results
  } catch (error) {
    console.error('getAppInfo request error:', error)
    const errorMsg = typeof error === 'string' ? error : error?.toString?.()
    if (
      errorMsg.includes('SyntaxError: Unexpected token < in JSON at position 0')
    ) {
      res = await getAppInfo(appIds, region, log)
    }
  }

  return res
}
