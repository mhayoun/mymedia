// The photos chosen in Google's window (Google Picker), shared by "My photos in Google Drive" (import) and
// "Save to the disk": chosen once, saved then imported without choosing them again. By folder of Drive, each
// with a name (its album, its folder on the disk): the folder's own when MyMedia may read it, else one from the
// photos' dates, or the folder chosen in Google's window ("Use the folder's name").

import { ImagePlus, Loader2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { loadConfig } from '../config'
import { getFile, type DriveFile } from '../drive/api'
import { loadPicker, pickMyDriveFolder, pickMyDriveMedia } from '../drive/picker'
import { useFormat } from '../i18n/format'
import { markDuplicates, takenAtOf } from '../import/fromDrive'
import { describePicked, entriesOf, nameFromDates, type PickedGroup } from '../import/fromMyDrive'

export type Group = PickedGroup & { album: string }

export interface DrivePick {
  groups: Group[]
  /** Those already in MyMedia (same fingerprint, or twice in the choice). */
  dup: Set<string>
  unreadable: number
  reading: number | null
  error: string | null
  ready: boolean
  pick(): Promise<void>
  readFolderName(key: string): Promise<void>
  setAlbum(key: string, album: string): void
}

export const sizeOf = (files: DriveFile[]) => files.reduce((n, f) => n + Number(f.size ?? 0), 0)

export function useDrivePick(): DrivePick {
  const { t, i18n } = useTranslation()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [dup, setDup] = useState<Set<string>>(new Set())
  const [reading, setReading] = useState<number | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadPicker().catch(() => undefined)
    loadConfig().then((c) => setApiKey(c.googleApiKey ?? ''))
  }, [])

  async function pick() {
    setError(null)
    if (!apiKey) return setError(t('myDrive.noKey'))
    try {
      const picked = await pickMyDriveMedia(apiKey, { locale: i18n.language, title: t('myDrive.pickerTitle') })
      if (!picked?.length) return
      setReading(0)
      const known = new Set(groups.flatMap((g) => g.files.map((f) => f.id)))
      const { groups: more, unreadable: bad } = await describePicked(
        picked.filter((p) => !known.has(p.id)),
        setReading,
      )
      setUnreadable((n) => n + bad)
      const merged: Group[] = groups.map((g) => ({ ...g }))
      for (const g of more) {
        const same = merged.find((m) => m.key === g.key)
        if (same) same.files = [...same.files, ...g.files]
        else merged.push({ ...g, album: g.folderName ?? nameFromDates(g.files.map(takenAtOf)) })
      }
      setGroups(merged)
      setDup(await markDuplicates(entriesOf(merged)))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    setReading(null)
  }

  /**
   * The folder of a group chosen in Google's window: MyMedia may then read its name (Google does not give it
   * with the photos). Another folder chosen: its name is used all the same (the user's choice).
   */
  async function readFolderName(key: string) {
    setError(null)
    if (!apiKey) return setError(t('myDrive.noKey'))
    try {
      const f = await pickMyDriveFolder(apiKey, { locale: i18n.language, title: t('myDrive.folderPickerTitle') })
      if (!f) return
      const name = f.name || (await getFile(f.id, 'id,name')).name
      setGroups((cur) => cur.map((g) => (g.key === key || g.key === f.id ? { ...g, album: name, ...(g.key === f.id ? { folderName: name } : {}) } : g)))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
  }

  const setAlbum = (key: string, album: string) => setGroups((cur) => cur.map((g) => (g.key === key ? { ...g, album } : g)))

  return { groups, dup, unreadable, reading, error, ready: apiKey !== null, pick, readFolderName, setAlbum }
}

/** Step "The photos": Google's window, what was chosen. */
export function PickedPhotos({ pick, count, size, children }: { pick: DrivePick; count: number; size: number; children?: ReactNode }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  return (
    <section className="disk-sync-part">
      <h3>{t('myDrive.step1')}</h3>
      <p className="hint">{t('myDrive.short')}</p>
      <button className="btn" onClick={() => void pick.pick()} disabled={!pick.ready || pick.reading !== null}>
        <ImagePlus size={16} /> {pick.groups.length ? t('myDrive.pickMore') : t('myDrive.pick')}
      </button>
      {pick.reading !== null && (
        <p aria-live="polite">
          <Loader2 size={16} className="spin" /> {t('myDrive.reading', { count: pick.reading })}
        </p>
      )}
      {pick.unreadable > 0 && <p className="error-text">{t('myDrive.unreadable', { count: pick.unreadable })}</p>}
      {pick.groups.length > 0 && (
        <p>
          <strong>{t('myDrive.chosen', { count, size: fmt.bytes(size) })}</strong>
        </p>
      )}
      {children}
      {pick.error && <p className="error-text">{pick.error}</p>}
    </section>
  )
}

/** A group's name (its album, its folder on the disk), with "Use the folder's name" when Google did not give it. */
export function GroupName({ pick, g, label, files, after }: { pick: DrivePick; g: Group; label: string; files: DriveFile[]; after?: ReactNode }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  return (
    <div className="field">
      <span>
        {g.folderName ? t('myDrive.fromFolder', { name: g.folderName }) : t('myDrive.fromUnknown')} ·{' '}
        {t('myDrive.files', { count: files.length, size: fmt.bytes(sizeOf(files)) })}
      </span>
      <input
        value={g.album}
        required
        placeholder={label}
        aria-label={label}
        aria-invalid={!g.album.trim()}
        onChange={(e) => pick.setAlbum(g.key, e.target.value)}
      />
      {!g.folderName && (
        <span className="row">
          <span className="hint">{t('myDrive.nameFromDates')}</span>
          <button className="btn small" onClick={() => void pick.readFolderName(g.key)}>
            {t('myDrive.readFolderName')}
          </button>
        </span>
      )}
      {!g.album.trim() && <span className="hint">{t('myDrive.albumNeeded')}</span>}
      {after}
    </div>
  )
}
