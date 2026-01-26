# 前端优化 Roadmap

本 Roadmap 基于代码审查发现的架构、性能及可维护性问题制定。

## 1. 架构重构 (Architectural Refactoring) [DONE]

> 目标：实现业务逻辑与 UI 的深度解耦，建立标准化的模块化架构。

- [X] **引入 Feature-Sliced 设计模式**
  - [X] 创建 `src/features` 目录，将复杂业务模块（Player, Following, Rooms）从通用组件中剥离。
  - [X] 统一命名规范，所有 Vue 组件采用 PascalCase。
- [X] **模块化整理**
  - [X] 迁移播放器逻辑至 `src/features/player`。
  - [X] 迁移关注列表逻辑至 `src/features/following`。
  - [X] 建立 `src/services/platforms` 统一管理第三方平台解析逻辑。
  - [X] 提取 `src/components/ui` 存放原子级通用控件。

## 2. Pinia 状态管理优化 (Store Normalization) [DONE]

> 目标：消除数据冗余，确保单一数据源，简化数据同步逻辑。

- [X] **重构 State 结构**
  - [X] 将 `followedStreamers` 改造为 `Record<string, FollowedStreamer>` (Streamer Map) 以实现 O(1) 查找。
  - [X] 将 `folders` 改造为 `Record<string, FollowFolder>` (Folder Map)。
  - [X] 将 `listOrder` 简化为仅存储引用 ID 的数组：`Array<{ type: 'folder' | 'streamer'; id: string }>`。
- [X] **更新 Getters**
  - [X] 实现 `displayList` getter，负责根据 `listOrder` 动态组装完整对象供组件渲染。
- [X] **重构 Actions**
  - [X] 更新增删改查逻辑，支持自动数据迁移 (兼容旧版 localStorage)。

## 3. 配置集中化 (Config Centralization) [DONE]

> 目标：消除平台相关的硬编码，便于未来扩展新平台或修改资源。

- [X] **创建配置模块**
  - [X] 新建 `src/config/platforms.ts`，定义并导出 `PLATFORMS` 常量。
- [X] **替换硬编码引用**
  - [X] 重构 `PlatformHomeView.vue`、`Navbar.vue` 使用配置文件生成 UI。

## 4. 视觉体验优化 (UI/UX Enhancement) [DONE]

> 目标：提升应用的现代感与原生感。

- [X] **启用窗口磨砂效果 (Vibrancy)**
  - [X] 配置 `tauri.conf.json` 支持透明窗口。
  - [X] 修改 CSS 主题变量，引入半透明背景色适配毛玻璃。
  - [X] 后端 Rust 引入 `window-vibrancy` 库并实现 Windows (Mica/Acrylic) 与 macOS 适配。

## 5. 性能优化 (Performance)

> 目标：优化长列表渲染性能及网络请求效率。

- [X] **按需刷新策略 (Smart Refreshing)**
  - [X] 优化 `refreshList` 逻辑，优先刷新视口内可见的主播项。
- [ ] **虚拟滚动 (Virtual Scrolling)**
  - [ ] 在 `FollowsList` 中正式启用 `vue-virtual-scroller`。
  - [ ] 解决虚拟滚动与现有自定义拖拽排序功能的兼容性问题。

## 6. 代码健壮性 & 类型安全 (Robustness)

> 目标：减少运行时错误，提升开发体验。

- [X] **完善 TypeScript 类型**
  - [X] 补充 `src/types/global.d.ts` 全局接口定义。
  - [X] 彻底消除 Composables (useDouyinLiveRooms 等) 核心逻辑中的隐式 `any`。
- [X] **增强错误处理与反馈**
  - [X] 为主播项增加 `lastUpdateFailed` 状态，并在 UI 中通过 `AlertCircle` 显式反馈。
  - [X] 实现点击错误图标触发手动重试。

## 7. 深度优化规划 (Future Work)

> 目标：追求极致的工程化质量。

- [X] **API 层抽象 (API Abstraction)**
  - [X] 将所有 `invoke` 调用收拢到 `src/api/` 目录，按功能模块封装。
  - [X] 实现前端逻辑与 Tauri `invoke` 框架的解耦。
- [ ] **页面逻辑“瘦身” (Page Slimming)**
  - [ ] 将 `PlatformHomeView.vue` 的布局与复杂滚动逻辑进一步提取。
  - [ ] 建立 `categoryStore` 统一管理全平台分类状态。
- [ ] **系统化类型整理 (Systematic Typings)**
  - [ ] 整理 `src/types/`，按 `models`, `api`, `app` 分层存放定义。
- [ ] **样式系统变量化 (Design System Consistency)**
  - [ ] 将各平台品牌色（品牌橙、品牌粉等）注入平台配置并导出为 CSS 变量。
