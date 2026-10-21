import { Eye, FolderOpen, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { findSharedLibraries, openLibrary, type SharedLibrary } from '../sync/library'

/** The MyMedia shared with this account, each opened with one tap (and the user's own, from a shared one). */
export function SharedLibraries({ hideEmpty = false, intro }: { hideEmpty?: boolean; intro?: string }) {
  const { t } = useTranslation()
  const user = useApp((s) => s.user)
  const rootId = useApp((s) => s.rootId)
  const shared = useApp((s) => s.shared)
  const [list, setList] = useState<SharedLibrary[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    findSharedLibraries().then(
      (l) => alive && setList(l),
      (e) => {
        console.warn('[MyMedia] shared libraries', e)
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  if (!user) return null
  const others = list?.filter((l) => l.id !== rootId) ?? []
  if (hideEmpty && !shared && (!list || !others.length)) return null
  const owner = (l: SharedLibrary) => l.ownerName ?? l.ownerEmail ?? l.name

  return (
    <div className="shared-libraries">
      {intro && <p>{intro}</p>}
      {shared && (
        <button className="btn" onClick={() => openLibrary(user.email, null)}>
          <FolderOpen size={16} /> {t('library.backToMine')}
        </button>
      )}
      {!list && !failed && (
        <p className="hint">
          <Loader2 size={14} className="spin" /> {t('library.searching')}
        </p>
      )}
      {list && !others.length && !shared && <p className="hint">{t('library.none')}</p>}
      {others.map((l) => (
        <button key={l.id} className="btn" onClick={() => openLibrary(user.email, l.id)}>
          <Eye size={16} /> <bdi>{t('library.sharedOf', { owner: owner(l) })}</bdi>
          {l.readOnly && <span className="tag">{t('library.readOnlyTag')}</span>}
        </button>
      ))}
    </div>
  )
}
