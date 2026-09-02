import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach } from "vitest"
import i18n from "@/i18n"

beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage("zh-CN")
})

// i18n is a module singleton shared by every file in the run, and
// changeLanguage is async. A test that switches to English and ends before its
// promise settles used to hand the next test an English console: two
// unrelated tests failed roughly one full run in three. Draining it here means
// the reset happens while the test that asked for it is still the current one.
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverMock })
Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserverMock,
})

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: () => undefined,
})

Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  value: () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 300,
    width: 800,
    height: 300,
    toJSON: () => ({}),
  }),
})

Object.defineProperty(Element.prototype, "getAnimations", {
  value: () => [],
})
