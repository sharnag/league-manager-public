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

/** True when a tally has any carried-over history (used to badge the ladder). */
export function hasCarriedRecord(enrolment) {
  return !!enrolment && (
    (enrolment.carried_played || 0) > 0 ||
    (enrolment.carried_points || 0) !== 0 ||
    (enrolment.carried_sets_for || 0) > 0 ||
    (enrolment.carried_sets_against || 0) > 0
  )
}
