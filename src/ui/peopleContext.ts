import { createContext, useContext } from 'react'
import type { People } from './usePeople'

export const PeopleContext = createContext<People | null>(null)

export function usePeopleContext(): People | null {
  return useContext(PeopleContext)
}

/** Which person's window is open (shared by the People screen and the viewer). */
export const PersonDialogContext = createContext<(personId: string) => void>(() => undefined)

export function useOpenPerson() {
  return useContext(PersonDialogContext)
}
