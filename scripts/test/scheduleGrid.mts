// The schedule grid's model: what a tap on a cell means. Pure — no database.
import { cellStateOf, nextState, flagsFor, planChange, type GridTimecard } from '../../lib/scheduleGrid.ts'

let pass = 0, fail = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`)
}
const tc = (over: Partial<GridTimecard> = {}): GridTimecard => ({
  id: 'tc1', room_id: 'roomA', crew_member_id: 'sam', crew_member_name: 'Sam', role: 'A1',
  is_travel_day: false, travel_in_day: false, travel_out_day: false, absence: null, punchCount: 0, ...over,
})

console.log('=== cell state ===')
check('no card is empty', cellStateOf(undefined), 'empty')
check('a plain card is work', cellStateOf(tc()), 'work')
check('travel in', cellStateOf(tc({ travel_in_day: true })), 'travel_in')
check('travel out', cellStateOf(tc({ travel_out_day: true })), 'travel_out')
check('a pure travel day', cellStateOf(tc({ is_travel_day: true })), 'travel')
check('is_travel_day wins over a stray leg flag', cellStateOf(tc({ is_travel_day: true, travel_in_day: true })), 'travel')

console.log('\n=== the tap cycle ===')
check('empty → work', nextState('empty'), 'work')
check('work → travel in', nextState('work'), 'travel_in')
check('travel in → travel out', nextState('travel_in'), 'travel_out')
check('travel out → travel', nextState('travel_out'), 'travel')
check('travel → empty', nextState('travel'), 'empty')

console.log('\n=== flags ===')
check('work clears every flag', flagsFor('work'), { is_travel_day: false, travel_in_day: false, travel_out_day: false })
check('travel in', flagsFor('travel_in'), { is_travel_day: false, travel_in_day: true, travel_out_day: false })
check('travel', flagsFor('travel'), { is_travel_day: true, travel_in_day: false, travel_out_day: false })

console.log('\n=== what a change means ===')
const base = { dayLabel: 'Wednesday', personName: 'Sam' }
check('empty → work inserts into the selected room',
  planChange({ ...base, current: undefined, to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'insert', roomId: 'roomA', flags: flagsFor('work') })
check('empty → work when the room is not on that day asks for the room first',
  planChange({ ...base, current: undefined, to: 'work', selectedRoomId: null }),
  { kind: 'insert', roomId: null, flags: flagsFor('work') })
check('work → travel in updates the flags in place',
  planChange({ ...base, current: tc(), to: 'travel_in', selectedRoomId: 'roomA' }),
  { kind: 'update', timecardId: 'tc1', flags: flagsFor('travel_in') })
check('a card in another room MOVES to the selected room',
  planChange({ ...base, current: tc({ room_id: 'roomB' }), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'move', timecardId: 'tc1', toRoomId: 'roomA', flags: flagsFor('work') })
check('work → empty deletes an unpunched card',
  planChange({ ...base, current: tc(), to: 'empty', selectedRoomId: 'roomA' }),
  { kind: 'delete', timecardId: 'tc1' })
check('but refuses when the day has punches',
  planChange({ ...base, current: tc({ punchCount: 2 }), to: 'empty', selectedRoomId: 'roomA' }),
  { kind: 'refuse', reason: "Clear Sam's punches on Wednesday first — a worked day is never removed silently." })
check('and refuses to move a punched card between rooms',
  planChange({ ...base, current: tc({ room_id: 'roomB', punchCount: 1 }), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'refuse', reason: "Clear Sam's punches on Wednesday first — a worked day is never moved silently." })
check("an absent day is not the grid's to change",
  planChange({ ...base, current: tc({ absence: 'cancelled' }), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'refuse', reason: 'Wednesday is marked Cancelled on the tracker. Clear that there first.' })
check('same state, same room: nothing to do',
  planChange({ ...base, current: tc(), to: 'work', selectedRoomId: 'roomA' }),
  { kind: 'none' })
check('empty → empty: nothing to do',
  planChange({ ...base, current: undefined, to: 'empty', selectedRoomId: 'roomA' }),
  { kind: 'none' })

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
