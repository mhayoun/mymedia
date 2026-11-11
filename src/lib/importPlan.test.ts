import { describe, expect, it } from 'vitest'
import { albumOf, estimateImport, planAlbums, type WalkedFile } from './importPlan'

const f = (path: string, size: number, type: WalkedFile['type'] = 'photo'): WalkedFile => {
  const parts = path.split('/')
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1], size, type }
}

describe('importPlan', () => {
  it('finds the album below the containers, camera folders left out', () => {
    expect(albumOf(['My Pictures2004', 'mariage batson', '876___09'])).toEqual({ name: 'mariage batson', dir: ['My Pictures2004', 'mariage batson'] })
    expect(albumOf(['My Pictures', '2013_02_21', '442___02Pourim5773'])).toEqual({ name: '2013_02_21', dir: ['My Pictures', '2013_02_21'] })
    expect(albumOf(['My Pictures2004'])).toBeNull()
    expect(albumOf(['DCIM', '100JLCAM'])).toBeNull()
    expect(albumOf(['My Pictures', 'DCIM__', '890___08'])).toBeNull()
    expect(albumOf(['My Pictures', 'photos01'])).toEqual({ name: 'photos01', dir: ['My Pictures', 'photos01'] })
  })

  it('one album for the same name in several containers, with its sizes', () => {
    const { albums, loose, looseDirs } = planAlbums([
      f('My Pictures/anniv papa/a.jpg', 100),
      f('My Pictures2005/anniv papa/b.mp4', 300, 'video'),
      f('My Pictures2005/anniv papa/sub/c.jpg', 50),
      f('My Pictures2004/d.jpg', 10),
      f('My Pictures/DCIM__/890___08/e.jpg', 10),
      f('My Pictures/DCIM__/884___06/g.jpg', 10),
    ])
    expect(albums).toEqual([
      { name: 'anniv papa', dirs: [['My Pictures', 'anniv papa'], ['My Pictures2005', 'anniv papa']], files: 3, bytes: 450, photoBytes: 150, videoBytes: 300 },
    ])
    expect(loose).toEqual({ files: 3, bytes: 30, photoBytes: 30, videoBytes: 0 })
    expect(looseDirs).toEqual([
      { path: ['My Pictures', 'DCIM__'], files: 2, camera: true },
      { path: ['My Pictures2004'], files: 1, camera: false },
    ])
  })

  it('estimates the Drive space and the time, then uses what was measured', () => {
    const s = { files: 1000, bytes: 10e9, photoBytes: 6e9, videoBytes: 4e9 }
    expect(estimateImport(s, false).driveBytes).toBe(10e9)
    const first = estimateImport(s, true)
    expect(first.driveBytes).toBe(6e9 * 0.35 + 4e9 * 0.3)
    expect(first.measured).toBe(false)
    const after = estimateImport(s, true, { before: 1e9, after: 0.25e9, ms: 600_000 })
    expect(after).toEqual({ driveBytes: 2.5e9, ms: 6_000_000, measured: true })
  })
})
