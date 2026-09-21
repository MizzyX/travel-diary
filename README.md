# 旅行日记 · Travel Diary

一个纯前端的旅行日记 Web 应用：**行前做计划、行中自动记录 GPS 足迹与照片、随手记账，旅行结束后一键生成可分享给家人的网页**。

所有数据保存在你自己设备的浏览器里，不依赖服务器、不需要登录。

## 功能

| 模块 | 说明 |
| --- | --- |
| 🗓️ 行前计划 | 按天编排行程，支持交通/住宿/餐饮/景点/购物分类、时间、地点搜索（自动带经纬度）、备注、完成勾选 |
| 🥾 GPS 足迹 | 浏览器实时定位记录轨迹（自动过滤漂移点、按需抽稀），支持地图图层切换、距离/时长/精度统计、GPX 导入导出、手动补点 |
| 📷 照片同步 | 手机/电脑批量导入照片，自动读取 EXIF 中的**拍摄时间与 GPS**，按日期归档并把照片打点到地图上；自动生成缩略图与压缩存档 |
| 📖 旅行日记 | 按天自动把「行程 + 随记 + 照片 + 消费」合成时间线，可附带当时的位置写随记 |
| 💰 消费记账 | 分类记账（交通/住宿/餐饮/门票/购物/其他），预算进度、分类占比环形图、每日花费柱状图、人均/日均统计 |
| 🔗 一键分享 | 导出**单个自包含 HTML 文件**（行程 + 地图 + 照片 + 账单），家人双击即可查看；也可先新窗口预览 |
| 💾 数据备份 | 支持导出/导入 JSON 备份（可选是否包含照片），可一键清空数据 |
| 💱 多币种汇率 | 记账时按**支付币种**录入，自动拉取当天汇率换算成旅行本位币；汇率缓存在本地，离线可手填 |
| 🔄 行程 ⇄ 账单 | 「从行程生成账单」把计划里的项目按类型补成消费；「从账单补全行程」把消费反向补成当天行程（同一天同标题去重） |
| 🧩 足迹配对照片 | 没有 GPS 的照片，按**拍摄时间**贴到最近的足迹轨迹点（容差可选 10/30/60 分钟或不限） |
| 📴 离线可用（PWA） | 内置 Service Worker：页面/JS/CSS/地图瓦片缓存到本地，装到桌面后可离线打开 |

## 快速开始

```bash
npm install
npm run dev        # 开发调试，默认 http://localhost:5173
npm run build      # 生产构建，产物在 dist/
npm run preview    # 本地预览构建产物
```

`npm run dev` 已开启 `--host`，手机在同一局域网下可直接访问终端里输出的局域网地址。

## 手机上记录足迹的注意事项

1. **必须 HTTPS 或本机/localhost 访问**：浏览器只在安全上下文里开放定位能力（除了 `http://localhost`）。若要手机访问，请把 `dist/` 部署到任意静态托管（GitHub Pages / Vercel / Netlify / 腾讯云静态托管等，均自带 HTTPS），或用内网穿透工具(Ngrok/cpolar)。
2. 首次点击「开始记录足迹」时授权定位权限。
3. 记录过程中请**保持页面在前台**：手机息屏或切后台时系统通常会暂停定位。若希望息屏也记录，请把网站**添加到主屏幕**并确保系统没有限制其后台定位。
4. 部分安卓机型上传 HEIC 格式照片无法解码，建议在手机相册设置里改为「兼容性最好」/JPEG 后再导入。

### 为什么直接双击 `index.html` 打不开？

项目是 ES Module 应用，`file://` 协议会被浏览器的模块安全策略拦截（页面空白）。**必须通过 http 服务打开**：

- 本地：`npm run dev`（开发，http://localhost:5173）或 `npm run preview`（预览 dist 构建产物，http://localhost:4173）
- 任意静态服务器均可，例如 `npx serve dist` / `python -m http.server 8080`（进入 `dist` 目录后运行）
- 手机访问请用局域网地址或部署到带 HTTPS 的静态托管

## 技术说明

- React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Leaflet（OpenStreetMap 瓦片）
- 数据持久化使用 **IndexedDB**（`travel-diary` 库，trips / plans / journals / tracks / expenses / photos 六张表），照片以 Blob + 缩略图双份存储
- EXIF 解析自建（读取 JPEG APP1 中的 `DateTimeOriginal` 与 GPS IFD），不依赖第三方解析库
- 行程地点搜索使用 OpenStreetMap Nominatim 公共接口（需要联网，失败时可手动填写）
- 分享页通过 Leaflet CDN 加载地图；若查看者离线，其余内容仍可正常阅读
- PWA / 离线：`public/sw.js` 为应用外壳（index.html + manifest）做预缓存，JS/CSS 走 stale-while-revalidate，地图瓦片/Leaflet CDN 走 cache-first，汇率接口走 network-first；仅在**生产构建**（`npm run build` + preview/部署）下注册，有新版本时顶部出现「立即更新」。汇率源依次为 frankfurter.dev → frankfurter.app → open.er-api.com，结果按本位币缓存在 localStorage（6 小时内复用，离线时可手填）
- 行程 ⇄ 账单、照片-足迹配对见 `src/lib/linking.ts` 与 `src/lib/geo.ts`（`matchPhotosToTracks`，按时间二分查找最近轨迹点）

## 目录结构

```
src/
├── components/     # 通用组件（地图、 Toast、表单控件、照片缩略图）
├── lib/            # IndexedDB、EXIF、图片处理、GPX、地理计算、备份、分享导出
├── state/          # 全局数据 Store（Context + IndexedDB 写入）与照片 URL 缓存
├── views/          # 页面：Home / TripDetail / Daily / Plan / Track / Album / Ledger / Share
└── types.ts        # 数据模型
```

## 数据备份提醒

数据存在浏览器本地，**清理浏览器数据 / 更换设备 / 卸载浏览器会导致数据丢失**。建议旅行结束或换设备前，在首页「数据备份」中导出 JSON 并妥善保存；换设备后在同处导入即可恢复（含照片的备份可以还原照片，但文件体积较大）。
