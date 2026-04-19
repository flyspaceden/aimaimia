const LOCAL_API_BASE_URL = 'http://localhost:3000/api/v1'
const PROD_API_BASE_URL = 'https://api.ai-maimai.com/api/v1'

export function getApiBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  if (envBaseUrl) return envBaseUrl

  if (import.meta.env.DEV) return LOCAL_API_BASE_URL

  return PROD_API_BASE_URL
}
