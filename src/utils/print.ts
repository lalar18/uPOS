// Printing a document (invoice, quotation, receipt) without the header and sidebar.
// The page teleports its printable copy into a `.print-root` element on <body>; while the
// page is mounted, printing shows only that element (rules in styles/app.css).
import { onBeforeUnmount, onMounted, watchEffect } from 'vue'

/** Call from a page's setup. `pageRule` returns its @page rule, e.g. "@page { size: A4; margin: 12mm; }". */
export function usePrintRoot(pageRule: () => string) {
  // The page size has to be set with an @page rule, which can't be scoped to a component
  const style = document.createElement('style')
  watchEffect(() => {
    style.textContent = pageRule()
  })

  onMounted(() => {
    document.head.appendChild(style)
    document.body.classList.add('has-print-root')
  })

  onBeforeUnmount(() => {
    style.remove()
    document.body.classList.remove('has-print-root')
  })
}
