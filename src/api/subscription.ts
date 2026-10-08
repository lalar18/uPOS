import { readJson } from './http'

export interface Plan {
  id: string
  name: string
  maxUsers: number
  maxAdmins: number | null // null: any of the users may be admins
  maxProducts: number
}

export interface Subscription {
  plan: Plan
  usage: { users: number; admins: number; products: number }
  plans: Plan[] // every plan, cheapest first
}

export const getSubscription = async (): Promise<Subscription> => readJson(await fetch('/api/subscription'))

/** "1 admin + 2 users", "5 users", "1 user" */
export function describeSeats(plan: Plan): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (plan.maxAdmins === null || plan.maxAdmins >= plan.maxUsers) return plural(plan.maxUsers, 'user')
  return `${plural(plan.maxAdmins, 'admin')} + ${plural(plan.maxUsers - plan.maxAdmins, 'user')}`
}
