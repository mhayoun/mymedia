import { describe, expect, it } from 'vitest'
import { foldersOfFiles, treeText } from './folderNames'

describe('folderNames', () => {
  it('reads the first-level folders of a chosen folder, camera folders left out', () => {
    expect(
      foldersOfFiles(['My Pictures/EinGuedi2015/873NIKON/a.jpg', 'My Pictures/EinGuedi2015/b.jpg', 'My Pictures/anniv papa/c.jpg', 'My Pictures/DCIM/100JLCAM/d.jpg', 'My Pictures/e.jpg']),
    ).toEqual([
      { name: 'anniv papa', count: 1 },
      { name: 'EinGuedi2015', count: 2 },
    ])
  })
})

describe('treeText', () => {
  it('draws the folders like "tree"', () => {
    const text = treeText('My Pictures', [['b'], ['a'], ['a', 'x'], ['a', 'y']])
    expect(text).toBe('My Pictures\n├── a\n│   ├── x\n│   └── y\n└── b\n\n4 directories\n')
  })
})
