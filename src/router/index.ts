import { createRouter, createWebHistory } from 'vue-router'
import PlatformHomeView from '../pages/PlatformHomeView.vue'
import UniversalPlayerView from '../pages/UniversalPlayerView.vue'
import { Platform } from '../platforms/common/types'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'DouyuHome',
      component: PlatformHomeView,
      meta: { platform: 'douyu' }
    },
    {
      path: '/douyin',
      name: 'DouyinHome',
      component: PlatformHomeView,
      meta: { platform: 'douyin' }
    },
    {
      path: '/huya',
      name: 'HuyaHome',
      component: PlatformHomeView,
      meta: { platform: 'huya' }
    },
    {
      path: '/bilibili',
      name: 'BilibiliHome',
      component: PlatformHomeView,
      meta: { platform: 'bilibili' }
    },
    {
      path: '/player/douyu/:roomId', 
      name: 'douyuPlayer',
      component: UniversalPlayerView,
      props: route => ({ roomId: route.params.roomId, platform: Platform.DOUYU })
    },
    {
      path: '/player/douyin/:roomId',
      name: 'douyinPlayer',
      component: UniversalPlayerView,
      props: route => ({ roomId: route.params.roomId, platform: Platform.DOUYIN })
    },
    {
      path: '/player/huya/:roomId',
      name: 'huyaPlayer',
      component: UniversalPlayerView,
      props: route => ({ roomId: route.params.roomId, platform: Platform.HUYA })
    },
    {
      path: '/player/bilibili/:roomId',
      name: 'bilibiliPlayer',
      component: UniversalPlayerView,
      props: route => ({ roomId: route.params.roomId, platform: Platform.BILIBILI })
    }
  ]
})

export default router