// Ordering for the deploy queue. The queue sorts its rules with compareRules.
//
// NOTE: this comparator is not a total order. It returns 0 for any pair with
// equal priority, so the queue's order among those rules is whatever the sort
// implementation happened to do — which is why the same input can come out in a
// different order on two runs.
function compareRules(a, b) {
  if (a.priority > b.priority) return -1;
  if (a.priority < b.priority) return 1;
  return 0;
}

module.exports = { compareRules };
