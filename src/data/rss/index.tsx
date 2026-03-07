import { start, end } from '../timer'
import getLastKeepDaysRegionDiscountInfo from './storageDiscountInfo'
import getRegionMonthlyDiscountStats from './storageMonthlyStats'
import { generateRegionFeed } from './generateRSS'

export default function updateFeeds(props: {
  timestamp: number
  regionDiscountInfo: RegionDiscountInfo
  regionAppInfo: RegionAppInfo
  appConfig: AppConfig[]
  regionStorageAppInfo: RegionStorageAppInfo
}) {
  start('updateFeeds')
  const { timestamp, regionDiscountInfo, regionAppInfo, appConfig, regionStorageAppInfo } =
    props

  const fullRegionDiscountInfo =
    getLastKeepDaysRegionDiscountInfo(regionDiscountInfo, regionAppInfo)

  const regionMonthlyDiscountStats =
    getRegionMonthlyDiscountStats(regionDiscountInfo)

  generateRegionFeed({
    timestamp,
    regionDiscountInfo: fullRegionDiscountInfo,
    appConfig,
    regionStorageAppInfo,
    regionMonthlyDiscountStats,
  })

  end('updateFeeds')

  return {
    regionMonthlyDiscountStats,
  }
}
