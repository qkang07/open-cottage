<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="oc-image-preview"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogLabel"
      @click.self="closePreview"
    >
      <button
        ref="closeButton"
        class="oc-image-preview__close"
        type="button"
        aria-label="关闭图片预览"
        @click="closePreview"
      >
        <span aria-hidden="true">×</span>
      </button>

      <div class="oc-image-preview__content">
        <img
          v-if="!loadFailed"
          class="oc-image-preview__image"
          :src="imageSrc"
          :alt="imageAlt"
          @error="loadFailed = true"
        />
        <p v-else class="oc-image-preview__error">图片预览加载失败，请关闭后重试。</p>
        <p v-if="imageAlt" class="oc-image-preview__caption">{{ imageAlt }}</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'

const previewSelector = '.vp-doc img:not([data-image-preview="off"])'
const route = useRoute()

const isOpen = ref(false)
const imageSrc = ref('')
const imageAlt = ref('')
const loadFailed = ref(false)
const closeButton = ref<HTMLButtonElement | null>(null)

let sourceImage: HTMLImageElement | null = null
let previousBodyOverflow = ''

const dialogLabel = computed(() =>
  imageAlt.value ? `图片预览：${imageAlt.value}` : '图片预览',
)

function getPreviewImage(target: EventTarget | null) {
  return target instanceof HTMLImageElement && target.matches(previewSelector)
    ? target
    : null
}

function decorateImages() {
  document.querySelectorAll<HTMLImageElement>(previewSelector).forEach((image) => {
    if (!image.hasAttribute('tabindex')) image.tabIndex = 0
    if (!image.hasAttribute('role')) image.setAttribute('role', 'button')
    if (!image.hasAttribute('aria-haspopup')) image.setAttribute('aria-haspopup', 'dialog')
    if (!image.hasAttribute('aria-label')) {
      const description = image.alt.trim() || '图片'
      image.setAttribute('aria-label', `${description}，点击预览`)
    }
  })
}

async function openPreview(image: HTMLImageElement) {
  const src = image.currentSrc || image.src
  if (!src) return

  sourceImage = image
  imageSrc.value = src
  imageAlt.value = image.alt.trim()
  loadFailed.value = false
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  isOpen.value = true

  await nextTick()
  closeButton.value?.focus()
}

function closePreview(restoreFocus: boolean | Event = true) {
  if (!isOpen.value) return

  const shouldRestoreFocus = typeof restoreFocus === 'boolean' ? restoreFocus : true
  isOpen.value = false
  document.body.style.overflow = previousBodyOverflow

  if (shouldRestoreFocus && sourceImage?.isConnected) sourceImage.focus()
  sourceImage = null
}

function handleClick(event: MouseEvent) {
  const image = getPreviewImage(event.target)
  if (!image) return

  event.preventDefault()
  void openPreview(image)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab' && isOpen.value) {
    event.preventDefault()
    closeButton.value?.focus()
    return
  }

  if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault()
    closePreview()
    return
  }

  const image = getPreviewImage(event.target)
  if (!image || (event.key !== 'Enter' && event.key !== ' ')) return

  event.preventDefault()
  void openPreview(image)
}

onMounted(() => {
  decorateImages()
  document.addEventListener('click', handleClick)
  document.addEventListener('keydown', handleKeydown)
})

watch(
  () => route.path,
  async () => {
    closePreview(false)
    await nextTick()
    decorateImages()
  },
)

onUnmounted(() => {
  closePreview(false)
  document.removeEventListener('click', handleClick)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style>
.vp-doc img:not([data-image-preview='off']) {
  cursor: zoom-in;
}

.vp-doc img:not([data-image-preview='off']):focus-visible {
  outline: 3px solid var(--vp-c-brand-1);
  outline-offset: 3px;
  border-radius: 4px;
}

.oc-image-preview {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 56px 24px 24px;
  background: rgba(8, 12, 9, 0.9);
  backdrop-filter: blur(4px);
}

.oc-image-preview__content {
  display: flex;
  min-width: 0;
  max-width: 100%;
  max-height: 100%;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.oc-image-preview__image {
  display: block;
  max-width: min(96vw, 1600px);
  max-height: calc(100vh - 112px);
  object-fit: contain;
  border-radius: 6px;
  background: var(--vp-c-bg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
}

.oc-image-preview__caption,
.oc-image-preview__error {
  margin: 0;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.88rem;
  line-height: 1.5;
  text-align: center;
}

.oc-image-preview__error {
  padding: 20px 24px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
}

.oc-image-preview__close {
  position: absolute;
  top: 14px;
  right: 16px;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 1.8rem;
  line-height: 1;
}

.oc-image-preview__close:hover {
  background: rgba(255, 255, 255, 0.2);
}

.oc-image-preview__close:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .oc-image-preview {
    padding: 56px 12px 16px;
  }

  .oc-image-preview__image {
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 104px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .oc-image-preview {
    backdrop-filter: none;
  }
}
</style>
