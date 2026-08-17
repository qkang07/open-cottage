import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import './custom.css'
import HomeLanding from './components/HomeLanding.vue'
import ScreenshotPlaceholder from './components/ScreenshotPlaceholder.vue'
import StepList from './components/StepList.vue'
import Callout from './components/Callout.vue'
import DocImagePreview from './components/DocImagePreview.vue'
import ProjectLinks from './components/ProjectLinks.vue'
import DocRedirect from './components/DocRedirect.vue'
import StoryLead from './components/StoryLead.vue'
import StoryBeat from './components/StoryBeat.vue'
import NextReading from './components/NextReading.vue'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(DocImagePreview),
    }),
  enhanceApp({ app }) {
    app.component('HomeLanding', HomeLanding)
    app.component('ScreenshotPlaceholder', ScreenshotPlaceholder)
    app.component('StepList', StepList)
    app.component('Callout', Callout)
    app.component('ProjectLinks', ProjectLinks)
    app.component('DocRedirect', DocRedirect)
    app.component('StoryLead', StoryLead)
    app.component('StoryBeat', StoryBeat)
    app.component('NextReading', NextReading)
  },
}
