import { describe, expect, it } from 'vitest'
import { foldersOfFiles, foldersOfText } from './folderNames'

describe('folderNames', () => {
  it('reads the first-level folders of a chosen folder, camera folders left out', () => {
    expect(
      foldersOfFiles(['My Pictures/EinGuedi2015/873NIKON/a.jpg', 'My Pictures/EinGuedi2015/b.jpg', 'My Pictures/anniv papa/c.jpg', 'My Pictures/DCIM/100JLCAM/d.jpg', 'My Pictures/e.jpg']),
    ).toEqual([
      { name: 'anniv papa', count: 1 },
      { name: 'EinGuedi2015', count: 2 },
    ])
  })

  it('reads what "tree" prints', () => {
    const tree = `.
├── 2017_Paris
│   ├── 894___08
│   └── temp
├── anniv papa
├── DCIM
│   └── 100JLCAM
└── תמונות אשר
    └── קבלת שבת

7 directories`
    expect(foldersOfText(tree)).toEqual([
      { name: '2017_Paris', count: 2 },
      { name: 'anniv papa', count: 0 },
      { name: 'תמונות אשר', count: 1 },
    ])
  })

  it('reads a list of paths or of names', () => {
    expect(foldersOfText('My Pictures/golan 2011\nMy Pictures/golan 2011/sub\nMy Pictures/neige 2013')).toEqual([
      { name: 'golan 2011', count: 1 },
      { name: 'neige 2013', count: 0 },
    ])
    expect(foldersOfText('Asher\nEsty2\n')).toEqual([
      { name: 'Asher', count: 0 },
      { name: 'Esty2', count: 0 },
    ])
  })
})
