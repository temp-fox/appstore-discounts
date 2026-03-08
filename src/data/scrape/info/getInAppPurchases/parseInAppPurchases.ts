import { regionInAppPurchasesTextMap } from 'appinfo.config'
import { load } from 'cheerio'
import { isEmpty, pick } from 'lodash'
import chalk from 'chalk'
import { IN_APP_PURCHASE_MAX_TIMES } from './constants'

export type ParseInAppPurchasesProps = {
  appInfo: RequestAppInfo
  region: Region
  htmlContent: string
  log: string
  times: number
}

export type ParseInAppPurchasesReturnType = {
  needRetry: boolean
  inAppPurchases: AppInfo['inAppPurchases']
}

export default function parseInAppPurchases(
  props: ParseInAppPurchasesProps,
): ParseInAppPurchasesReturnType {
  const { htmlContent, region, log, times } = props

  const inAppPurchasesText = regionInAppPurchasesTextMap[region]

  const $ = load(htmlContent)

  const inAppPurchases: AppInfo['inAppPurchases'] = {}
  let informationLoadError = false
  let inAppPurchasesError = false

  const timesLog = chalk.red(`【x${times}】`)

  const getReturn = () => {
    const res = {
      inAppPurchases,
      informationLoadError,
      inAppPurchasesError,
      needRetry: informationLoadError || inAppPurchasesError,
    }

    return pick(res, [
      'needRetry',
      'inAppPurchases',
    ]) as ParseInAppPurchasesReturnType
  }

  const informationElement = $('#information')

  if (!informationElement?.html()) {
    informationLoadError = true
    if (times === 1 || times === 5 || times >= IN_APP_PURCHASE_MAX_TIMES) {
      console.error(`${log}${timesLog}can't load \`information\` element`)
    }
    return getReturn()
  }

  const inAppPurchasesElement = $(informationElement).find(
    `dt:contains("${inAppPurchasesText}")`,
  )
  inAppPurchasesElement
    ?.parent?.()
    ?.find?.('div.text-pair')
    ?.each((divIndex, div) => {
      let name = ''
      let price = ''
      $(div)
        .find('span')
        .each((spanIndex, span) => {
          const element = $(span)
          if (spanIndex === 0) {
            name = element.text().trim()
          } else if (spanIndex === 1) {
            price = element.text().trim()
          }

          if (name && price) {
            inAppPurchases[name] = price
          }
        })
    })

  if (inAppPurchasesElement?.html() && isEmpty(inAppPurchases)) {
    inAppPurchasesError = true
    if (times === 1 || times === 5 || times >= IN_APP_PURCHASE_MAX_TIMES) {
      console.error(
        `${log}${timesLog}is In-App purchase，but can't get relate info`,
      )
    }
  }

  return getReturn()
}
