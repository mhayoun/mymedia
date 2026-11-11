import { describe, expect, it } from 'vitest'
import { albumDirs, foldersOfFiles, isContainer, treeText } from './folderNames'

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

describe('containers', () => {
  it('looks inside the folders that only hold others', () => {
    expect(['My Pictures', 'My Pictures2004', 'myBackup', 'photos', '2015', 'תמונות'].every(isContainer)).toBe(true)
    expect(['anniv papa', 'mariageAvishai', 'תמונות אשר', '2012_06_12'].some(isContainer)).toBe(false)
    expect(
      foldersOfFiles([
        'myBackup/My Pictures/anniv papa/a.jpg',
        'myBackup/My Pictures2004/mariage batson/876___09/b.jpg',
        'myBackup/My Pictures2004/c.jpg',
        'myBackup/My Pictures2005/anniv papa/d.jpg',
      ]),
    ).toEqual([
      { name: 'anniv papa', count: 2 },
      { name: 'mariage batson', count: 1 },
    ])
    expect(albumDirs([['myBackup', 'My Pictures', 'golan 2011', 'sub'], ['myBackup', 'My Pictures2004']])).toEqual([['golan 2011', 'sub'], []])
  })
})
