import { defineStore } from 'pinia'
import { authApi } from '../api'

interface UserInfo {
  id: number
  username: string
  realName: string
  email?: string
  phone?: string
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null') as UserInfo | null,
    permissions: JSON.parse(localStorage.getItem('permissions') || '[]') as string[],
    roles: JSON.parse(localStorage.getItem('roles') || '[]') as string[],
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) => state.roles.includes('ADMIN'),
  },
  actions: {
    async login(username: string, password: string) {
      const res: any = await authApi.login({ username, password })
      const { token, user, permissions, roles } = res.data
      this.token = token
      this.user = user
      this.permissions = permissions
      this.roles = roles
      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify(user))
      localStorage.setItem('permissions', JSON.stringify(permissions))
      localStorage.setItem('roles', JSON.stringify(roles))
    },
    logout() {
      this.token = ''
      this.user = null
      this.permissions = []
      this.roles = []
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('permissions')
      localStorage.removeItem('roles')
    },
    hasPermission(code: string) {
      return this.isAdmin || this.permissions.includes(code)
    },
  },
})