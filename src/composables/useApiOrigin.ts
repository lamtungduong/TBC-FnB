export function useApiOrigin() {
  function apiFetch<T = unknown>(
    path: string,
    options?: Record<string, any>
  ): Promise<T> {
    return $fetch<T>(path, {
      ...options
    })
  }

  /** Dùng cho img src (vd. /api/blob-image?url=...). */
  function getApiUrl(path: string): string {
    return path.startsWith('/') ? path : `/${path}`
  }

  return {
    apiFetch,
    getApiUrl
  }
}
