// Folders made by cameras and phones (DCIM, 100NIKON, 876___10, 155_3107, CANONMSC…) mean nothing as
// albums: at import their photos go into the album of the folder above (or the destination itself).
// A camera folder with a name after its number ("442___02Pourim5773") keeps that name. Pure, tested.

/** Names cameras and copies give to folders, whole (any case). */
const CAMERA_NAMES = /^(dcim_*|canonmsc|misc|temp|tmp|new folder|nouveau dossier|תיקייה חדשה|originals?)$/i
/** DCF folder: 3 digits and 5 capitals ("100NIKON", "873NIKON", "100MSDCF", "100JLCAM", "171CANON", "100APPLE"). */
const DCF = /^\d{3}[A-Z0-9_]{5}$/
/** Canon's numbered folders: "876___10" (month), "155_3107" (day and month), "828_2306", "107___12". */
const NUMBERED = /^\d{3}_+\d{2,4}$/
/** The same with a name after it: "442___02Pourim5773", "108___01-Tiyoul Reuven", "125_2002Pourim". */
const NUMBERED_NAMED = /^\d{3}_+\d{2,4}[\s_-]*(\p{L}.*)$/u

/** The album name a folder gives: null for a camera folder; its own name otherwise (without the camera's number). */
export function albumNameOf(folder: string): string | null {
  const name = folder.trim()
  if (!name) return null
  if (CAMERA_NAMES.test(name) || NUMBERED.test(name)) return null
  if (DCF.test(name) && /[A-Z]/.test(name)) return null
  const named = NUMBERED_NAMED.exec(name)
  return named ? named[1].trim() : name
}

/** The albums a folder path gives, camera folders left out ("EinGuedi2015/873NIKON" → ["EinGuedi2015"]). */
export function albumPath(dirs: string[]): string[] {
  return dirs.map(albumNameOf).filter((n): n is string => n !== null)
}
