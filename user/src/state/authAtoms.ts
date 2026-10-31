import { atom } from 'jotai'
import type { User } from '@/types'

export const userAtom = atom<User | null>(null)
export const tokenAtom = atom<string | null>(null)
export const isAuthModalOpenAtom = atom<boolean>(false)
export const authModalModeAtom = atom<'login' | 'register'>('login')

export const isAuthenticatedAtom = atom((get) => !!get(userAtom) && !!get(tokenAtom))


