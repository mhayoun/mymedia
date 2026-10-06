import { createContext, useContext } from 'react'
import type { Library } from './useLibrary'

export const LibraryContext = createContext<Library | null>(null)

export function useLibraryContext(): Library | null {
  return useContext(LibraryContext)
}
