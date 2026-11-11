import { describe, expect, it } from 'vitest'
import { categoryOfName, proposeCategories, wordsOf } from './proposeCategories'

describe('proposeCategories', () => {
  it('splits folder names into words', () => {
    expect(wordsOf('TyoulJerusalem2015')).toBe('tyoul jerusalem 2015')
    expect(wordsOf('2012_02_02_KotelNeige')).toBe('2012 02 02 kotel neige')
  })

  it('finds the category from the words, in French, English, Hebrew and transliterated Hebrew', () => {
    expect(categoryOfName('mariageAvishai')).toBe('weddings')
    expect(categoryOfName('AvishaiHatuna')).toBe('weddings')
    expect(categoryOfName('אירוסים אבישי')).toBe('weddings')
    expect(categoryOfName('BatMitvaEsty')).toBe('barMitzvah')
    expect(categoryOfName('reuvenBarMitzva')).toBe('barMitzvah')
    expect(categoryOfName('אולפן אפרת בת מצווה')).toBe('barMitzvah')
    expect(categoryOfName('anniv papa')).toBe('birthdays')
    expect(categoryOfName('EstyAnniversaire13ans')).toBe('birthdays')
    expect(categoryOfName('יום הולדת נעמי 13')).toBe('birthdays')
    expect(categoryOfName('2012_02_02_KotelNeige')).toBe('snow')
    expect(categoryOfName('TyoulJerusalem2015')).toBe('trips')
    expect(categoryOfName('EinGuedi2015')).toBe('trips')
    expect(categoryOfName('טיול שנתי אפרת תשעו')).toBe('trips')
    expect(categoryOfName('pourim2010')).toBe('holidays')
    expect(categoryOfName('AsherSelihot')).toBe('holidays')
    expect(categoryOfName('messiba naomie gan hova')).toBe('school')
    expect(categoryOfName('כיתה ז אסתי')).toBe('school')
    expect(categoryOfName('mamiColette')).toBe('family')
    expect(categoryOfName('grazia')).toBeNull()
    expect(categoryOfName('organisation')).toBeNull()
  })

  it('a name met in several folders is a child; nothing recognised is "other"', () => {
    const p = proposeCategories(['Asher', 'AsherSelihot', 'tefilin asher', 'expo anniv asher', 'Efrat2', 'efrat', 'efrat danse', 'choral efrat', 'grazia', 'photos', 'photos01', 'photosVideo'])
    expect(p.get('Asher')).toBe('kids')
    expect(p.get('Efrat2')).toBe('kids')
    expect(p.get('efrat danse')).toBe('kids')
    expect(p.get('AsherSelihot')).toBe('holidays')
    expect(p.get('grazia')).toBe('other')
    expect(p.get('photos01')).toBe('other')
  })
})
