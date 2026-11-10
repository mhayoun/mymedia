import { describe, expect, it } from 'vitest'
import { albumNameOf, albumPath } from './cameraFolders'

describe('camera folders', () => {
  it('leaves out the folders cameras make', () => {
    for (const n of ['DCIM', 'DCIM__', 'dcim', '100NIKON', '873NIKON', '100MSDCF', '885MSDCF', '100JLCAM', '171CANON', 'CANONMSC', 'MISC', 'temp', 'New Folder', '876___10', '155_3107', '828_2306', '107___12', '457_2909', 'Originals'])
      expect(albumNameOf(n), n).toBeNull()
  })
  it('keeps the name written after a camera number', () => {
    expect(albumNameOf('442___02Pourim5773')).toBe('Pourim5773')
    expect(albumNameOf('108___01-Tiyoul Reuven')).toBe('Tiyoul Reuven')
    expect(albumNameOf('107___12-YomOuledetEfrat')).toBe('YomOuledetEfrat')
    expect(albumNameOf('125_2002Pourim')).toBe('Pourim')
  })
  it('keeps the names people give', () => {
    for (const n of ['EinGuedi2015', '2014_12_22_HaimLook', '2012_02_27', 'mariageAvishai', 'houpa', 'אירוסים אבישי', 'anniver reuven 12', 'Esty2', '100 ans de mamie', 'golan 2011', '100years'])
      expect(albumNameOf(n), n).toBe(n)
  })
  it('puts the photos of a camera folder in the album above', () => {
    expect(albumPath(['EinGuedi2015', '873NIKON'])).toEqual(['EinGuedi2015'])
    expect(albumPath(['2018_22_07', 'Efrat', '100JLCAM'])).toEqual(['2018_22_07', 'Efrat'])
    expect(albumPath(['DCIM', '901___10'])).toEqual([])
    expect(albumPath(['2013_02_21', '442___02Pourim5773'])).toEqual(['2013_02_21', 'Pourim5773'])
  })
})
