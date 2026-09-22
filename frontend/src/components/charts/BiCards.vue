<!-- Copyright (c) 2026, Sanjay Kumar and contributors -->
<!-- For license information, please see license.txt -->
<template>
  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 my-4">
    <div
      v-for="(card, idx) in cards"
      :key="idx"
      class="rounded-xl border px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700"
    >
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {{ card.label }}
        </span>
        <component
          :is="iconComponent(card.icon)"
          :size="16"
          :class="iconColorClass(card.trend)"
        />
      </div>
      <div class="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ formatValue(card.value) }}
      </div>
      <div v-if="card.change_pct != null" class="flex items-center gap-1 mt-1">
        <TrendingUp v-if="card.change_pct > 0" :size="14" class="text-green-600 dark:text-green-400" />
        <TrendingDown v-else-if="card.change_pct < 0" :size="14" class="text-red-600 dark:text-red-400" />
        <Minus v-else :size="14" class="text-gray-400" />
        <span
          class="text-xs font-medium"
          :class="card.change_pct > 0
            ? 'text-green-600 dark:text-green-400'
            : card.change_pct < 0
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-500 dark:text-gray-400'"
        >
          {{ card.change_pct > 0 ? '+' : '' }}{{ card.change_pct }}%
          <span v-if="card.change_period" class="text-gray-400 dark:text-gray-500 ml-0.5">{{ card.change_period }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  TrendingUp, TrendingDown, Minus, Wallet,
  BarChart3, ArrowUpRight, ArrowDownRight,
} from 'lucide-vue-next'

defineProps({
  cards: {
    type: Array,
    required: true,
  },
  currency: {
    type: String,
    default: '',
  },
})

const iconMap = {
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  'bar-chart-3': BarChart3,
  'wallet': Wallet,
  'arrow-up-right': ArrowUpRight,
  'arrow-down-right': ArrowDownRight,
}

const iconComponent = (name) => iconMap[name] || BarChart3

const iconColorClass = (trend) => {
  if (trend === 'up') return 'text-green-500 dark:text-green-400'
  if (trend === 'down') return 'text-red-500 dark:text-red-400'
  return 'text-gray-400 dark:text-gray-500'
}

const formatValue = (value) => {
  if (value == null) return '—'
  const num = Number(value)
  if (isNaN(num)) return value
  if (Math.abs(num) >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(num) >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
</script>
