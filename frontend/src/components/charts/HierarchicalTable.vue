<!-- Copyright (c) 2026, Sanjay Kumar and contributors -->
<!-- For license information, please see license.txt -->
<template>
  <div class="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
    <table class="w-full text-xs">
      <thead>
        <tr class="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <th
            v-for="(header, idx) in headers"
            :key="idx"
            class="px-2 py-1.5 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap"
            :class="idx > 0 ? 'text-right' : ''"
          >
            {{ header }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, ridx) in rows"
          :key="ridx"
          :class="rowClasses(row)"
        >
          <!-- Description column with indentation -->
          <td
            class="px-2 py-1 whitespace-nowrap"
            :style="{ paddingLeft: (8 + row.level * 16) + 'px' }"
            :class="row.is_group
              ? 'font-semibold text-gray-900 dark:text-gray-100'
              : 'text-gray-700 dark:text-gray-300'"
          >
            {{ row.description }}
          </td>
          <!-- Value columns -->
          <td
            v-for="(val, vidx) in row.values"
            :key="vidx"
            class="px-2 py-1 text-right whitespace-nowrap tabular-nums"
            :class="row.is_group
              ? 'font-semibold text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-400'"
          >
            {{ formatNumber(val) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
defineProps({
  headers: {
    type: Array,
    required: true,
  },
  rows: {
    type: Array,
    required: true,
  },
})

const rowClasses = (row) => {
  const classes = ['border-b border-gray-100 dark:border-gray-800']
  if (row.is_group) {
    classes.push('bg-gray-50/60 dark:bg-gray-800/40')
  } else {
    classes.push('hover:bg-gray-50 dark:hover:bg-gray-800/30')
  }
  return classes
}

const formatNumber = (value) => {
  if (value == null || value === '') return '—'
  const num = Number(value)
  if (isNaN(num)) return value
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>
