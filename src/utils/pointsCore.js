/**
 * Points / standings derivation — single source of truth.
 *
 * Win (3-0, 2-1, 2-0) → winner: 4, loser: 1
 * Draw (1-1)          → both: 2
 * Forfeit             → winner: 4 (sets 3), forfeiting team: 0 (sets 0)
 * Forfeit (no show)   → winner: 4 (sets 3), no-show team: configurable penalty (sets 0), default -4
 * Double forfeit      → each team scored independently (0, or the no-show penalty), sets 0-0
 * Bye                 → 0
 *
 * Forfeit state is tracked per team via match.team_a_forfeit / match.team_b_forfeit,
 * each null | 'forfeit' | 'no_show'. match.status still carries 'forfeit_a'/'forfeit_b'
 * (status filters rely on it); a double forfeit has status 'forfeit_a' and both columns set.
 *
 * No framework dependencies (no React, no Supabase client) — this file is the
 * portable half of the scoring logic, safe to serve standalone (e.g. to the
 * public WordPress embed) or import into the app. See points.js for the
 * app-only useNoShowPenalty hook that reads the setting from Supabase.
 */

export const DEFAULT_NO_SHOW_PENALTY = -4

export function isForfeit(match) {
  return match.status === 'forfeit_a' || match.status === 'forfeit_b'
}

// A cancelled match (e.g. rained out) is inactive — excluded from standings/scheduling,
// kept around as a record until it's replayed in a later round.
export function isCancelled(match) {
  return match.status === 'cancelled'
}

// Per-team forfeit state: { a, b }, each null | 'forfeit' | 'no_show'.
// Falls back to status for any legacy rows that predate the per-team columns.
export function forfeitSides(match) {
  if (match.team_a_forfeit != null || match.team_b_forfeit != null) {
    return { a: match.team_a_forfeit ?? null, b: match.team_b_forfeit ?? null }
  }
  if (match.status === 'forfeit_a') return { a: 'forfeit', b: null }
  if (match.status === 'forfeit_b') return { a: null, b: 'forfeit' }
  return { a: null, b: null }
}

/**
 * Per-team breakdown of a forfeited match.
 * Returns { points, win, forfeited, setsFor, setsAgainst }.
 */
export function forfeitForTeam(match, teamId, noShowPenalty = DEFAULT_NO_SHOW_PENALTY) {
  const isA = match.team_a_id === teamId
  const { a, b } = forfeitSides(match)
  const myForfeit = isA ? a : b
  const theirForfeit = isA ? b : a

  // A forfeiting team contributes 0 sets; the non-forfeiting opponent gets 3.
  const setsFor = myForfeit ? 0 : 3
  const setsAgainst = theirForfeit ? 0 : 3

  if (myForfeit) {
    return {
      points: myForfeit === 'no_show' ? noShowPenalty : 0,
      win: false, forfeited: true, setsFor, setsAgainst,
    }
  }
  return { points: 4, win: true, forfeited: false, setsFor, setsAgainst }
}

// Result label from a team's perspective: 'Win' | 'Forfeit' | 'No Show'.
export function forfeitOutcomeLabel(match, teamId) {
  const isA = match.team_a_id === teamId
  const { a, b } = forfeitSides(match)
  const myForfeit = isA ? a : b
  if (!myForfeit) return 'Win'
  return myForfeit === 'no_show' ? 'No Show' : 'Forfeit'
}

export function derivePoints(match, teamId, noShowPenalty = DEFAULT_NO_SHOW_PENALTY) {
  if (isForfeit(match)) return forfeitForTeam(match, teamId, noShowPenalty).points
  if (match.status !== 'completed') return 0

  const isA = match.team_a_id === teamId
  const mySets = isA ? match.team_a_sets : match.team_b_sets
  const theirSets = isA ? match.team_b_sets : match.team_a_sets

  if (mySets === theirSets) return 2 // draw
  if (mySets > theirSets) return 4  // win
  return 1                           // loss
}

export function deriveOutcome(match, teamId) {
  if (isCancelled(match)) return 'Rained Out'
  if (isForfeit(match)) return forfeitOutcomeLabel(match, teamId)
  if (match.status !== 'completed') return '—'

  const isA = match.team_a_id === teamId
  const mySets = isA ? match.team_a_sets : match.team_b_sets
  const theirSets = isA ? match.team_b_sets : match.team_a_sets
  if (mySets > theirSets) return 'Win'
  if (mySets === theirSets) return 'Draw'
  return 'Loss'
}

// ---------------------------------------------------------------------------
// Standings tally — the shape every standings computation accumulates into.
// ---------------------------------------------------------------------------

export function emptyTally() {
  return {
    played: 0, wins: 0, draws: 0, losses: 0,
    forfeitsAgainst: 0, points: 0, setsFor: 0, setsAgainst: 0,
  }
}

/** Field-wise sum of two tallies. Missing fields count as 0, so a partial
 *  delta (e.g. adjustmentTally, which has no forfeitsAgainst) can be added to a
 *  full tally without losing the other side's value. */
export function addTally(a, b) {
  const x = a || {}, y = b || {}
  return {
    played: (x.played || 0) + (y.played || 0),
    wins: (x.wins || 0) + (y.wins || 0),
    draws: (x.draws || 0) + (y.draws || 0),
    losses: (x.losses || 0) + (y.losses || 0),
    forfeitsAgainst: (x.forfeitsAgainst || 0) + (y.forfeitsAgainst || 0),
    points: (x.points || 0) + (y.points || 0),
    setsFor: (x.setsFor || 0) + (y.setsFor || 0),
    setsAgainst: (x.setsAgainst || 0) + (y.setsAgainst || 0),
  }
}

/** Field-wise difference of two tallies (a − b). See addTally for field rules. */
export function subtractTally(a, b) {
  const x = a || {}, y = b || {}
  return {
    played: (x.played || 0) - (y.played || 0),
    wins: (x.wins || 0) - (y.wins || 0),
    draws: (x.draws || 0) - (y.draws || 0),
    losses: (x.losses || 0) - (y.losses || 0),
    forfeitsAgainst: (x.forfeitsAgainst || 0) - (y.forfeitsAgainst || 0),
    points: (x.points || 0) - (y.points || 0),
    setsFor: (x.setsFor || 0) - (y.setsFor || 0),
    setsAgainst: (x.setsAgainst || 0) - (y.setsAgainst || 0),
  }
}

/**
 * Tally a team's completed/forfeited matches into a standings record. Pass a
 * `seed` (e.g. carriedTally(enrolment)) to start from carried-over values; the
 * returned object is a fresh copy, never the seed. Only completed and forfeit
 * matches contribute — scheduled/cancelled are ignored — so it is safe to pass
 * a broader match list.
 */
export function tallyMatches(matches, teamId, noShowPenalty = DEFAULT_NO_SHOW_PENALTY, seed = null) {
  const t = seed ? { ...emptyTally(), ...seed } : emptyTally()
  for (const m of matches || []) {
    if (m.team_a_id !== teamId && m.team_b_id !== teamId) continue
    if (isForfeit(m)) {
      const f = forfeitForTeam(m, teamId, noShowPenalty)
      t.played++
      t.points += f.points
      t.setsFor += f.setsFor
      t.setsAgainst += f.setsAgainst
      if (f.win) t.wins++
      else t.forfeitsAgainst++
      continue
    }
    if (m.status !== 'completed') continue
    const isA = m.team_a_id === teamId
    const mySets = isA ? m.team_a_sets : m.team_b_sets
    const theirSets = isA ? m.team_b_sets : m.team_a_sets
    t.played++
    t.setsFor += mySets
    t.setsAgainst += theirSets
    if (mySets > theirSets) { t.wins++; t.points += 4 }
    else if (mySets === theirSets) { t.draws++; t.points += 2 }
    else { t.losses++; t.points += 1 }
  }
  return t
}

/**
 * Seed values carried into a grade from a mid-season transfer, read from the
 * carried_* snapshot columns on the team's grade_enrolments row. Returns zeros
 * for teams that were never transferred (or transferred without carrying points).
 */
export function carriedTally(enrolment) {
  return {
    played: enrolment?.carried_played || 0,
    wins: enrolment?.carried_wins || 0,
    draws: enrolment?.carried_draws || 0,
    losses: enrolment?.carried_losses || 0,
    forfeitsAgainst: enrolment?.carried_forfeits || 0,
    points: enrolment?.carried_points || 0,
    setsFor: enrolment?.carried_sets_for || 0,
    setsAgainst: enrolment?.carried_sets_against || 0,
  }
}

/**
 * Set ratio = sets won / total sets played, as a 0–1 fraction (0 when no sets
 * have been played). Used both as the ladder's second sort key and the "S%"
 * column. Monotonic in the old sets-for/sets-against ratio, so swapping to it
 * never changes ladder order — only the displayed value.
 */
export function setRatio(tally) {
  const total = (tally.setsFor || 0) + (tally.setsAgainst || 0)
  return total === 0 ? 0 : tally.setsFor / total
}

/** setRatio as a whole-number percentage string, or '—' when no sets played. */
export function formatSetRatio(tally) {
  const total = (tally.setsFor || 0) + (tally.setsAgainst || 0)
  return total === 0 ? '—' : Math.round(setRatio(tally) * 100) + '%'
}

/**
 * Rounds a team should show an extra "bye" row for, beyond its recorded byes:
 * completed rounds where the team has NEITHER a match NOR a recorded bye — e.g.
 * they joined the grade late, or a round wasn't scheduled for them manually.
 * `rounds` is the league's rounds (each needs `round_number` + `status`);
 * `playedRoundNumbers` / `byeRoundNumbers` are Sets of round_numbers the team
 * already has a match / recorded bye in. Both these and recorded byes render
 * identically as a "Bye" row — see the public embed and the app history tables.
 */
export function findGapRounds(rounds, playedRoundNumbers, byeRoundNumbers) {
  return (rounds || []).filter(r =>
    r.status === 'completed' &&
    !playedRoundNumbers.has(r.round_number) &&
    !byeRoundNumbers.has(r.round_number)
  )
}

/**
 * Combined deltas from a team's manual ladder adjustments (the
 * ladder_adjustments table / public_ladder_adjustments view). Each adjustment
 * carries a signed `points` change plus optional match-record deltas — a played
 * game with a Win/Draw/Loss result and sets. Returned in the tally's camelCase
 * shape. Returns all-zeros when a team has no adjustments. DB columns are
 * snake_case (sets_for/sets_against); the rest match the tally names.
 */
export function adjustmentTally(adjustments, teamId) {
  const d = { played: 0, wins: 0, draws: 0, losses: 0, setsFor: 0, setsAgainst: 0, points: 0 }
  for (const a of adjustments || []) {
    if (a.team_id !== teamId) continue
    d.played += a.played || 0
    d.wins += a.wins || 0
    d.draws += a.draws || 0
    d.losses += a.losses || 0
    d.setsFor += a.sets_for || 0
    d.setsAgainst += a.sets_against || 0
    d.points += a.points || 0
  }
  return d
}

/**
 * A computed tally with a team's manual adjustments folded in. Adjustments add
 * on top of match-derived values, so P/W/D/L/Pts/SF/SA all reflect them and
 * setRatio() recomputes from the merged sets. forfeitsAgainst is left untouched
 * (adjustments never model forfeits). Used at every standings call site so the
 * app and the public embed stay identical.
 */
export function withAdjustments(tally, adjustments, teamId) {
  const d = adjustmentTally(adjustments, teamId)
  return {
    ...tally,
    played: tally.played + d.played,
    wins: tally.wins + d.wins,
    draws: tally.draws + d.draws,
    losses: tally.losses + d.losses,
    setsFor: tally.setsFor + d.setsFor,
    setsAgainst: tally.setsAgainst + d.setsAgainst,
    points: tally.points + d.points,
  }
}

/**
 * Everything already VISIBLE for a team in one grade — its raw match results
 * plus that grade's manual adjustments — excluding anything carried in. This is
 * the quantity the standings would show if the enrolment's carried_* were zero,
 * and it is the unit the transfer carry-over arithmetic is built from.
 */
export function visibleTally(matches, adjustments, teamId, noShowPenalty = DEFAULT_NO_SHOW_PENALTY) {
  return addTally(
    tallyMatches(matches, teamId, noShowPenalty),
    adjustmentTally(adjustments, teamId)
  )
}

/**
 * The carried_* snapshot to write when transferring a team into a destination
 * grade. Upholds the invariant every standings call site depends on:
 *
 *     carried(E) = total season record − what's already visible in E's grade
 *
 * where the total is the source enrolment's own carried record (everything it
 * inherited) plus what's visible in the source grade. Because carried_* is
 * itself part of that sum, the definition is inductive: it stays correct over
 * any number of hops (A→B→C→…), and subtracting the destination's own visible
 * record makes returning to a previously-played grade (A→B→A) non-duplicating.
 * Order of hops never matters — the total is a union over grades, not a path.
 *
 * Pass the source enrolment row, and both grades' matches + adjustments.
 */
export function transferCarryTally({
  sourceEnrolment, sourceMatches, sourceAdjustments,
  destMatches, destAdjustments, teamId, noShowPenalty = DEFAULT_NO_SHOW_PENALTY,
}) {
  const total = addTally(
    carriedTally(sourceEnrolment),
    visibleTally(sourceMatches, sourceAdjustments, teamId, noShowPenalty)
  )
  return subtractTally(
    total,
    visibleTally(destMatches, destAdjustments, teamId, noShowPenalty)
  )
}

/** True when a tally has any carried-over history (used to badge the ladder). */
export function hasCarriedRecord(enrolment) {
  return !!enrolment && (
    (enrolment.carried_played || 0) > 0 ||
    (enrolment.carried_points || 0) !== 0 ||
    (enrolment.carried_sets_for || 0) > 0 ||
    (enrolment.carried_sets_against || 0) > 0
  )
}
