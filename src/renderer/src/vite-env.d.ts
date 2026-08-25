/// <reference types="vite/client" />

declare global {
  interface Window {
    studyNest: import('../../shared/ipc.js').StudyNestApi;
  }
}

export {};