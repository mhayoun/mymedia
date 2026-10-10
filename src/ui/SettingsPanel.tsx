import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { db } from '../db/db'
import { renameFile } from '../drive/api'
import { changeLanguage, LANGUAGES } from '../i18n'
import { signOut } from '../session'
import { DEFAULT_COMPRESS, type CompressSettings, type KeepOriginal } from '../lib/compressPlan'
import { ORIGINS } from '../lib/media'
import { useApp, type Language } from '../store'
import { rebuildIndex } from '../ml/indexer'
import { syncNow } from '../sync/engine'
import { useFormat } from '../i18n/format'
import { ConfirmDialog, PromptDialog } from './Dialog'
import { deleteAllFaceData } from '../faces/store'
import { usePeopleContext } from './peopleContext'
import { KatiaDialog } from './KatiaDialog'
import { TransferDialog } from './TransferDialog'
import { clearMediaCaches } from '../sync/previews'

export function SettingsPanel() {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const user = useApp((s) => s.user)
  const rootId = useApp((s) => s.rootId)
  const set = useApp((s) => s.set)
  const [renaming, setRenaming] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [rebuilt, setRebuilt] = useState(false)
  const [deleteFaces, setDeleteFaces] = useState(false)
  const [katia, setKatia] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const people = usePeopleContext()
  const fmt = useFormat()
  const indexing = useApp((s) => s.indexing)
  const close = () => set({ settingsOpen: false })

  const c = settings.compress
  const setC = (patch: Partial<CompressSettings>) => updateSettings({ compress: { ...c, ...patch } })

  const setLanguage = (lang: Language) => {
    updateSettings({ language: lang })
    void changeLanguage(lang)
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
        <header>
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X />
          </button>
        </header>

        <section>
          <h3>{t('settings.language')}</h3>
          <div className="segmented">
            {LANGUAGES.map((l) => (
              <button key={l} lang={l} aria-pressed={settings.language === l} onClick={() => setLanguage(l)}>
                {t(`languages.${l}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>{t('settings.loading')}</h3>
          <label className="radio-row">
            <input type="radio" name="syncMode" checked={settings.syncMode === 'auto'} onChange={() => updateSettings({ syncMode: 'auto' })} />
            {t('settings.syncAuto')}
          </label>
          <label className="radio-row">
            <input type="radio" name="syncMode" checked={settings.syncMode === 'manual'} onChange={() => updateSettings({ syncMode: 'manual' })} />
            {t('settings.syncManual')}
          </label>
          {settings.syncMode === 'auto' && (
            <>
              <label className="field" style={{ maxWidth: 220, marginBlockStart: 8 }}>
                {t('settings.syncInterval')}
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={settings.syncIntervalMin}
                  onChange={(e) => updateSettings({ syncIntervalMin: Math.min(240, Math.max(1, Number(e.target.value) || 15)) })}
                />
              </label>
              <p className="hint">{t('settings.syncAutoHint')}</p>
            </>
          )}
          <button className="btn" onClick={() => { close(); void syncNow({ full: true }) }}>
            {t('settings.rescan')}
          </button>
          <p className="hint">{t('settings.rescanHint')}</p>
        </section>

        <section>
          <h3>{t('classify.settingsTitle')}</h3>
          <label className="radio-row">
            <input type="checkbox" checked={settings.classifyAuto} onChange={(e) => updateSettings({ classifyAuto: e.target.checked })} />
            {t('classify.autoSetting')}
          </label>
          <p className="hint">{t('classify.autoSettingHint')}</p>
          <div className="row" style={{ marginBlockEnd: 8 }}>
            <label className="field" style={{ flex: 1 }}>
              {t('classify.thresholdHigh')}
              <select value={settings.thresholdHigh} onChange={(e) => updateSettings({ thresholdHigh: Number(e.target.value) })}>
                {[0.75, 0.8, 0.85, 0.9, 0.95].map((v) => (
                  <option key={v} value={v}>{fmt.percent(v)}</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              {t('classify.thresholdMedium')}
              <select value={settings.thresholdMedium} onChange={(e) => updateSettings({ thresholdMedium: Number(e.target.value) })}>
                {[0.4, 0.5, 0.6, 0.7].map((v) => (
                  <option key={v} value={v}>{fmt.percent(v)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn" onClick={() => set({ statsOpen: true, settingsOpen: false })}>
              {t('stats.title')}
            </button>
            <button
              className="btn"
              disabled={rebuilt}
              onClick={() => {
                setRebuilt(true)
                void rebuildIndex()
              }}
            >
              {t('classify.rebuild')}
            </button>
          </div>
          <p className="hint">
            {indexing
              ? t('classify.learning', { done: fmt.number(indexing.done), total: fmt.number(indexing.total) })
              : t('classify.rebuildHint')}
          </p>
        </section>

        <section>
          <h3>{t('faces.settingsTitle')}</h3>
          <label className="radio-row">
            <input type="checkbox" checked={settings.facesEnabled} onChange={(e) => updateSettings({ facesEnabled: e.target.checked })} />
            {t('faces.enable')}
          </label>
          <p className="hint">{t('faces.introPrivacy')}</p>
          {people && people.ready && (
            <p className="hint">
              {t('faces.stats', { named: people.named.length, groups: people.named.length + people.unnamed.length + people.single.length })}
            </p>
          )}
          <button className="btn" onClick={() => setDeleteFaces(true)}>
            {t('faces.deleteAll')}
          </button>
        </section>

        <section>
          <h3>{t('compress.settingsTitle')}</h3>
          <h4>{t('compress.autoTitle')}</h4>
          {(['ask', 'auto', 'off'] as const).map((m) => (
            <label key={m} className="radio-row">
              <input type="radio" name="autoMode" checked={c.autoMode === m} onChange={() => setC({ autoMode: m })} />
              {t(`compress.autoMode.${m}`)}
            </label>
          ))}
          <label className="radio-row">
            <input type="checkbox" checked={c.autoPhotos} onChange={(e) => setC({ autoPhotos: e.target.checked })} />
            {t('compress.autoPhotos')}
            <select value={c.autoPhotoMinMB} onChange={(e) => setC({ autoPhotoMinMB: Number(e.target.value) })} style={{ inlineSize: 'auto' }}>
              {[1, 2, 3, 5, 10].map((v) => (
                <option key={v} value={v}>{fmt.bytes(v * 1024 * 1024)}</option>
              ))}
            </select>
          </label>
          <label className="radio-row">
            <input type="checkbox" checked={c.autoVideos} onChange={(e) => setC({ autoVideos: e.target.checked })} />
            {t('compress.autoVideos')}
            <select value={c.autoVideoMinMB} onChange={(e) => setC({ autoVideoMinMB: Number(e.target.value) })} style={{ inlineSize: 'auto' }}>
              {[20, 50, 100, 200].map((v) => (
                <option key={v} value={v}>{fmt.bytes(v * 1024 * 1024)}</option>
              ))}
            </select>
          </label>
          <p className="hint">{t('compress.autoHint')}</p>
          <div className="hint">{t('compress.originsTitle')}</div>
          <div className="row" style={{ marginBlockEnd: 10 }}>
            {ORIGINS.map((o) => (
              <label key={o} className="radio-row">
                <input type="checkbox" checked={c.origins[o]} onChange={(e) => setC({ origins: { ...c.origins, [o]: e.target.checked } })} />
                {t(`origin.${o}`)}
              </label>
            ))}
          </div>

          <h4>{t('compress.photosTitle')}</h4>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              {t('compress.quality')}
              <select value={c.quality} onChange={(e) => setC({ quality: Number(e.target.value) })}>
                {[0.7, 0.8, 0.85, 0.9].map((v) => (
                  <option key={v} value={v}>{fmt.percent(v)}</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              {t('compress.maxDimension')}
              <select value={c.maxDimension} onChange={(e) => setC({ maxDimension: Number(e.target.value) })}>
                {[2048, 3000, 4000].map((v) => (
                  <option key={v} value={v}>{t('compress.pixels', { n: fmt.number(v) })}</option>
                ))}
                <option value={0}>{t('compress.unchanged')}</option>
              </select>
            </label>
          </div>
          <label className="radio-row">
            <input type="checkbox" checked={c.convertToJpeg} onChange={(e) => setC({ convertToJpeg: e.target.checked })} />
            {t('compress.convert')}
          </label>

          <h4>{t('compress.videosTitle')}</h4>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              {t('compress.videoHeight')}
              <select value={c.videoHeight} onChange={(e) => setC({ videoHeight: Number(e.target.value) as 720 | 1080 })}>
                <option value={720}>720p</option>
                <option value={1080}>1080p</option>
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              {t('compress.videoQuality')}
              <select value={c.videoQuality} onChange={(e) => setC({ videoQuality: e.target.value as CompressSettings['videoQuality'] })}>
                {(['low', 'medium', 'high'] as const).map((v) => (
                  <option key={v} value={v}>{t(`compress.vq.${v}`)}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">{t('compress.videoHint')}</p>

          <h4>{t('compress.keepTitle')}</h4>
          {(['version', 'folder', 'both'] as KeepOriginal[]).map((k) => (
            <label key={k} className="radio-row" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="keepOriginal" checked={c.keepOriginal === k} onChange={() => setC({ keepOriginal: k })} />
              <span>
                {t(`compress.keep.${k}`)}
                <br />
                <span className="hint">{t(`compress.keepHint.${k}`)}</span>
              </span>
            </label>
          ))}

          <h4>{t('compress.limitsTitle')}</h4>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              {t('compress.minSize')}
              <select value={c.minSizeKB} onChange={(e) => setC({ minSizeKB: Number(e.target.value) })}>
                {[200, 500, 1000].map((v) => (
                  <option key={v} value={v}>{fmt.bytes(v * 1024)}</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1 }}>
              {t('compress.minGain')}
              <select value={c.minGain} onChange={(e) => setC({ minGain: Number(e.target.value) })}>
                {[0.1, 0.15, 0.2, 0.3].map((v) => (
                  <option key={v} value={v}>{fmt.percent(v)}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn ghost" onClick={() => updateSettings({ compress: DEFAULT_COMPRESS })}>
            {t('compress.defaults')}
          </button>
        </section>

        <section>
          <h3>{t('katia.settingsTitle')}</h3>
          <button className="btn" onClick={() => setKatia(true)} disabled={!rootId}>
            {t('katia.open')}
          </button>
          <p className="hint">{t('katia.settingsHint')}</p>
        </section>

        <section>
          <h3>{t('transfer.title')}</h3>
          <button className="btn" onClick={() => setTransfer(true)} disabled={!rootId}>
            {t('transfer.open')}
          </button>
          <p className="hint">{t('transfer.settingsHint')}</p>
        </section>

        <section>
          <h3>{t('settings.rootFolder')}</h3>
          <div className="row">
            <bdi>{settings.rootName}</bdi>
            <button className="btn" onClick={() => setRenaming(true)} disabled={!rootId}>
              {t('common.rename')}
            </button>
          </div>
          <p className="hint">{t('settings.rootFolderHint')}</p>
        </section>

        <section>
          <h3>{t('settings.account')}</h3>
          {user && <p>{t('settings.signedInAs', { email: user.email })}</p>}
          <div className="row">
            <button className="btn" onClick={() => auth.signIn(true)}>
              {t('auth.switchAccount')}
            </button>
            <button className="btn" onClick={signOut}>
              {t('auth.signOut')}
            </button>
          </div>
        </section>

        <section>
          <h3>{t('settings.storage')}</h3>
          <button
            className="btn"
            disabled={cleared}
            onClick={async () => {
              await db().thumbs.clear()
              await clearMediaCaches()
              setCleared(true)
            }}
          >
            {t('settings.clearThumbs')}
          </button>
          <p className="hint">{t('settings.version', { version: __APP_VERSION__ })}</p>
        </section>
      </aside>

      {katia && <KatiaDialog onClose={() => setKatia(false)} />}
      {transfer && <TransferDialog onClose={() => setTransfer(false)} />}
      {deleteFaces && (
        <ConfirmDialog
          title={t('faces.deleteAllTitle')}
          text={t('faces.deleteAllText')}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={deleteAllFaceData}
          onClose={() => setDeleteFaces(false)}
        />
      )}
      {renaming && rootId && (
        <PromptDialog
          title={t('folders.renameTitle', { name: settings.rootName })}
          initial={settings.rootName}
          onSubmit={async (name) => {
            await renameFile(rootId, name)
            updateSettings({ rootName: name })
          }}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  )
}
