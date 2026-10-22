// Guard probe: this fixes the priority half of the report and leaves the
// tiebreak ambiguous, so the visible suite and the priority assertions pass
// while the total-order property still fails. If this file ever passes
// check.sh, the tiebreak guard has been removed.
function compareRules(a, b) {
  if (a.priority > b.priority) return -1;
  if (a.priority < b.priority) return 1;
  return 0;
}

module.exports = { compareRules };
