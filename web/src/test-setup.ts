import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach } from "vitest"
import i18n from "@/i18n"

beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage("zh-CN")
})

afterEach(cleanup)

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
