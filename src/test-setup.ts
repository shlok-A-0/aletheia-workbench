import '@testing-library/jest-dom/vitest';

// React Flow measures nodes with ResizeObserver / DOMMatrix, which jsdom lacks.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  class DOMMatrixStub {
    m22 = 1;
    constructor(_init?: string) {}
  }
  globalThis.DOMMatrixReadOnly = DOMMatrixStub as unknown as typeof DOMMatrixReadOnly;
}
