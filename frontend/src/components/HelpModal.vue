<!-- Copyright (c) 2026, Sanjay Kumar and contributors -->
<!-- For license information, please see license.txt -->
<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 flex items-center justify-center"
      @keydown.escape="close"
    >
      <!-- Backdrop -->
      <div
        class="absolute inset-0 bg-black/40 dark:bg-black/60"
        @click="close"
      ></div>

      <!-- Modal -->
      <div
        class="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4 border border-gray-200 dark:border-gray-700"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-2">
            <HelpCircle :size="20" class="text-blue-600 dark:text-blue-400" />
            <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-100">Help & Reference</h2>
          </div>
          <button
            @click="close"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X :size="18" class="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b border-gray-200 dark:border-gray-700 px-6">
          <button
            @click="activeTab = 'prompts'"
            :class="[
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === 'prompts'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            ]"
          >
            <span class="flex items-center gap-1.5">
              <MessageSquare :size="14" />
              Sample Prompts
            </span>
          </button>
          <button
            @click="activeTab = 'mentions'"
            :class="[
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === 'mentions'
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            ]"
          >
            <span class="flex items-center gap-1.5">
              <AtSign :size="14" />
              @Mention Reference
            </span>
          </button>
        </div>

        <!-- Tab Content -->
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <!-- Sample Prompts Tab -->
          <div v-if="activeTab === 'prompts'" class="space-y-5">
            <!-- Loading state -->
            <div v-if="loading" class="flex items-center justify-center py-12">
              <div class="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent"></div>
              <span class="ml-3 text-sm text-gray-500 dark:text-gray-400">Loading prompts...</span>
            </div>

            <!-- Error state -->
            <div v-else-if="loadError" class="text-center py-12">
              <p class="text-sm text-red-500 dark:text-red-400">{{ loadError }}</p>
              <button @click="fetchPrompts" class="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Retry
              </button>
            </div>

            <!-- Prompt categories -->
            <div v-else v-for="category in samplePrompts" :key="category.category">
              <div class="flex items-center gap-2 mb-2">
                <component :is="getCategoryIcon(category.category)" :size="16" class="text-gray-500 dark:text-gray-400" />
                <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  {{ category.category }}
                </h3>
              </div>
              <div class="space-y-1.5">
                <button
                  v-for="prompt in category.prompts"
                  :key="prompt.text"
                  @click="selectPrompt(prompt.text)"
                  class="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                >
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400">
                      {{ prompt.text }}
                    </span>
                    <span :class="typeBadgeClass(prompt.type)" class="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0">
                      {{ prompt.type }}
                    </span>
                  </div>
                  <p v-if="prompt.expected" class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
                    {{ prompt.expected }}
                  </p>
                </button>
              </div>
            </div>
          </div>

          <!-- @Mention Reference Tab -->
          <div v-if="activeTab === 'mentions'" class="space-y-4">
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Type <kbd class="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 font-mono">@</kbd>
              in the chat input to filter by context. Mentions help the AI scope queries to specific companies, date ranges, or dimensions.
            </p>
            <div class="space-y-3">
              <div
                v-for="mention in mentionReference"
                :key="mention.mention"
                class="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
              >
                <div class="flex items-start gap-3">
                  <code class="text-sm font-mono font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded flex-shrink-0">
                    {{ mention.mention }}
                  </code>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-gray-700 dark:text-gray-300">{{ mention.description }}</p>
                    <button
                      @click="selectPrompt(mention.example)"
                      class="mt-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer italic"
                      :title="'Use this example'"
                    >
                      e.g. "{{ mention.example }}"
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
          <template v-if="activeTab === 'prompts'">
            Click a prompt to use it. Results depend on your ERPNext data and enabled tools.
          </template>
          <template v-else>
            Click an example to populate the input. Mention values are loaded from your ERPNext site.
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import {
  HelpCircle, X, TrendingUp, DollarSign, Users, Target,
  Package, ShoppingCart, MessageSquare, AtSign, Settings,
  FileText, BarChart3, Building2, Wrench,
} from 'lucide-vue-next'
import { chatAPI } from '../utils/api.js'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'select-prompt'])

const activeTab = ref('prompts')
const samplePrompts = ref([])
const loading = ref(false)
const loadError = ref('')
let fetched = false

// Icon mapping — category heading (from markdown H2) → lucide icon component
const categoryIcons = {
  'sales': TrendingUp,
  'selling': TrendingUp,
  'finance': DollarSign,
  'accounting': DollarSign,
  'hr': Users,
  'hrms': Users,
  'crm': Target,
  'stock': Package,
  'inventory': Package,
  'purchasing': ShoppingCart,
  'buying': ShoppingCart,
  'operations': Settings,
  'general': Wrench,
  'document processing': FileText,
  'idp': FileText,
  'predictive': BarChart3,
  'predictive analytics': BarChart3,
  'multi-company': Building2,
}

function getCategoryIcon(categoryName) {
  const lower = categoryName.toLowerCase()
  // Try exact match first, then check if any key is contained in the category name
  for (const [key, icon] of Object.entries(categoryIcons)) {
    if (lower.includes(key)) return icon
  }
  return Settings
}

// @Mention reference (static — these are UI-level docs, not data)
const mentionReference = [
  {
    mention: '@company',
    description: 'Select a specific company to scope your query. Useful in multi-company setups.',
    example: 'Show total revenue for @company Acme Corp',
  },
  {
    mention: '@period',
    description: 'Date range presets — This Week, This Month, Last Month, This Quarter, Last Quarter, This Fiscal Year, Last Fiscal Year, or YTD.',
    example: 'Show sales trend in @period Last Quarter',
  },
  {
    mention: '@cost_center',
    description: 'Filter results by a specific cost center.',
    example: 'Show expenses for @cost_center Main - AC',
  },
  {
    mention: '@department',
    description: 'Filter by department for HR or expense queries.',
    example: 'Show headcount in @department Engineering',
  },
  {
    mention: '@warehouse',
    description: 'Filter stock queries by warehouse location.',
    example: 'Show stock balance in @warehouse Stores - AC',
  },
  {
    mention: '@customer',
    description: 'Reference a specific customer in sales or CRM queries.',
    example: 'Show all invoices for @customer John Doe',
  },
  {
    mention: '@item',
    description: 'Reference a specific item in stock or sales queries.',
    example: 'What is the stock level for @item Widget A?',
  },
  {
    mention: '@accounting_dimension',
    description: 'Custom accounting dimensions configured in your ERPNext site (e.g., Branch, Project).',
    example: 'Show revenue by @accounting_dimension Branch',
  },
]

const typeBadgeClass = (type) => {
  const classes = {
    table: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
    chart: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
    number: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
    text: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400',
    mixed: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
    record: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400',
    search: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400',
  }
  // Handle compound types like "table + record"
  const primary = type.split('+')[0].split('/')[0].trim()
  return classes[primary] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
}

async function fetchPrompts() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await chatAPI.getSamplePrompts()
    if (result?.success && result.categories) {
      samplePrompts.value = result.categories
      fetched = true
    } else {
      loadError.value = result?.error || 'Failed to load sample prompts'
    }
  } catch (err) {
    loadError.value = 'Could not connect to server'
  } finally {
    loading.value = false
  }
}

// Fetch prompts on first modal open
watch(() => props.modelValue, (visible) => {
  if (visible && !fetched) {
    fetchPrompts()
  }
})

const selectPrompt = (text) => {
  emit('select-prompt', text)
  close()
}

const close = () => {
  emit('update:modelValue', false)
}
</script>
