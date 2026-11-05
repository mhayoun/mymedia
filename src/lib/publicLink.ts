// A MyMedia shared by a link: its address carries the shared folders (?view=<id>[,<id>…]): the whole
// library (its root folder), one album, or several albums chosen together.

const ID = /^[\w-]{10,100}$/
/** An address stays short enough for any messenger. */
export const MAX_LINK_FOLDERS = 40

/** The address that shows these folders without signing in (ui/PublicLibrary). */
export const publicLink = (ids: string | string[], origin = location.origin) =>
  `${origin}/?view=${[ids].flat().map(encodeURIComponent).join(',')}`

/** The folders this page shows by a link, or null (the app as usual). */
export function publicLibraryIds(search = location.search): string[] | null {
  const ids = (new URLSearchParams(search).get('view') ?? '').split(',').filter(Boolean)
  return ids.length && ids.length <= MAX_LINK_FOLDERS && ids.every((id) => ID.test(id)) ? [...new Set(ids)] : null
}
