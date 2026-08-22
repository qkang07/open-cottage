<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vitepress'

const preferenceKey = 'open-cottage-docs.locale'
const englishPrefix = '/en'
const router = useRouter()

function localeFromPath(pathname: string) {
  return pathname === englishPrefix || pathname.startsWith(`${englishPrefix}/`)
    ? 'en'
    : 'zh-CN'
}

function preferredLocale() {
  const saved = window.localStorage.getItem(preferenceKey)
  if (saved === 'en' || saved === 'zh-CN') return saved

  const browserLanguages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  const detected = browserLanguages.some((language) => language.toLowerCase().startsWith('zh'))
    ? 'zh-CN'
    : 'en'

  window.localStorage.setItem(preferenceKey, detected)
  return detected
}

function localizedPath(pathname: string, locale: string) {
  const currentLocale = localeFromPath(pathname)
  if (currentLocale === locale) return pathname

  if (locale === 'en') {
    return pathname === '/' ? '/en/' : `${englishPrefix}${pathname}`
  }

  const chinesePath = pathname.slice(englishPrefix.length)
  return chinesePath || '/'
}

function persistLocaleFromLanguageMenu(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return

  const link = target.closest(
    '.VPNavBarTranslations a, .VPNavBarExtra .translations a, .VPNavScreenTranslations a',
  )
  if (!(link instanceof HTMLAnchorElement)) return

  const locale = localeFromPath(new URL(link.href, window.location.href).pathname)
  window.localStorage.setItem(preferenceKey, locale)
}

onMounted(() => {
  document.addEventListener('click', persistLocaleFromLanguageMenu, true)

  const currentPath = window.location.pathname
  const isLanguageEntry = currentPath === '/' || currentPath === '/en' || currentPath === '/en/'
  if (!isLanguageEntry) return

  const locale = preferredLocale()
  const targetPath = localizedPath(currentPath, locale)
  if (targetPath !== currentPath) {
    void router.go(`${targetPath}${window.location.search}${window.location.hash}`)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', persistLocaleFromLanguageMenu, true)
})
</script>

<template><span hidden /></template>
