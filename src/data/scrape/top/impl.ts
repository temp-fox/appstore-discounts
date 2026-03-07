import nodeFetch from 'node-fetch'

// 原始配置：前10名
// const limit = 10

// 自定义配置：每个分类前200名（API 最大限制）
const limit = 200

// App Store 所有主要分类
const genres = {
  business: 6000,        // 商务
  weather: 6001,         // 天气
  utilities: 6002,       // 工具
  travel: 6003,          // 旅游
  sports: 6004,          // 体育
  socialNetworking: 6005, // 社交
  reference: 6006,       // 参考
  productivity: 6007,    // 效率
  photoVideo: 6008,      // 摄影与录像
  news: 6009,            // 新闻
  navigation: 6010,      // 导航
  music: 6011,           // 音乐
  lifestyle: 6012,       // 生活
  healthFitness: 6013,   // 健康健美
  games: 6014,           // 游戏
  finance: 6015,         // 财务
  entertainment: 6016,   // 娱乐
  education: 6017,       // 教育
  books: 6018,           // 图书
  stickers: 6019,        // 贴纸
  medical: 6020,         // 医疗
  magazinesNewspapers: 6021, // 杂志与报纸
  catalogs: 6022,        // 商品指南
  foodDrink: 6023,       // 美食佳饮
  shopping: 6024,        // 购物
}

function getUrl(region: Region, genreId?: number) {
  if (genreId) {
    return `https://itunes.apple.com/${region}/rss/toppaidapplications/limit=${limit}/genre=${genreId}/json`
  }
  return `https://itunes.apple.com/${region}/rss/toppaidapplications/limit=${limit}/json`
}

async function fetchGenreApps(region: Region, genreName: string, genreId: number): Promise<AppTopInfo[]> {
  const res: AppTopInfo[] = []

  try {
    const response = await nodeFetch(getUrl(region, genreId), {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'iTunes/12.0 (Macintosh; OS X 10.15) AppleWebKit/600.1.25',
      },
    })
    
    // 检查响应状态
    if (!response.ok) {
      console.error(`  ✗ ${genreName}: HTTP ${response.status} ${response.statusText}`)
      return res
    }
    
    const tempRes = (await response.json()) as AppTopInfoResponse

    // 检查是否有 entry 数组
    if (tempRes.feed?.entry && Array.isArray(tempRes.feed.entry)) {
      tempRes.feed.entry.forEach((appInfo) => {
        const name = appInfo['im:name'].label
        const id = appInfo['id'].attributes['im:id']

        if (name && id) {
          res.push({
            id,
            name,
            addSource: 'paid-top',    // 来源：付费排行榜
            _shouldBePaid: true,      // 付费排行榜的 app 必然是付费应用
            _discountType: 'app',     // 付费应用本体折扣
            _externalSourceFirstSeen: Date.now(), // 首次加入追踪的时间戳（用于首见限免检测）
          })
        }
      })
    } else {
      // 该分类可能没有付费应用，静默处理
    }

  } catch (error) {
    console.error(`  ✗ ${genreName} 分类获取失败:`, error)
  }

  return res
}

// 延迟函数
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function getAppTopInfo(
  region: Region,
  log: string,
): Promise<AppTopInfo[]> {
  console.log(log)
  console.log(`获取 ${Object.keys(genres).length} 个分类的付费排行榜（每分类前 ${limit} 名，每批 3 个分类）`)

  const allApps: AppTopInfo[] = []
  const appIdSet = new Set<string>() // 用于去重
  const failedGenres: string[] = []

  // 分批处理，避免触发速率限制
  const genreEntries = Object.entries(genres)
  const batchSize = 3 // 每批处理 3 个分类

  for (let i = 0; i < genreEntries.length; i += batchSize) {
    const batch = genreEntries.slice(i, i + batchSize)

    // 并发处理当前批次
    const batchPromises = batch.map(([name, id]) =>
      fetchGenreApps(region, name, id)
    )

    const batchResults = await Promise.all(batchPromises)

    // 合并当前批次的结果
    batchResults.forEach((apps, idx) => {
      if (apps.length === 0) {
        failedGenres.push(batch[idx][0])
      }
      apps.forEach((app) => {
        if (!appIdSet.has(app.id)) {
          appIdSet.add(app.id)
          allApps.push(app)
        }
      })
    })

    // 如果不是最后一批，等待 2 秒
    if (i + batchSize < genreEntries.length) {
      await delay(2000)
    }
  }

  console.log(`排行榜完成: ${allApps.length} 个不重复应用（${Object.keys(genres).length} 个分类）${failedGenres.length > 0 ? ` | 失败: ${failedGenres.join(', ')}` : ''}`)
  
  return allApps
}
