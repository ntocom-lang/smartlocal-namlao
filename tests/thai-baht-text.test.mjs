import assert from 'node:assert/strict'
import { thaiBahtText } from '../src/lib/thaiBahtText.js'

assert.equal(thaiBahtText(0), 'ศูนย์บาทถ้วน')
assert.equal(thaiBahtText('0.00'), 'ศูนย์บาทถ้วน')
assert.equal(thaiBahtText(0.25), 'ยี่สิบห้าสตางค์')
assert.equal(thaiBahtText(0.5), 'ห้าสิบสตางค์')
assert.equal(thaiBahtText(1), 'หนึ่งบาทถ้วน')
assert.equal(thaiBahtText(11), 'สิบเอ็ดบาทถ้วน')
assert.equal(thaiBahtText(21), 'ยี่สิบเอ็ดบาทถ้วน')
assert.equal(thaiBahtText(101), 'หนึ่งร้อยเอ็ดบาทถ้วน')
assert.equal(thaiBahtText(1000), 'หนึ่งพันบาทถ้วน')
assert.equal(thaiBahtText(1001), 'หนึ่งพันเอ็ดบาทถ้วน')
assert.equal(thaiBahtText(1000000), 'หนึ่งล้านบาทถ้วน')
assert.equal(thaiBahtText(1000001), 'หนึ่งล้านเอ็ดบาทถ้วน')
assert.equal(thaiBahtText(1250000), 'หนึ่งล้านสองแสนห้าหมื่นบาทถ้วน')
assert.equal(thaiBahtText(1250000.75), 'หนึ่งล้านสองแสนห้าหมื่นบาทเจ็ดสิบห้าสตางค์')
assert.equal(thaiBahtText('1,250,000.00'), 'หนึ่งล้านสองแสนห้าหมื่นบาทถ้วน')
assert.equal(thaiBahtText(10000000), 'สิบล้านบาทถ้วน')
assert.equal(thaiBahtText(21000000), 'ยี่สิบเอ็ดล้านบาทถ้วน')

console.log('✓ thaiBahtText unit tests passed successfully')
