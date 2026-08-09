import "@testing-library/jest-dom/vitest"

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverMock })
Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, media: "", onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }) })
Element.prototype.scrollIntoView = () => undefined
Element.prototype.getAnimations = () => []
