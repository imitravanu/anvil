// Ordering for the deploy queue. The queue sorts its rules with compareRules.
//
// A total order: priority descending, then id ascending so equal-priority rules
// have one deterministic position instead of whatever the sort happened to do.
function compareRules(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

module.exports = { compareRules };
