// Copyright (c) 2026, Sanjay Kumar and contributors
// For license information, please see license.txt
/**
 * Shared marked (markdown) configuration.
 *
 * Import `renderMarkdown` wherever you need to convert markdown → HTML.
 * All links are opened in a new tab with rel="noopener noreferrer".
 */
import { marked } from 'marked'
import hljs from 'highlight.js'

marked.use({
  breaks: true,
  gfm: true,
})

/**
 * Render a markdown string to HTML.
 *
 * Post-processes the output to:
 * - Open all links in a new tab (target="_blank")
 * - Apply syntax highlighting to code blocks via highlight.js
 *
 * @param {string} content - Markdown text
 * @returns {string} HTML string
 */
export function renderMarkdown(content) {
  let html = marked(content)

  // Open all links in a new tab
  html = html.replace(
    /<a href="/g,
    '<a target="_blank" rel="noopener noreferrer" href="'
  )

  // Syntax highlighting for code blocks: <code class="language-xyz">
  html = html.replace(
    /<code class="language-(\w+)">([\s\S]*?)<\/code>/g,
    (_match, lang, code) => {
      const decoded = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      if (hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(decoded, { language: lang }).value
        return `<code class="hljs language-${lang}">${highlighted}</code>`
      }
      return `<code class="hljs">${hljs.highlightAuto(decoded).value}</code>`
    }
  )

  // Auto-right-align numeric columns in tables
  html = html.replace(/<table>([\s\S]*?)<\/table>/g, (_match, tableContent) => {
    return `<table>${autoAlignTableColumns(tableContent)}</table>`
  })

  return html
}

/**
 * Detect numeric columns in an HTML table and apply right-alignment
 * to both <th> and <td> cells in those columns.
 * A column is considered numeric if all its <td> values are numbers
 * (with optional commas, decimals, signs, currency symbols, %, or dashes).
 */
function autoAlignTableColumns(tableHtml) {
  // Extract all rows of <td> values
  const rows = []
  const tdRowRegex = /<tr>([\s\S]*?)<\/tr>/g
  let rowMatch
  while ((rowMatch = tdRowRegex.exec(tableHtml)) !== null) {
    const cells = []
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g
    let cellMatch
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].trim())
    }
    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) return tableHtml

  // Determine which columns are numeric (skip first column — usually labels)
  const numCols = rows[0].length
  const numericPattern = /^[₹$€£¥]?\s*-?\s*[\d,]+\.?\d*\s*%?$|^—$|^-$/
  const isNumeric = new Array(numCols).fill(false)
  for (let col = 1; col < numCols; col++) {
    const allNumeric = rows.every(row => {
      const val = (row[col] || '').replace(/<[^>]*>/g, '').trim()
      return val === '' || numericPattern.test(val)
    })
    if (allNumeric) isNumeric[col] = true
  }

  // Apply right-align style to numeric column headers and cells
  let colIdx = 0
  tableHtml = tableHtml.replace(/<th([^>]*)>/g, (m, attrs) => {
    const idx = colIdx++
    if (idx < numCols && isNumeric[idx]) {
      return `<th${attrs} style="text-align:right">`
    }
    return m
  })

  colIdx = 0
  tableHtml = tableHtml.replace(/<td([^>]*)>/g, (m, attrs) => {
    const idx = colIdx % numCols
    colIdx++
    if (isNumeric[idx]) {
      return `<td${attrs} style="text-align:right">`
    }
    return m
  })

  return tableHtml
}
