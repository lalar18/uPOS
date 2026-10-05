<script setup lang="ts">
import { computed } from 'vue'
import type { User } from '@/auth'

const props = withDefaults(defineProps<{ user: User | null; size?: number; radius?: string }>(), {
  size: 32,
  radius: '8px',
})

const initials = computed(() =>
  (props.user?.fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join(''),
)

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: props.radius,
  fontSize: `${Math.round(props.size * 0.4)}px`,
}))
</script>

<template>
  <img v-if="user?.avatarUrl" :src="user.avatarUrl" :alt="user.fullName" class="user-avatar" :style="style" />
  <span v-else class="user-avatar user-avatar-initials bg-primary" :style="style">{{ initials }}</span>
</template>

<style scoped>
.user-avatar {
  flex-shrink: 0;
  object-fit: cover;
}

.user-avatar-initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 600;
  line-height: 1;
}
</style>
