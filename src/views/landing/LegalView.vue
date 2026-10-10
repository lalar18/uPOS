<script setup lang="ts">
// Public legal pages (Terms, Privacy, Return & Refund), linked from the landing page footer.
// The text lives in legalDocs.ts.
import { computed, watch } from 'vue'
import { CONTACT_EMAIL, legalDocs, legalLinks, type LegalDocId } from './legalDocs'

const props = defineProps<{ doc: LegalDocId }>()

const page = computed(() => legalDocs[props.doc])

// The router keeps the scroll position (e.g. from the landing page footer); start each page at the top
watch(
  () => props.doc,
  () => window.scrollTo(0, 0),
  { immediate: true },
)
</script>

<template>
  <div class="legal">
    <header class="legal-header">
      <div class="container d-flex align-items-center justify-content-between gap-3">
        <RouterLink :to="{ name: 'landing' }" class="brand">
          <img src="/assets/img/usystems-pos-logo.svg" alt="USystems POS" />
        </RouterLink>
        <RouterLink :to="{ name: 'landing' }" class="btn btn-white border">
          <i class="ti ti-arrow-left me-1"></i>Back to home
        </RouterLink>
      </div>
    </header>

    <main class="container legal-body">
      <nav class="legal-tabs" aria-label="Legal pages">
        <RouterLink v-for="link in legalLinks" :key="link.id" :to="{ name: link.route }" :class="{ active: link.id === doc }">
          {{ link.label }}
        </RouterLink>
      </nav>

      <article>
        <h1>{{ page.title }}</h1>
        <p class="summary">{{ page.summary }}</p>
        <p class="updated">Last updated: {{ page.updated }}</p>

        <section v-for="section in page.sections" :key="section.heading">
          <h2>{{ section.heading }}</h2>
          <p v-for="(text, i) in section.paragraphs" :key="`p${i}`">{{ text }}</p>
          <ul v-if="section.list">
            <li v-for="(item, i) in section.list" :key="i">{{ item }}</li>
          </ul>
          <p v-for="(text, i) in section.after" :key="`a${i}`">{{ text }}</p>
        </section>
      </article>
    </main>

    <footer class="legal-footer">
      <div class="container d-flex flex-wrap align-items-center justify-content-between gap-2">
        <span>Copyright &copy; {{ new Date().getFullYear() }} USystems POS</span>
        <a :href="`mailto:${CONTACT_EMAIL}`">{{ CONTACT_EMAIL }}</a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.legal {
  --brand: #fe9f43;
  --navy: #092c4c;
  --ink: #212b36;
  --muted: #646b72;
  --line: #e6eaed;

  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: var(--ink);
}

.legal-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}

.legal-header .container {
  min-height: 68px;
}

.brand img {
  height: 40px;
}

.legal-body {
  flex: 1;
  max-width: 820px;
  padding-top: 40px;
  padding-bottom: 72px;
}

.legal-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 36px;
}

.legal-tabs a {
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  font-size: 14px;
  font-weight: 500;
  transition:
    border-color 0.2s,
    color 0.2s,
    background 0.2s;
}

.legal-tabs a:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.legal-tabs a.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

h1 {
  font-size: clamp(28px, 5vw, 40px);
  font-weight: 800;
  color: var(--navy);
  margin-bottom: 12px;
}

.summary {
  font-size: 17px;
  color: var(--muted);
  margin-bottom: 4px;
}

.updated {
  font-size: 14px;
  color: var(--muted);
  padding-bottom: 24px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}

section {
  padding-top: 24px;
}

h2 {
  font-size: 19px;
  font-weight: 700;
  color: var(--navy);
  margin-bottom: 10px;
}

section p,
section li {
  line-height: 1.7;
}

section ul {
  padding-left: 20px;
  margin-bottom: 1rem;
}

section li + li {
  margin-top: 6px;
}

.legal-footer {
  padding: 24px 0;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 14px;
}

.legal-footer a {
  color: var(--muted);
}

.legal-footer a:hover {
  color: var(--brand);
}
</style>
