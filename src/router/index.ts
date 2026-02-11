import { createRouter, createWebHistory } from 'vue-router'
import DouyuHomeView from '../pages/DouyuHomeView.vue'
import DouyinHomeView from '../pages/DouyinHomeView.vue'
import DouyuPlayerView from '../pages/DouyuPlayerView.vue';
import DouyinPlayerView from '../pages/DouyinPlayerView.vue';
import HuyaHomeView from '../pages/HuyaHomeView.vue'
import HuyaPlayerView from '../pages/HuyaPlayerView.vue'
import BilibiliHomeView from '../pages/BilibiliHomeView.vue'
import BilibiliPlayerView from '../pages/BilibiliPlayerView.vue'
import CustomHomeView from '../pages/CustomHomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'DouyuHome',
      component: DouyuHomeView
    },
    {
      path: '/douyin',
      name: 'DouyinHome',
      component: DouyinHomeView
    },
    {
      path: '/huya',
      name: 'HuyaHome',
      component: HuyaHomeView
    },
    {
      path: '/bilibili',
      name: 'BilibiliHome',
      component: BilibiliHomeView
    },
    {
      path: '/custom',
      name: 'CustomHome',
      component: CustomHomeView
    },
    {
      path: '/player/douyu/:roomId', 
      name: 'douyuPlayer',
      component: DouyuPlayerView,
      props: true
    },
    {
      path: '/player/douyin/:roomId',
      name: 'douyinPlayer',
      component: DouyinPlayerView,
      props: true
    },
    {
      path: '/player/huya/:roomId',
      name: 'huyaPlayer',
      component: HuyaPlayerView,
      props: true
    },
    {
      path: '/player/bilibili/:roomId',
      name: 'bilibiliPlayer',
      component: BilibiliPlayerView,
      props: true
    }
  ]
})

export default router
