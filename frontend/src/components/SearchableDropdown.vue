<!-- Copyright (c) 2026, Sanjay Kumar and contributors -->
<!-- For license information, please see license.txt -->
<!--
  SearchableDropdown.vue

  Lightweight Frappe Link-field autocomplete for use inside table cells.
  Searches via Frappe's built-in search_link endpoint.

  Props:
    - doctype: which DocType to search (e.g. "Item", "UOM", "Item Group")
    - modelValue: current selected value (v-model)
    - disabled: render as plain text instead of input
    - placeholder: input placeholder text
-->
<template>
  <div v-if="!disabled" class="relative searchable-dropdown">
    <input
      ref="inputRef"
      v-model="localValue"
      @input="handleInput"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown="handleKeydown"
      :placeholder="placeholder"
      class="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded
             bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300
             w-full focus:ring-1 focus:ring-blue-400 outline-none"
    />
    <div
      v-if="showDropdown && options.length > 0"
      class="absolute top-full left-0 mt-0.5 bg-white dark:bg-gray-800
             border border-gray-200 dark:border-gray-700 rounded shadow-lg
             max-h-40 overflow-y-auto z-50 min-w-[200px]"
      style="width: max-content;"
    >
      <div
        v-for="(opt, idx) in options"
        :key="opt.value"
        @mousedown.prevent="selectOption(opt.value)"
        class="px-2 py-1.5 text-xs cursor-pointer"
        :class="idx === highlightedIdx
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'"
      >
        <span>{{ opt.value }}</span>
        <span
          v-if="opt.description"
          class="ml-1.5 text-gray-400 dark:text-gray-500"
        >
          {{ opt.description }}
        </span>
      </div>
    </div>
  </div>
  <span v-else class="text-xs text-gray-700 dark:text-gray-300">
    {{ modelValue || '—' }}
  </span>
</template>

<script setup>
import { ref, watch } from 'vue'
import { chatAPI } from '../utils/api'

const props = defineProps({
  doctype: { type: String, required: true },
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: 'Search...' },
})

const emit = defineEmits(['update:modelValue'])

const inputRef = ref(null)
const localValue = ref(props.modelValue || '')
const options = ref([])
const showDropdown = ref(false)
const highlightedIdx = ref(-1)
const isSearching = ref(false)

let debounceTimer = null

// Sync localValue when modelValue prop changes externally
watch(() => props.modelValue, (val) => {
  if (val !== localValue.value) {
    localValue.value = val || ''
  }
})

function handleInput() {
  debouncedSearch(localValue.value)
}

function handleFocus() {
  // Show results on focus (search with current value)
  debouncedSearch(localValue.value)
}

function handleBlur() {
  // Delay close to allow click on dropdown items
  setTimeout(() => {
    showDropdown.value = false
    highlightedIdx.value = -1
  }, 200)
}

function handleKeydown(e) {
  if (!showDropdown.value || options.value.length === 0) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      debouncedSearch(props.modelValue || '')
    }
    return
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      highlightedIdx.value = Math.min(highlightedIdx.value + 1, options.value.length - 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      highlightedIdx.value = Math.max(highlightedIdx.value - 1, 0)
      break
    case 'Enter':
      e.preventDefault()
      if (highlightedIdx.value >= 0 && highlightedIdx.value < options.value.length) {
        selectOption(options.value[highlightedIdx.value].value)
      }
      break
    case 'Escape':
      showDropdown.value = false
      highlightedIdx.value = -1
      break
  }
}

function selectOption(value) {
  localValue.value = value
  emit('update:modelValue', value)
  showDropdown.value = false
  highlightedIdx.value = -1
}

function debouncedSearch(txt) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => fetchOptions(txt), 300)
}

async function fetchOptions(txt) {
  if (isSearching.value) return
  isSearching.value = true

  try {
    const results = await chatAPI.searchLinkValues(props.doctype, txt || '', 10)
    // search_link returns [{value, description}, ...]
    options.value = Array.isArray(results)
      ? results.map(r => (typeof r === 'string' ? { value: r, description: '' } : r))
      : []
    showDropdown.value = options.value.length > 0
    highlightedIdx.value = -1
  } catch (err) {
    console.error('SearchableDropdown fetch error:', err)
    options.value = []
    showDropdown.value = false
  } finally {
    isSearching.value = false
  }
}

// Close dropdown when disabled changes
watch(() => props.disabled, (val) => {
  if (val) {
    showDropdown.value = false
  }
})
</script>
