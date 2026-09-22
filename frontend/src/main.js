// Copyright (c) 2026, Sanjay Kumar and contributors
// For license information, please see license.txt
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import ChatView from './pages/ChatView.vue'
import './style.css'

const routes = [
  {
    path: '/',
    name: 'Chat',
    component: ChatView,
  },
]

const router = createRouter({
  history: createWebHistory('/ai-chatbot/'),
  routes,
})

const app = createApp(App)

app.use(router)

app.mount('#app')
