import { describe, expect, it } from 'vitest'
import { defaultTicks, duplicateGroups, pathKey, sameSizeFiles, type DiskCopy } from './diskDuplicates'
import type { WalkedFile } from './importPlan'

const f = (path: string, size: number): WalkedFile => {
  const parts = path.split('/')
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1], size, type: 'photo' }
}
const c = (file: WalkedFile, hash: string, modified = 0, inMyMedia = false): DiskCopy & { hash: string } => ({ file, hash, modified, inMyMedia })

describe('disk duplicates', () => {
  it('opens only the files whose size another one has', () => {
    const files = [f('neige/a.jpg', 10), f('neige/b.jpg', 10), f('neige/c.jpg', 11), f('neige/empty.jpg', 0), f('neige/e2.jpg', 0)]
    expect(sameSizeFiles(files).map((x) => x.name)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('keeps the copy MyMedia has, else the original', () => {
    const a = f('2013_neige/IMG_0093.jpg', 5)
    const b = f('2013_neige/Picture 053.jpg', 5)
    // MyMedia has the copy: it stays.
    expect(duplicateGroups([c(a, 'h', 1), c(b, 'h', 9, true)])[0].copies[0].file).toBe(b)
    // Else the camera's name, even copied later elsewhere under the other name.
    const mvi = f('2013_Pourim/MVI_0236.MOV', 5)
    const pic = f('2013_Pourim_BneBrak_Bayit/Picture 131.MOV', 5)
    expect(duplicateGroups([c(pic, 'v', 1), c(mvi, 'v', 2)])[0].copies[0].file).toBe(mvi)
    // A name of a copy ("(1)") never wins, then the first on the disk.
    const x = f('n/IMG_0147 (1).jpg', 5)
    const y = f('n/IMG_0147.jpg', 5)
    expect(duplicateGroups([c(x, 'k', 1), c(y, 'k', 3)])[0].copies[0].file).toBe(y)
    expect(duplicateGroups([c(f('n/Picture 1.jpg', 5), 'p', 3), c(f('n/Picture 2.jpg', 5), 'p', 1)])[0].copies[0].file.name).toBe('Picture 2.jpg')
  })

  it('ticks every copy but the one kept, across albums too', () => {
    const groups = duplicateGroups([
      c(f('2013_neige/a.jpg', 5), 'h', 1),
      c(f('2013_neige/b.jpg', 5), 'h', 2),
      c(f('2013_neige/x.jpg', 7), 'k', 1),
      c(f('Paris/x.jpg', 7), 'k', 2),
      c(f('Paris/alone.jpg', 8), 'z', 1),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.acrossAlbums)).toEqual([true, false])
    expect([...defaultTicks(groups)].sort()).toEqual([pathKey(f('2013_neige/b.jpg', 5)), pathKey(f('Paris/x.jpg', 7))].sort())
  })
})
