import { chunk } from 'lodash'
import pLimit from 'p-limit'
import { start, end } from '../../timer'
import getAppInfo from './getAppInfo'
import { getCachedAppInfo, shouldUseCache } from '../../helper/appCache'
import {
  getByFetch,
  getByPlayWright,
  GetInAppPurchasesResult,
  GetInAppPurchasesProps,
  playWrightBrowserManager,
} from './getInAppPurchases'
import { getScreenshotsFromWeb } from './getScreenshots'

const scrapeTypeImplMap: Record<
  InAppPurchasesScrapeType,
  (
    props: GetInAppPurchasesProps,
  ) => GetInAppPurchasesResult | Promise<GetInAppPurchasesResult>
> = {
  fetch: getByFetch,
  playwright: getByPlayWright,
}

export default async function getRegionAppInfo(
  appIds: Array<string | number>,
  regions: Region[],
  limitCount: number,
  scrapeType: InAppPurchasesScrapeType,
) {
  const label = `parallel getRegionAppInfo(${limitCount})`
  start(label)
  const res: RegionAppInfo = {}
  const limit = pLimit(limitCount)
  const chunkAppIds = chunk(appIds, 200)

  try {
    if (scrapeType === 'playwright') {
      await playWrightBrowserManager.initialize()
    }
    const scrapeImpl = scrapeTypeImplMap[scrapeType]

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i]
      const label = `【${i + 1}/${regions.length}】（${region}）`

      // 第一步：查询基础应用信息（从 API）
      const appInfos = (
        await Promise.all(
          chunkAppIds.map((appIds, i) => {
            const label2 = `${label}【${i + 1}/${chunkAppIds.length}】`
            return getAppInfo(appIds, region, `${label2}getAppInfo`)
          }),
        )
      ).reduce((res, appInfos) => {
        res.push(...appInfos)
        return res
      }, [])

      const queriedCount = appIds.length
      if (appInfos.length === 0) {
        console.log(`${label} API 返回 0 个结果（查询 ${queriedCount} 个）`)
      }

      if (appInfos.length > 0) {
        let cacheHitCount = 0
        let cacheMissCount = 0

        const inAppPurchasesArr: GetInAppPurchasesResult[] = await Promise.all(
          appInfos.map((appInfo, j) => {
            // 检查缓存
            let cachedData = null
            if (shouldUseCache(appInfo.trackId)) {
              cachedData = getCachedAppInfo(appInfo.trackId, region)
            }

            // 如果有缓存，直接返回缓存的内购数据
            if (cachedData) {
              cacheHitCount++
              return Promise.resolve({
                inAppPurchases: cachedData.inAppPurchases,
                times: cachedData.inAppPurchasesTimes,
                failed: false,
              })
            }

            // 否则调用 scrape 函数获取
            cacheMissCount++
            return limit(() =>
              scrapeImpl({
                appInfo,
                region,
                log: `${label}【${j + 1}/${appInfos.length}】【${
                  appInfo.trackName
                }】【by ${scrapeType}】`,
              }),
            )
          }),
        )

        // 统计内购获取结果
        const iapFailedCount = inAppPurchasesArr.filter(r => r.failed).length
        console.log(`${label} 应用信息: ${appInfos.length} 个 | 缓存命中: ${cacheHitCount} | 新获取: ${cacheMissCount}${iapFailedCount > 0 ? ` | 内购失败: ${iapFailedCount}` : ''}`)

        res[region] = appInfos.reduce((res, appInfo, j) => {
          const { inAppPurchases, times, failed } = inAppPurchasesArr[j]
          res.push({
            ...appInfo,
            inAppPurchases,
            inAppPurchasesTimes: times,
            inAppPurchasesFailed: failed,
          })
          return res
        }, [] as AppInfo[])

        // 第三步：为缺失截图的应用从 App Store 网页补充截图
        const appsNeedScreenshots = res[region].filter(
          (app) =>
            (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
            (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
        )

        if (appsNeedScreenshots.length > 0) {
          let screenshotSuccessCount = 0
          let screenshotFailCount = 0
          await Promise.all(
            appsNeedScreenshots.map((app, j) =>
              limit(async () => {
                const result = await getScreenshotsFromWeb(
                  app.trackViewUrl,
                  `${label}【${app.trackName}】截图补充`,
                )
                if (result.screenshotUrls.length > 0) {
                  app.screenshotUrls = result.screenshotUrls
                  screenshotSuccessCount++
                }
                if (result.ipadScreenshotUrls.length > 0) {
                  app.ipadScreenshotUrls = result.ipadScreenshotUrls
                  if (result.screenshotUrls.length === 0) screenshotSuccessCount++
                }
                if (result.screenshotUrls.length === 0 && result.ipadScreenshotUrls.length === 0) {
                  screenshotFailCount++
                }
              }),
            ),
          )
          console.log(`${label} 截图补充: ${appsNeedScreenshots.length} 个缺失 | 成功: ${screenshotSuccessCount} | 失败: ${screenshotFailCount}`)
        }
      }
    }
  } finally {
    await playWrightBrowserManager.close()
  }

  end(label)
  return res
}

