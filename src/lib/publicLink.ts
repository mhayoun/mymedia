// A MyMedia shared by a link: its address carries the library's root folder (?view=<id>).

/** The address of a library shared by a link: MyMedia shows it without signing in (ui/PublicLibrary). */
export const publicLink = (rootId: string, origin = location.origin) => `${origin}/?view=${encodeURIComponent(rootId)}`

/** The library this page shows by a link, or null (the app as usual). */
export function publicLibraryId(search = location.search): string | null {
  const id = new URLSearchParams(search).get('view')
  return id && /^[\w-]{10,100}$/.test(id) ? id : null
}
