import { createRouter, createWebHistory } from 'vue-router';
import AgentList from '../views/AgentList.vue';
import Dashboard from '../views/Dashboard.vue';
import ResultView from '../views/ResultView.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    component: AgentList,
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: Dashboard,
  },
  {
    path: '/result',
    name: 'result',
    component: ResultView,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
