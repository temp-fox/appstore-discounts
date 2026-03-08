import { chunk } from 'lodash'
import pLimit from 'p-limit'
import { start, end } from '../../timer'
import getAppInfo from './getAppInfo'
import { getCachedAppInfo, getCachedScreenshots, shouldUseCache } from '../../helper/appCache'
import {
  getByFetch,
  getByPlayWright,
  GetInAppPurchasesResult,
  GetInAppPurchasesProps,
  playWrightBrowserManager,
} from './getInAppPurchases'
import { initAmpApiToken, getScreenshotsByAmpApi, getAppMetadataByAmpApi, AppMetadataResult } from './getScreenshots'

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
        // 第二步：通过 amp-api 批量获取元数据（截图 + hasInAppPurchases）
        const appMetadataMap = new Map<number, AppMetadataResult>()
        const tokenOk = await initAmpApiToken(region)
        if (tokenOk) {
          const metadataBatchSize = 50
          const allTrackIds = appInfos.map((app) => app.trackId)
          for (let b = 0; b < allTrackIds.length; b += metadataBatchSize) {
            const batchIds = allTrackIds.slice(b, b + metadataBatchSize)
            const batchResult = await getAppMetadataByAmpApi(batchIds, region)
            for (const [id, metadata] of batchResult) {
              appMetadataMap.set(id, metadata)
            }
          }
          console.log(`${label} amp-api 元数据: 获取 ${appMetadataMap.size}/${allTrackIds.length} 个应用`)
        } else {
          console.warn(`${label} amp-api 元数据: 跳过（token 获取失败），所有应用走原有爬取路径`)
        }

        // 第三步：获取内购数据（缓存优先 > amp-api 跳过无内购 > HTML 爬取）
        let cacheHitCount = 0
        let cacheMissCount = 0
        let skipCount = 0

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

            // 检查 amp-api 元数据：严格匹配 false 才跳过
            const metadata = appMetadataMap.get(appInfo.trackId)
            if (metadata?.hasInAppPurchases === false) {
              skipCount++
              return Promise.resolve({
                inAppPurchases: {},
                times: 0,
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
        console.log(`${label} 应用信息: ${appInfos.length} 个 | 缓存命中: ${cacheHitCount} | 无内购跳过: ${skipCount} | 新获取: ${cacheMissCount}${iapFailedCount > 0 ? ` | 内购失败: ${iapFailedCount}` : ''}`)

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

        // 第四步：从存储恢复缓存截图 + amp-api 补充剩余缺失截图
        // 4a. 先从本地存储恢复（上次 amp-api 已获取过的截图）
        let cacheRestoredCount = 0
        res[region].forEach((app) => {
          if (
            (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
            (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0)
          ) {
            const cached = getCachedScreenshots(app.trackId, region)
            if (cached) {
              if (cached.screenshotUrls.length > 0) app.screenshotUrls = cached.screenshotUrls
              if (cached.ipadScreenshotUrls.length > 0) app.ipadScreenshotUrls = cached.ipadScreenshotUrls
              cacheRestoredCount++
            }
          }
        })

        // 4b. 再用 amp-api 补充仍然缺失的截图
        if (appMetadataMap.size > 0) {
          let screenshotSuccessCount = 0
          const appsNeedScreenshots = res[region].filter(
            (app) =>
              (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
              (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
          )

          for (const app of appsNeedScreenshots) {
            const metadata = appMetadataMap.get(app.trackId)
            if (metadata) {
              if (metadata.screenshotUrls.length > 0) {
                app.screenshotUrls = metadata.screenshotUrls
              }
              if (metadata.ipadScreenshotUrls.length > 0) {
                app.ipadScreenshotUrls = metadata.ipadScreenshotUrls
              }
              if (metadata.screenshotUrls.length > 0 || metadata.ipadScreenshotUrls.length > 0) {
                screenshotSuccessCount++
              }
            }
          }

          if (cacheRestoredCount > 0 || appsNeedScreenshots.length > 0) {
            console.log(`${label} 截图补充: 缓存恢复: ${cacheRestoredCount} | amp-api 新补充: ${screenshotSuccessCount}/${appsNeedScreenshots.length}`)
          }
        } else {
          // amp-api 完全失败时降级到原有截图获取逻辑
          const appsNeedScreenshots = res[region].filter(
            (app) =>
              (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
              (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
          )

          if (appsNeedScreenshots.length > 0 && tokenOk) {
            let screenshotSuccessCount = 0
            let screenshotFailCount = 0

            const batchSize = 50
            for (let b = 0; b < appsNeedScreenshots.length; b += batchSize) {
              const batch = appsNeedScreenshots.slice(b, b + batchSize)
              const batchIds = batch.map((app) => app.trackId)
              const screenshotsMap = await getScreenshotsByAmpApi(batchIds, region)

              for (const app of batch) {
                const result = screenshotsMap.get(app.trackId)
                if (result) {
                  if (result.screenshotUrls.length > 0) {
                    app.screenshotUrls = result.screenshotUrls
                  }
                  if (result.ipadScreenshotUrls.length > 0) {
                    app.ipadScreenshotUrls = result.ipadScreenshotUrls
                  }
                  screenshotSuccessCount++
                } else {
                  screenshotFailCount++
                }
              }
            }

            console.log(`${label} 截图补充(降级): 缓存恢复: ${cacheRestoredCount} | amp-api: ${screenshotSuccessCount}/${appsNeedScreenshots.length}`)
          }
        }
      }
    }
  } finally {
    await playWrightBrowserManager.close()
  }

  end(label)
  return res
}

